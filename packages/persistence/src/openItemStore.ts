import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

import type {
  CarryForwardDecision,
  ErrorCategory,
  NaturalKeyTier,
  OpenItemCandidate,
  OpenItemRecord,
  SourceSystem,
} from '@recon/domain';

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

  /**
   * Loads every still-`OPEN` item for the given accounts (PR D.1) -- the read side of
   * `projectOpenItems`. `accountIdentifiers` is raw free text (the run's own distinct
   * `NormalizedTransaction.accountIdentifier` values, not resolved account UUIDs); the join to
   * `reconciliation_account` resolves it the same way `findOrCreateAccount` does on the write
   * side. `amount`/`original_transaction_date` get the same `::text`/`Number()` treatment as
   * every other numeric/date column this store touches -- `pg` returns NUMERIC as a string and
   * DATE as a `Date` object by default, neither of which matches `OpenItemRecord`'s declared
   * shape without an explicit cast.
   */
  async loadOpenItems(
    organizationId: string,
    accountIdentifiers: string[],
  ): Promise<OpenItemRecord[]> {
    if (accountIdentifiers.length === 0) {
      return [];
    }

    return runInTenantScope(this.pool, organizationId, async (client) => {
      const result = await client.query<{
        id: string;
        account_identifier: string;
        source_system: SourceSystem;
        category: ErrorCategory;
        natural_key: string;
        natural_key_tier: NaturalKeyTier;
        original_transaction_date: string;
        amount: string;
        check_number: string | null;
        reference_number: string | null;
        description_snapshot: string | null;
      }>(
        `SELECT oi.id, a.account_identifier, oi.source_system, oi.category, oi.natural_key,
                oi.natural_key_tier,
                oi.original_transaction_date::text AS original_transaction_date,
                oi.amount, oi.check_number, oi.reference_number, oi.description_snapshot
           FROM reconciliation_open_item oi
           JOIN reconciliation_account a ON a.id = oi.account_id
          WHERE oi.organization_id = $1 AND oi.status = 'OPEN'
            AND a.account_identifier = ANY($2::text[])`,
        [organizationId, accountIdentifiers],
      );

      return result.rows.map((row) => ({
        id: row.id,
        accountIdentifier: row.account_identifier,
        sourceSystem: row.source_system,
        category: row.category,
        naturalKey: row.natural_key,
        naturalKeyTier: row.natural_key_tier,
        originalTransactionDate: row.original_transaction_date,
        amount: Number(row.amount),
        checkNumber: row.check_number ?? undefined,
        referenceNumber: row.reference_number ?? undefined,
        descriptionSnapshot: row.description_snapshot ?? undefined,
      }));
    });
  }

  /**
   * Marks carried-forward items that found their counterpart this run as `CLEARED` (PR D.5).
   * `matchResultId` is optional per clearance, not required: it's only safe to write when this
   * run's `MatchResult`s were actually persisted into `reconciliation_match_result` (the column's
   * FK target) -- the caller passes it only when a `lifecycleStore` did that persisting this run,
   * and NULL otherwise, rather than this store guessing. Silently no-ops (zero rows affected) for
   * an item that isn't `OPEN` any more -- re-running finalize twice against the same clearance
   * must not double-write or throw.
   */
  async clearOpenItems(
    organizationId: string,
    input: {
      reconciliationRunId?: string;
      clearances: Array<{ openItemId: string; matchResultId?: string }>;
    },
  ): Promise<{ cleared: number }> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      let cleared = 0;

      for (const clearance of input.clearances) {
        const result = await client.query(
          `UPDATE reconciliation_open_item
              SET status = 'CLEARED', cleared_in_run_id = $2, cleared_at = NOW(),
                  cleared_match_result_id = $3
            WHERE id = $1 AND organization_id = $4 AND status = 'OPEN'`,
          [
            clearance.openItemId,
            input.reconciliationRunId ?? null,
            clearance.matchResultId ?? null,
            organizationId,
          ],
        );

        if ((result.rowCount ?? 0) > 0) {
          await client.query(
            `INSERT INTO reconciliation_open_item_event
               (open_item_id, organization_id, run_id, event_type, from_status, to_status, actor)
             VALUES ($1, $2, $3, 'CLEARED', 'OPEN', 'CLEARED', 'system')`,
            [clearance.openItemId, organizationId, input.reconciliationRunId ?? null],
          );
          cleared += 1;
        }
      }

      return { cleared };
    });
  }
}
