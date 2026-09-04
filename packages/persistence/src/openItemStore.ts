import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

import type {
  CarryForwardDecision,
  ErrorCategory,
  NaturalKeyTier,
  OpenItemCandidate,
  OpenItemRecord,
  SourceSystem,
  UserRole,
} from '@recon/domain';
import { canApproveWriteOff, writeOffBandForAmount } from '@recon/domain';

import { runInTenantScope } from './postgres';

/** One account's roll-forward snapshot, frozen at period close (PR E.2) -- the persisted
 * counterpart to `SummaryMetrics.rollForward` (PR D.4), but independently recomputed from
 * `reconciliation_open_item`/`reconciliation_open_item_event` rather than trusting an in-memory
 * figure: `SummaryMetrics.rollForward` is never persisted (see `readModelStore.ts`'s `mapSummary`
 * doc comment), and a close-time recompute is the more authoritative source anyway -- it is what
 * actually gets frozen and asserted against the control equation.
 *
 * Every `*Amount` field here is SIGNED (matching `reconciliation_open_item.amount` itself), not
 * `abs()`-ed like `SummaryMetrics.rollForward`'s UI-facing exposure figures -- this is a genuine
 * dollar-balance rollforward meant to be reconciled against a GL control account, not an exposure
 * count for a review screen. */
export interface PeriodRollforwardSnapshot {
  accountId: string;
  accountIdentifier: string;
  openingCount: number;
  openingAmount: number;
  newCount: number;
  newAmount: number;
  clearedCount: number;
  clearedAmount: number;
  writtenOffCount: number;
  writtenOffAmount: number;
  closingCount: number;
  closingAmount: number;
}

/** One account's tie-out failure at close time -- the independently-counted current OPEN balance
 * disagreed with the roll-forward arithmetic (opening + new - cleared - written off). Surfaced so
 * the close error can name exactly which account and by how much, per plan §3.8/E.2 ("Reject the
 * close on a tie-out failure with the discrepancy in the error"). */
export interface PeriodRollforwardDiscrepancy {
  accountId: string;
  accountIdentifier: string;
  expectedClosingCount: number;
  actualClosingCount: number;
  expectedClosingAmount: number;
  actualClosingAmount: number;
}

export type CloseRunResult =
  | { outcome: 'closed'; snapshots: PeriodRollforwardSnapshot[] }
  | { outcome: 'not_found' }
  | { outcome: 'not_closable'; status: string }
  | { outcome: 'tie_out_failed'; discrepancies: PeriodRollforwardDiscrepancy[] };

export type ReopenRunResult =
  | { outcome: 'reopened'; reopenCount: number; staleSnapshotCount: number }
  | { outcome: 'not_found' }
  | { outcome: 'not_closed'; status: string };

