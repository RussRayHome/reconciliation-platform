import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

import type { CarryForwardDecision, OpenItemCandidate } from '@recon/domain';

import { runInTenantScope } from './postgres';

export interface ProjectOpenItemsInput {
  /** `reconciliation_job.id` -- recorded on a newly-opened item as `first_detected_job_id`. */
  jobId: string;
  /** `reconciliation_run.id`, when this projection is running for a File-Imports-triggered run
   * (which has one) -- recorded as `opened_in_run_id` on a newly-opened item and as the `run_id`
   * on every event this call writes. Undefined for the older atomic route, which has no
   * `reconciliation_run` row at all; items still project (an open item is about the account, not
   * about which route submitted the data), they just carry no run attribution. */
  reconciliationRunId?: string;
  candidates: OpenItemCandidate[];
}

export interface ProjectOpenItemsResult {
  /** Genuinely new open items -- no prior OPEN row existed for this (account, natural_key). */
  opened: number;
  /** A prior OPEN row for this (account, natural_key) was found again -- either a real re-import
   * of overlapping source data (today, before PR D's seeding exists) or, if this exact run is
   * finalized twice, the idempotency path re-confirming what the first call already opened. */
  carriedForward: number;
}

/**
 * Write path for the Unreconciled Item Roll-Forward's open-item entity (PR C.4). Called once per
 * successful run, right after the reconciliation pipeline's export/finalize step
 * (`PostgresReconciliationLifecycleStore.persistExportAndFinalize`) -- see
 * `reconciliation_job.current_state = 'FINALIZED'`'s doc comment for why that event, not
 * `reconciliation_run.status = 'RECONCILED'`, is the real "this run is done" signal this
 * projection hooks on (the latter is set immediately afterward, in the same call, specifically to
 * stop being a dead status).
 */
export class PostgresOpenItemStore {
  constructor(private readonly pool: Pool) {}

  /** Resolves `accountIdentifier` to a `reconciliation_account.id`, creating the row if this is
   * the first time this organization has seen that identifier. The `DO UPDATE SET` (rather than
   * `DO NOTHING`) is the standard trick to make `RETURNING id` also work on the conflict path --
   * a plain `DO NOTHING` returns no row at all when the account already existed. */
  private async findOrCreateAccount(
    client: PoolClient,
    organizationId: string,
    accountIdentifier: string,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO reconciliation_account (id, organization_id, account_identifier)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, account_identifier)
         DO UPDATE SET account_identifier = EXCLUDED.account_identifier
       RETURNING id`,
      [randomUUID(), organizationId, accountIdentifier],
    );
    return result.rows[0]!.id;
  }

  async projectOpenItems(
    organizationId: string,
    input: ProjectOpenItemsInput,
  ): Promise<ProjectOpenItemsResult> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      let opened = 0;
      let carriedForward = 0;

      for (const candidate of input.candidates) {
        const accountId = await this.findOrCreateAccount(
          client,
          organizationId,
          candidate.accountIdentifier,
        );

        const existing = await client.query<{ id: string }>(
          `SELECT id FROM reconciliation_open_item
            WHERE organization_id = $1 AND account_id = $2 AND natural_key = $3 AND status = 'OPEN'`,
          [organizationId, accountId, candidate.naturalKey],
        );
        const existingId = existing.rows[0]?.id;

        if (existingId) {
          await client.query(
            `INSERT INTO reconciliation_open_item_event
               (open_item_id, organization_id, run_id, event_type, from_status, to_status, actor)
             VALUES ($1, $2, $3, 'CARRIED_FORWARD', 'OPEN', 'OPEN', 'system')`,
            [existingId, organizationId, input.reconciliationRunId ?? null],
          );
          carriedForward += 1;
          continue;
        }

        const openItemId = randomUUID();
        await client.query(
          `INSERT INTO reconciliation_open_item
             (id, organization_id, account_id, opened_in_run_id, first_detected_job_id,
              source_system, category, natural_key, natural_key_tier, original_transaction_date,
              amount, check_number, reference_number, description_snapshot, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'OPEN')`,
          [
            openItemId,
            organizationId,
            accountId,
            input.reconciliationRunId ?? null,
            input.jobId,
            candidate.sourceSystem,
            candidate.category,
            candidate.naturalKey,
            candidate.naturalKeyTier,
            candidate.originalTransactionDate,
            candidate.amount,
            candidate.checkNumber ?? null,
            candidate.referenceNumber ?? null,
            candidate.descriptionSnapshot ?? null,
          ],
        );
        await client.query(
          `INSERT INTO reconciliation_open_item_event
             (open_item_id, organization_id, run_id, event_type, from_status, to_status, actor)
           VALUES ($1, $2, $3, 'OPENED', NULL, 'OPEN', 'system')`,
          [openItemId, organizationId, input.reconciliationRunId ?? null],
        );
        opened += 1;
      }

      return { opened, carriedForward };
    });
  }

  /** Flips `reconciliation_run.status` to `RECONCILED` once its linked job has finalized --
   * RECONCILING/RECONCILED existed in the CHECK constraint since changeset 0042 but nothing ever
   * set either one; PENDING_APPROVAL/APPROVED/REJECTED (the Comptroller review trail) don't gate
   * this, matching 0042's own "matching still fires immediately once validation passes" note.
   * Idempotent: re-running this against an already-RECONCILED run is a harmless no-op UPDATE. */
  async markRunReconciled(organizationId: string, reconciliationRunId: string): Promise<void> {
    await runInTenantScope(this.pool, organizationId, (client) =>
      client.query(
        `UPDATE reconciliation_run SET status = 'RECONCILED' WHERE id = $1 AND status <> 'RECONCILED'`,
        [reconciliationRunId],
      ),
    );
  }

  /** Reads `reconciliation_organization.carry_forward_enabled` (changeset 0066) -- the org half of
   * `resolveCarryForwardDecision`'s input (`@recon/domain`). Uses the plain pool, not
   * `runInTenantScope`: `reconciliation_organization` is the tenant table itself and carries no
   * RLS policy (changeset 0030's own documented exclusion, matching ADR-0001's scope), so a
   * session-scoped query would add nothing here. Returns `false` (never carry-forward) for an
   * organization id that doesn't resolve, rather than throwing -- a caller mid-request already
   * knows the organization exists from auth; this is a defensive default, not an expected path. */
  async getCarryForwardEnabled(organizationId: string): Promise<boolean> {
    const result = await this.pool.query<{ carry_forward_enabled: boolean }>(
      'SELECT carry_forward_enabled FROM reconciliation_organization WHERE id = $1',
      [organizationId],
    );
    return result.rows[0]?.carry_forward_enabled ?? false;
  }

  /** Persists the resolver's outcome on the run itself (changeset 0067) -- see that changeset's
   * own doc comment for why NULL (never evaluated) is kept distinct from `false` (evaluated,
   * declined, with a reason). No-op when `reconciliationRunId` is undefined -- the standalone
   * atomic route has no `reconciliation_run` row to stamp. */
  async stampCarryForwardDecision(
    organizationId: string,
    reconciliationRunId: string | undefined,
    decision: CarryForwardDecision,
  ): Promise<void> {
    if (!reconciliationRunId) {
      return;
    }
    await runInTenantScope(this.pool, organizationId, (client) =>
      client.query(
        `UPDATE reconciliation_run
            SET carry_forward_applied = $2, carry_forward_skip_reason = $3
          WHERE id = $1`,
        [reconciliationRunId, decision.enabled, decision.enabled ? null : decision.reason],
      ),
    );
  }
}