export type WriteOffOpenItemResult =
  | { outcome: 'written_off' }
  | { outcome: 'not_found' }
  | { outcome: 'not_open'; status: string }
  /** The actor's role sits below the band this item's amount falls into (Issue #283). */
  | { outcome: 'insufficient_authority'; amount: number; requiredRoleLabel: string }
  /** The actor submitted the run that opened this item, so may not also write it off. Raised by
   *  the database trigger (changeset 0075), not by this store -- the store only translates it. */
  | { outcome: 'segregation_of_duty' };

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
  /** @param pool Tenant-agnostic pool; every method scopes its own queries via
   * `runInTenantScope` (or, for `reconciliation_organization`, the plain pool -- see
   * `getCarryForwardEnabled`'s own doc comment for why). */
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

  /**
   * Projects this run's carry-eligible exceptions (`input.candidates`, already reduced by
   * `buildOpenItemCandidates`) into open items: an existing OPEN row for the same
   * `(organization_id, account_id, natural_key)` gets a `CARRIED_FORWARD` event; anything new is
   * inserted and gets an `OPENED` event. See the class's own doc comment for when this runs.
   */
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

  /** Single-row lookup by user_name AND organization_id -- the same narrow, already-tenant-scoped
   * shape `PostgresImportValidationStore.resolveUserId` uses (see
   * reconciliationUserAccessGuard.test.ts's allowlist entry for this file: never a list/filter
   * across reconciliation_user, which has RLS fully disabled). Not shared with that class since
   * the two stores don't otherwise depend on each other. */
  private async resolveUserId(
    client: PoolClient,
    organizationId: string,
    username: string,
  ): Promise<string | null> {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM reconciliation_user WHERE user_name = $1 AND organization_id = $2',
      [username, organizationId],
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Links a run to the real accounts its own normalized transactions touch (PR E.1's prerequisite
   * fix, not a plan work item by name -- see this method's own investigation note below). Upserts
   * each `reconciliation_account` row (same `findOrCreateAccount` used by `projectOpenItems`) and
   * links it via `reconciliation_run_account` (PR A.2, changeset 0060).
   *
   * `reconciliation_run_account` was created "unused on landing" in PR A -- its own changeset
   * backfilled one row per *existing* run at migration time, but nothing in the application ever
   * wrote a new row for a run created afterward. PR E's close operation needs a reliable way to
   * enumerate a run's accounts (§3.8: "recomputes the roll-forward snapshot per account"), and the
   * per-transaction `accountIdentifier` values aren't known until normalization runs -- well after
   * `PostgresImportRunStore.createRun` -- so this is called from the reconciliation pipeline
   * itself (`reconciliationService.ts`), the same place PR D.1 already computes the run's distinct
   * account identifiers for carry-forward seeding.
   */
  async linkRunAccounts(
    organizationId: string,
    input: { reconciliationRunId: string; accountIdentifiers: string[] },
  ): Promise<void> {
    if (input.accountIdentifiers.length === 0) {
      return;
    }
    await runInTenantScope(this.pool, organizationId, async (client) => {
      // period_year/period_month/is_terminal_good are denormalized onto this join row (changeset
      // 0062, write-once by design -- a run's period never changes after submission) so the
      // partial unique index enforcing "at most one terminal-good run per account+period" can
      // filter on columns of this table alone. Read once per call, not once per account: every
      // account linked in this call belongs to the same run.
      const runResult = await client.query<{
        period_year: number;
        period_month: number | null;
        status: string;
      }>(
        `SELECT period_year, period_month, status FROM reconciliation_run
          WHERE id = $1 AND organization_id = $2`,
        [input.reconciliationRunId, organizationId],
      );
      const run = runResult.rows[0];
      if (!run) {
        throw new Error(`linkRunAccounts: reconciliation_run "${input.reconciliationRunId}" not found.`);
      }
      const isTerminalGood = run.status === 'RECONCILED' || run.status === 'CLOSED';

      for (const accountIdentifier of input.accountIdentifiers) {
        const accountId = await this.findOrCreateAccount(client, organizationId, accountIdentifier);
        await client.query(
          `INSERT INTO reconciliation_run_account
             (id, organization_id, reconciliation_run_id, account_id, period_year, period_month,
              is_terminal_good)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (reconciliation_run_id, account_id) DO NOTHING`,
          [
            randomUUID(),
            organizationId,
            input.reconciliationRunId,
            accountId,
            run.period_year,
            run.period_month,
            isTerminalGood,
          ],
        );
      }
    });
  }

  /**
   * Closes a period (PR E.2, plan §3.8): for every account linked to this run
   * (`reconciliation_run_account`), recomputes the roll-forward snapshot, asserts the control
   * equation against an independently-counted current OPEN balance, and only if every account
   * ties does it freeze the snapshots and flip the run to CLOSED. All in one transaction -- a
   * partial close (some accounts frozen, others not) would defeat the point of a tie-out gate.
   *
   * Only a `RECONCILED` run can close -- period close is the last step after reconciliation
   * finishes, not a substitute for it.
   */
  async closeRun(
    organizationId: string,
    input: { runId: string; actorUsername: string },
  ): Promise<CloseRunResult> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const actorUserId = await this.resolveUserId(client, organizationId, input.actorUsername);
      if (!actorUserId) {
        throw new Error(
          `closeRun: actor username "${input.actorUsername}" has no matching reconciliation_user row.`,
        );
      }

      const runResult = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM reconciliation_run WHERE id = $1 AND organization_id = $2`,
        [input.runId, organizationId],
      );
      const run = runResult.rows[0];
      if (!run) {
        return { outcome: 'not_found' };
      }
      if (run.status !== 'RECONCILED') {
        return { outcome: 'not_closable', status: run.status };
      }

      const accountsResult = await client.query<{ account_id: string; account_identifier: string }>(
        `SELECT ra.account_id, a.account_identifier
           FROM reconciliation_run_account ra
           JOIN reconciliation_account a ON a.id = ra.account_id
          WHERE ra.reconciliation_run_id = $1 AND ra.organization_id = $2`,
        [input.runId, organizationId],
      );

      const snapshots: PeriodRollforwardSnapshot[] = [];
      const discrepancies: PeriodRollforwardDiscrepancy[] = [];

      for (const account of accountsResult.rows) {
        const priorResult = await client.query<{ closing_count: number; closing_amount: string }>(
          `SELECT closing_count, closing_amount
             FROM reconciliation_period_rollforward
            WHERE organization_id = $1 AND account_id = $2 AND reconciliation_run_id <> $3
            ORDER BY computed_at DESC
            LIMIT 1`,
          [organizationId, account.account_id, input.runId],
        );
        const openingCount = priorResult.rows[0]?.closing_count ?? 0;
        const openingAmount = Number(priorResult.rows[0]?.closing_amount ?? 0);

        const activityResult = await client.query<{
          event_type: string;
          count: string;
          amount: string;
        }>(
          `SELECT ev.event_type, COUNT(*)::text AS count, COALESCE(SUM(oi.amount), 0)::text AS amount
             FROM reconciliation_open_item_event ev
             JOIN reconciliation_open_item oi ON oi.id = ev.open_item_id
            WHERE ev.organization_id = $1 AND ev.run_id = $2 AND oi.account_id = $3
              AND ev.event_type IN ('OPENED', 'CLEARED', 'WRITTEN_OFF')
            GROUP BY ev.event_type`,
          [organizationId, input.runId, account.account_id],
        );
        const activity = Object.fromEntries(
          activityResult.rows.map((row) => [row.event_type, { count: Number(row.count), amount: Number(row.amount) }]),
        ) as Partial<Record<'OPENED' | 'CLEARED' | 'WRITTEN_OFF', { count: number; amount: number }>>;
        const newCount = activity.OPENED?.count ?? 0;
        const newAmount = activity.OPENED?.amount ?? 0;
        const clearedCount = activity.CLEARED?.count ?? 0;
        const clearedAmount = activity.CLEARED?.amount ?? 0;
        const writtenOffCount = activity.WRITTEN_OFF?.count ?? 0;
        const writtenOffAmount = activity.WRITTEN_OFF?.amount ?? 0;

        const expectedClosingCount = openingCount + newCount - clearedCount - writtenOffCount;
        const expectedClosingAmount = openingAmount + newAmount - clearedAmount - writtenOffAmount;

        const actualResult = await client.query<{ count: string; amount: string }>(
          `SELECT COUNT(*)::text AS count, COALESCE(SUM(amount), 0)::text AS amount
             FROM reconciliation_open_item
            WHERE organization_id = $1 AND account_id = $2 AND status = 'OPEN'`,
          [organizationId, account.account_id],
        );
        const actualClosingCount = Number(actualResult.rows[0]?.count ?? 0);
        const actualClosingAmount = Number(actualResult.rows[0]?.amount ?? 0);

        // Compare rounded to the cent -- NUMERIC(18,2) arithmetic on both sides should already
        // match exactly, but floating-point comparison of two independently-summed paths is
        // exactly the kind of thing worth a tolerance rather than a bitwise ===.
        const amountsTie = Math.abs(actualClosingAmount - expectedClosingAmount) < 0.005;

        if (actualClosingCount !== expectedClosingCount || !amountsTie) {
          discrepancies.push({
            accountId: account.account_id,
            accountIdentifier: account.account_identifier,
            expectedClosingCount,
            actualClosingCount,
            expectedClosingAmount,
            actualClosingAmount,
          });
          continue;
        }

        snapshots.push({
          accountId: account.account_id,
          accountIdentifier: account.account_identifier,
          openingCount,
          openingAmount,
          newCount,
          newAmount,
          clearedCount,
          clearedAmount,
          writtenOffCount,
          writtenOffAmount,
          closingCount: actualClosingCount,
          closingAmount: actualClosingAmount,
        });
      }

      if (discrepancies.length > 0) {
        return { outcome: 'tie_out_failed', discrepancies };
      }

      for (const snapshot of snapshots) {
        await client.query(
          `INSERT INTO reconciliation_period_rollforward
             (id, organization_id, reconciliation_run_id, account_id, opening_count, new_count,
              cleared_count, written_off_count, closing_count, opening_amount, new_amount,
              cleared_amount, written_off_amount, closing_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            randomUUID(),
            organizationId,
            input.runId,
            snapshot.accountId,
            snapshot.openingCount,
            snapshot.newCount,
            snapshot.clearedCount,
            snapshot.writtenOffCount,
            snapshot.closingCount,
            snapshot.openingAmount,
            snapshot.newAmount,
            snapshot.clearedAmount,
            snapshot.writtenOffAmount,
            snapshot.closingAmount,
          ],
        );
      }

      await client.query(
        `UPDATE reconciliation_run SET status = 'CLOSED', closed_at = NOW(), closed_by = $2
          WHERE id = $1`,
        [input.runId, actorUserId],
      );
      // changeset 0062's sync_reconciliation_run_account_terminal_good() trigger fires on this
      // UPDATE too, but its CASE only recognizes the literal 'RECONCILED' -- CLOSED is still the
      // terminal-good outcome for this account+period (a stricter state than RECONCILED, not a
      // different one), so this explicit follow-up corrects it back in the same transaction.
      // Deliberately not a migration touching the trigger function itself: this codebase's own
      // Liquibase --rollback directive can't safely hold a second dollar-quoted PL/pgSQL body
      // (splits on the function's internal semicolons regardless of the changeset's own
      // splitStatements:false -- see changeset 0055's doc comment for the same finding), and a
      // plain DROP FUNCTION rollback would leave 0062's still-applied trigger referencing a
      // dropped function if 0062 itself isn't also rolled back in the same operation.
      await client.query(
        `UPDATE reconciliation_run_account SET is_terminal_good = TRUE WHERE reconciliation_run_id = $1`,
        [input.runId],
      );
      await client.query(
        `INSERT INTO reconciliation_run_event
           (run_id, organization_id, event_type, from_status, to_status, actor)
         VALUES ($1, $2, 'CLOSED', 'RECONCILED', 'CLOSED', $3)`,
        [input.runId, organizationId, input.actorUsername],
      );

      return { outcome: 'closed', snapshots };
    });
  }

  /**
   * Reopens a closed period (PR E.3, plan §3.8): puts the run back to `RECONCILED`, increments
   * `reopen_count`, writes a `REOPENED` event, and -- the part that actually protects downstream
   * audit trails -- marks every *later* closed period's own snapshot for the same accounts
   * `is_stale = true` rather than silently recomputing it. A later period's own numbers are only
   * suspect, not wrong, until someone re-closes it deliberately.
   */
  async reopenRun(
    organizationId: string,
    input: { runId: string; actorUsername: string },
  ): Promise<ReopenRunResult> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const actorUserId = await this.resolveUserId(client, organizationId, input.actorUsername);
      if (!actorUserId) {
        throw new Error(
          `reopenRun: actor username "${input.actorUsername}" has no matching reconciliation_user row.`,
        );
      }

      const runResult = await client.query<{ id: string; status: string; period_end: string | null }>(
        `SELECT id, status, period_end::text AS period_end
           FROM reconciliation_run WHERE id = $1 AND organization_id = $2`,
        [input.runId, organizationId],
      );
      const run = runResult.rows[0];
      if (!run) {
        return { outcome: 'not_found' };
      }
      if (run.status !== 'CLOSED') {
        return { outcome: 'not_closed', status: run.status };
      }

      const updateResult = await client.query<{ reopen_count: number }>(
        `UPDATE reconciliation_run
            SET status = 'RECONCILED', closed_at = NULL, closed_by = NULL,
                reopen_count = reopen_count + 1
          WHERE id = $1
        RETURNING reopen_count`,
        [input.runId],
      );
      const reopenCount = updateResult.rows[0]!.reopen_count;

      await client.query(
        `INSERT INTO reconciliation_run_event
           (run_id, organization_id, event_type, from_status, to_status, actor)
         VALUES ($1, $2, 'REOPENED', 'CLOSED', 'RECONCILED', $3)`,
        [input.runId, organizationId, input.actorUsername],
      );

      // "Later" is determined by declared period_end, not run creation order or database id --
      // period_end is the field PR A introduced specifically to make period comparisons
      // reproducible. A run with no declared period_end (predates PR A, never backfilled) can't
      // be compared, so it's simply excluded rather than treated as either "earlier" or "later".
      let staleSnapshotCount = 0;
      if (run.period_end) {
        const staleResult = await client.query(
          `UPDATE reconciliation_period_rollforward pr
              SET is_stale = TRUE
             FROM reconciliation_run_account ra, reconciliation_run r
            WHERE pr.reconciliation_run_id = r.id
              AND ra.reconciliation_run_id = $1
              AND ra.account_id = pr.account_id
              AND pr.organization_id = $2
              AND r.period_end > $3
              AND pr.is_stale = FALSE`,
          [input.runId, organizationId, run.period_end],
        );
        staleSnapshotCount = staleResult.rowCount ?? 0;
      }

      return { outcome: 'reopened', reopenCount, staleSnapshotCount };
    });
  }

  /**
   * Writes off an open item (PR E.4): sets it to `WRITTEN_OFF` with a required disposition
   * code/note, and logs the transition -- same append-only event trail as every other status
   * change on this entity. Never deletes the row.
   *
   * Two approval controls, added by Issue #283 (B5), which this method previously had none of:
   *
   * 1. DOLLAR BANDS, enforced here. The actor's role is read from the database rather than taken
   *    from the caller -- the API layer knows the authenticated role, but a store that trusts a
   *    caller-supplied role is one internal call away from being bypassed, and the role is a
   *    single column on a row this method already has to load.
   * 2. SEGREGATION OF DUTY, enforced by the database (changeset 0075). Whoever submitted the run
   *    that opened this item may not write it off. This method does not re-implement that check:
   *    it performs the UPDATE and translates the trigger's rejection, so the control holds for
   *    every write path including psql, not just this one.
   *
   * The ordering is deliberate. The band check runs first and returns without writing, so an
   * under-authorised actor gets a specific answer rather than a generic constraint failure; the
   * segregation check can only be evaluated by the database, so it necessarily surfaces as a
   * caught error rather than a pre-check.
   *
   * Age bands were part of the same policy question and are NOT implemented -- Issue #283 settled
   * dollar thresholds only. `original_transaction_date` is on the row when that answer arrives.
   */
  async writeOffOpenItem(
    organizationId: string,
    input: {
      openItemId: string;
      reconciliationRunId?: string;
      actorUsername: string;
      dispositionCode: string;
      dispositionNote?: string;
    },
  ): Promise<WriteOffOpenItemResult> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const actorResult = await client.query<{ id: string; role: UserRole }>(
        'SELECT id, role FROM reconciliation_user WHERE user_name = $1 AND organization_id = $2',
        [input.actorUsername, organizationId],
      );
      const actor = actorResult.rows[0];
      if (!actor) {
        throw new Error(
          `writeOffOpenItem: actor username "${input.actorUsername}" has no matching reconciliation_user row.`,
        );
      }

      // `amount` is NUMERIC; pg returns it as a string to avoid the float64 rounding that would
      // otherwise decide band membership at the threshold. Cast in SQL so the intent is explicit
      // rather than relying on the driver's default type mapping.
      const existing = await client.query<{ status: string; amount: string }>(
        `SELECT status, amount::text AS amount
           FROM reconciliation_open_item
          WHERE id = $1 AND organization_id = $2`,
        [input.openItemId, organizationId],
      );
      const current = existing.rows[0];
      if (!current) {
        return { outcome: 'not_found' };
      }
      if (current.status !== 'OPEN') {
        return { outcome: 'not_open', status: current.status };
      }

      const amount = Number(current.amount);
      if (!canApproveWriteOff(actor.role, amount)) {
        return {
          outcome: 'insufficient_authority',
          amount,
          requiredRoleLabel: writeOffBandForAmount(amount).requiredRoleLabel,
        };
      }

      try {
        await client.query(
          `UPDATE reconciliation_open_item
              SET status = 'WRITTEN_OFF', disposition_code = $2, disposition_note = $3,
                  written_off_by = $4
            WHERE id = $1`,
          [input.openItemId, input.dispositionCode, input.dispositionNote ?? null, actor.id],
        );
      } catch (error) {
        // Only the named segregation rejection is a policy outcome. The sibling
        // approver-recorded CHECK shares SQLSTATE 23514 but means this code failed to set
        // written_off_by, which is a bug and must not be reported to the user as a control.
        const constraint = (error as { constraint?: string }).constraint;
        if (constraint === 'reconciliation_open_item_writeoff_segregation_of_duty') {
          return { outcome: 'segregation_of_duty' };
        }
        throw error;
      }
      await client.query(
        `INSERT INTO reconciliation_open_item_event
           (open_item_id, organization_id, run_id, event_type, from_status, to_status, actor,
            details_json)
         VALUES ($1, $2, $3, 'WRITTEN_OFF', 'OPEN', 'WRITTEN_OFF', $4, $5)`,
        [
          input.openItemId,
          organizationId,
          input.reconciliationRunId ?? null,
          input.actorUsername,
          JSON.stringify({ dispositionCode: input.dispositionCode, dispositionNote: input.dispositionNote ?? null }),
        ],
      );

      return { outcome: 'written_off' };
    });
  }

  /**
   * PR F.2: what backs `GET /api/reconciliation/runs/:id/rollforward` -- the frozen snapshot(s)
   * a CLOSED run produced (empty array for a run that was never closed, since
   * `reconciliation_period_rollforward` rows only exist post-close), plus this run's own
   * contribution to the ledger: which items it opened and which it cleared. `null` only when the
   * run itself doesn't exist (or isn't RLS-visible) -- a real run with no snapshot yet still
   * returns a result, just with an empty `snapshots` array.
   */
  async getRunRollforward(
    organizationId: string,
    runId: string,
  ): Promise<{
    snapshots: PeriodRollforwardSnapshot[];
    openedThisRun: OpenItemRecord[];
    clearedThisRun: OpenItemRecord[];
  } | null> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const runResult = await client.query<{ id: string }>(
        `SELECT id FROM reconciliation_run WHERE id = $1 AND organization_id = $2`,
        [runId, organizationId],
      );
      if (!runResult.rows[0]) {
        return null;
      }

      const snapshotResult = await client.query<{
        account_id: string;
        account_identifier: string;
        opening_count: number;
        opening_amount: string;
        new_count: number;
        new_amount: string;
        cleared_count: number;
        cleared_amount: string;
        written_off_count: number;
        written_off_amount: string;
        closing_count: number;
        closing_amount: string;
      }>(
        `SELECT pr.account_id, a.account_identifier, pr.opening_count, pr.opening_amount,
                pr.new_count, pr.new_amount, pr.cleared_count, pr.cleared_amount,
                pr.written_off_count, pr.written_off_amount, pr.closing_count, pr.closing_amount
           FROM reconciliation_period_rollforward pr
           JOIN reconciliation_account a ON a.id = pr.account_id
          WHERE pr.reconciliation_run_id = $1 AND pr.organization_id = $2
          ORDER BY a.account_identifier`,
        [runId, organizationId],
      );
      const snapshots: PeriodRollforwardSnapshot[] = snapshotResult.rows.map((row) => ({
        accountId: row.account_id,
        accountIdentifier: row.account_identifier,
        openingCount: row.opening_count,
        openingAmount: Number(row.opening_amount),
        newCount: row.new_count,
        newAmount: Number(row.new_amount),
        clearedCount: row.cleared_count,
        clearedAmount: Number(row.cleared_amount),
        writtenOffCount: row.written_off_count,
        writtenOffAmount: Number(row.written_off_amount),
        closingCount: row.closing_count,
        closingAmount: Number(row.closing_amount),
      }));

      const loadOpenItemsByRunColumn = async (column: 'opened_in_run_id' | 'cleared_in_run_id') => {
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
            WHERE oi.${column} = $1 AND oi.organization_id = $2
            ORDER BY a.account_identifier, oi.original_transaction_date`,
          [runId, organizationId],
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
      };

      // Sequential, not Promise.all -- every other multi-query method in this store awaits one
      // client.query at a time, matching the convention the rest of the codebase relies on for
      // reasoning about a single PoolClient's query order.
      const openedThisRun = await loadOpenItemsByRunColumn('opened_in_run_id');
      const clearedThisRun = await loadOpenItemsByRunColumn('cleared_in_run_id');

      return { snapshots, openedThisRun, clearedThisRun };
    });
  }

  /**
   * PR F.4: what backs the open-items schedule view -- the read-only replacement for the
   * spreadsheet support schedule `packages/domain/src/messages.ts` currently tells reviewers to
   * keep by hand. Every item regardless of status by default (a reviewer needs to see what
   * cleared/was written off, not just what's still open), narrowable by account and/or status.
   * `ageInDays` is computed here (CURRENT_DATE - original_transaction_date), not carried from any
   * run's own anchor date -- this view has no single run to anchor to, it spans every period.
   * `ownerUsername` is resolved via the same bounded, already-scoped join
   * `resolveUsernamesByIds`/`resolveUserId` use elsewhere in this store -- always null today since
   * nothing yet assigns `owner_user_id` (no write path exists; this is a read-only view).
   */
  async listOpenItemsSchedule(
    organizationId: string,
    filters: { accountIdentifier?: string; status?: string },
  ): Promise<
    Array<{
      id: string;
      accountIdentifier: string;
      sourceSystem: SourceSystem;
      category: ErrorCategory;
      status: string;
      naturalKey: string;
      naturalKeyTier: NaturalKeyTier;
      originalTransactionDate: string;
      amount: number;
      checkNumber?: string;
      referenceNumber?: string;
      descriptionSnapshot?: string;
      ageInDays: number;
      ownerUsername?: string;
      dueDate?: string;
      dispositionCode?: string;
      dispositionNote?: string;
    }>
  > {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const conditions = ['oi.organization_id = $1'];
      const params: unknown[] = [organizationId];

      if (filters.accountIdentifier !== undefined) {
        params.push(filters.accountIdentifier);
        conditions.push(`a.account_identifier = $${params.length}`);
      }
      if (filters.status !== undefined) {
        params.push(filters.status);
        conditions.push(`oi.status = $${params.length}`);
      }

      const result = await client.query<{
        id: string;
        account_identifier: string;
        source_system: SourceSystem;
        category: ErrorCategory;
        status: string;
        natural_key: string;
        natural_key_tier: NaturalKeyTier;
        original_transaction_date: string;
        amount: string;
        check_number: string | null;
        reference_number: string | null;
        description_snapshot: string | null;
        age_in_days: number;
        owner_username: string | null;
        due_date: string | null;
        disposition_code: string | null;
        disposition_note: string | null;
      }>(
        `SELECT oi.id, a.account_identifier, oi.source_system, oi.category, oi.status,
                oi.natural_key, oi.natural_key_tier,
                oi.original_transaction_date::text AS original_transaction_date,
                oi.amount, oi.check_number, oi.reference_number, oi.description_snapshot,
                (CURRENT_DATE - oi.original_transaction_date) AS age_in_days,
                owner.user_name AS owner_username,
                oi.due_date::text AS due_date, oi.disposition_code, oi.disposition_note
           FROM reconciliation_open_item oi
           JOIN reconciliation_account a ON a.id = oi.account_id
           LEFT JOIN reconciliation_user owner ON owner.id = oi.owner_user_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY age_in_days DESC, a.account_identifier`,
        params,
      );

      return result.rows.map((row) => ({
        id: row.id,
        accountIdentifier: row.account_identifier,
        sourceSystem: row.source_system,
        category: row.category,
        status: row.status,
        naturalKey: row.natural_key,
        naturalKeyTier: row.natural_key_tier,
        originalTransactionDate: row.original_transaction_date,
        amount: Number(row.amount),
        checkNumber: row.check_number ?? undefined,
        referenceNumber: row.reference_number ?? undefined,
        descriptionSnapshot: row.description_snapshot ?? undefined,
        ageInDays: row.age_in_days,
        ownerUsername: row.owner_username ?? undefined,
        dueDate: row.due_date ?? undefined,
        dispositionCode: row.disposition_code ?? undefined,
        dispositionNote: row.disposition_note ?? undefined,
      }));
    });
  }
}
