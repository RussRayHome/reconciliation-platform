import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { runInTenantScope, runInTenantScopeAsUser } from './postgres';

export type ImportSeverity = 'ERROR' | 'WARNING';

/** Structurally compatible with @recon/core's `ValidationIssue` -- packages/persistence
 * deliberately does not depend on @recon/core (see each package's package.json: neither lists
 * the other), so this is a duck-typed local shape a caller's FileValidationOutcome.issues already
 * satisfies, not an import. */
export interface ValidationIssueInput {
  severity: ImportSeverity;
  code: string;
  field?: string;
  rowNumber?: number;
  entryId?: string;
  message: string;
}

/** Structurally compatible with @recon/core's `NormalizedRecord`, same reasoning as above. */
export interface CanonicalRecordInput {
  sourceType: 'BANK' | 'GL';
  recordId: string;
  account: string;
  date: string;
  currencyCode: string;
  signedAmount: number;
  direction: 'INFLOW' | 'OUTFLOW';
  magnitude: number;
  description: string;
  reference?: string;
  sourceLineNumber: number;
  raw: unknown;
}

export type SubmitRunResult =
  | { outcome: 'not_found' }
  | { outcome: 'invalid_state'; currentStatus: string }
  | { outcome: 'submitted'; importJobId: string };

/** The three reconciliation_run statuses that represent an approval decision in flight or made --
 * the other five (DRAFT/VALIDATING/VALIDATION_FAILED/RECONCILING/RECONCILED) never reach the
 * Approvals surface, matching how reconciliation_import_approval only ever has PENDING/APPROVED/
 * REJECTED/OVERRIDDEN rows (a run has no OVERRIDDEN equivalent -- decided_by/decided_at only ever
 * get set once, by recordRunApprovalDecision, never overwritten after the fact). */
export type RunApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface RunApprovalListItem {
  id: string;
  label: string;
  frequency: 'MONTHLY' | 'ANNUAL';
  periodYear: number;
  periodMonth: number | null;
  status: RunApprovalStatus;
  /** Resolved from submitted_by/decided_by (UUID FKs, changeset 0042/0024) back to
   * reconciliation_user.user_name for display -- falls back to the raw id string if the id
   * doesn't resolve (should not happen in practice: these ids only ever come from a prior
   * successful submitRun/claimRunApproval/recordRunApprovalDecision resolution). */
  submittedByUsername: string;
  decidedByUsername: string | null;
  decisionNote: string | null;
  submittedAt: string;
  decidedAt: string | null;
}

export interface ListRunApprovalsFilter {
  status?: RunApprovalStatus;
  submittedByUsername?: string;
  /** RailMenuMods "everything routed to me + unassigned" pending-queue rule, same semantics as
   * ListImportApprovalsFilter.routedToOrUnassigned. */
  routedToOrUnassignedUsername?: string;
}

export interface RunApprovalCounts {
  pending: number;
  approved: number;
  rejected: number;
  mySubmissions: number;
}

export type ClaimRunApprovalResult = { outcome: 'claimed' } | { outcome: 'not_claimable' };

export interface RecordRunApprovalDecisionInput {
  runId: string;
  toStatus: Extract<RunApprovalStatus, 'APPROVED' | 'REJECTED'>;
  actorUsername: string;
  rationale?: string;
}

export type RunApprovalDecisionResult =
  | { outcome: 'not_found' }
  | { outcome: 'decided'; item: RunApprovalListItem };

export type FileValidationStatus = 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';

export interface RecordFileValidationOutcomeInput {
  importJobId: string;
  importFileId: string;
  reconciliationRunId: string;
  totalRowCount: number;
  issues: ValidationIssueInput[];
  normalized: CanonicalRecordInput[];
}

export interface RecordFileValidationOutcomeResult {
  validationStatus: FileValidationStatus;
  errorCount: number;
  warningCount: number;
}

/** One validation_issue row, for the Phase 8 review-drilldown endpoints. */
export interface RunIssueItem {
  id: string;
  importFileId: string;
  severity: ImportSeverity;
  code: string;
  rowNumber: number | null;
  entryId: string | null;
  field: string | null;
  message: string;
  createdAt: string;
}

export interface RunIssuesFilter {
  severity?: ImportSeverity;
  code?: string;
  importFileId?: string;
}

export interface PaginatedRunIssuesResult {
  items: RunIssueItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** One canonical_record row, for the Phase 8 review-drilldown endpoints. */
export interface RunRecordItem {
  id: string;
  importFileId: string;
  sourceType: string;
  recordId: string;
  sourceLineNumber: number;
  account: string;
  txnDate: string;
  currencyCode: string;
  signedAmount: string;
  direction: 'INFLOW' | 'OUTFLOW';
  magnitude: string;
  excluded: boolean;
  exclusionReason: string | null;
  description: string;
  referenceIds: unknown;
  counterpartyType: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  valueDate: string | null;
  effectiveDate: string | null;
  evidence: unknown;
  createdAt: string;
}

export interface RunRecordsFilter {
  sourceType?: string;
  importFileId?: string;
}

export interface PaginatedRunRecordsResult {
  items: RunRecordItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Persistence for Phase 6 (submit & async validation): the DRAFT -> VALIDATING -> (VALIDATION_
 * FAILED | PENDING_APPROVAL) transition, `import_job` lifecycle, and the `validation_issue`/
 * `canonical_record` rows the File Validation Engine's output becomes. Deliberately split into
 * small, independently-committed transactions per method rather than one transaction spanning an
 * entire validation run -- the worker calling this does real CPU work (parsing, validation) and
 * calls out to the existing GL<->Bank matching pipeline (which manages its own transactions)
 * between these calls, and holding one DB transaction open across all of that would tie up a pool
 * connection for the worker's full run time for no atomicity benefit: each file's outcome is
 * already independent (fileValidationEngine.ts's own doc comment), and import_job.attempts exists
 * specifically so a failure partway through is retryable rather than needing all-or-nothing.
 */
export class PostgresImportValidationStore {
  constructor(private readonly pool: Pool) {}

  /** DRAFT -> VALIDATING, stamps submitted_by/submitted_at, creates the QUEUED import_job.
   * submittedByUserName resolves to reconciliation_user.id for submitted_by (a UUID FK, changeset
   * 0042/0024 -- not the user_name primary key) -- left NULL if it doesn't resolve to a real row
   * (e.g. the local-login-fallback dev users, which aren't real DB rows), matching how
   * recordLoginEvent already tolerates that case elsewhere rather than failing the request.
   * Row-locks the run first (FOR UPDATE) so a state check and its subsequent update can't race
   * against a second concurrent submit. */
  async submitRun(
    organizationId: string,
    runId: string,
    submittedByUserName: string,
  ): Promise<SubmitRunResult> {
    return runInTenantScopeAsUser(this.pool, organizationId, submittedByUserName, async (client) => {
      const runResult = await client.query<{ status: string }>(
        'SELECT status FROM reconciliation_run WHERE id = $1 FOR UPDATE',
        [runId],
      );
      const runRow = runResult.rows[0];
      if (!runRow) {
        return { outcome: 'not_found' };
      }
      if (runRow.status !== 'DRAFT') {
        return { outcome: 'invalid_state', currentStatus: runRow.status };
      }

      const userResult = await client.query<{ id: string }>(
        'SELECT id FROM reconciliation_user WHERE user_name = $1 AND organization_id = $2',
        [submittedByUserName, organizationId],
      );
      const submittedByUserId = userResult.rows[0]?.id ?? null;

      await client.query(
        `UPDATE reconciliation_run
            SET status = 'VALIDATING', submitted_by = $1, submitted_at = NOW()
          WHERE id = $2`,
        [submittedByUserId, runId],
      );

      const importJobId = randomUUID();
      await client.query(
        `INSERT INTO import_job (id, organization_id, reconciliation_run_id, status)
         VALUES ($1, $2, $3, 'QUEUED')`,
        [importJobId, organizationId, runId],
      );

      return { outcome: 'submitted', importJobId };
    });
  }

  async markJobRunning(organizationId: string, importJobId: string, workerId: string): Promise<void> {
    await runInTenantScope(this.pool, organizationId, (client) =>
      client.query(
        `UPDATE import_job
            SET status = 'RUNNING', worker_id = $1, started_at = NOW(), attempts = attempts + 1
          WHERE id = $2`,
        [workerId, importJobId],
      ),
    );
  }

  async markJobFailed(organizationId: string, importJobId: string, errorSummary: string): Promise<void> {
    await runInTenantScope(this.pool, organizationId, (client) =>
      client.query(
        `UPDATE import_job SET status = 'FAILED', error_summary = $1, finished_at = NOW()
          WHERE id = $2`,
        // Truncated defensively -- error_summary is diagnostic text, not an audit record, and an
        // unbounded exception message (e.g. a stack trace someone rethrew) shouldn't be able to
        // bloat a row.
        [errorSummary.slice(0, 2000), importJobId],
      ),
    );
  }

  /** validation_rule_version (changeset 0047) has no organization_id -- it's a global platform
   * catalog, not tenant data -- so the tenant GUC this sets doesn't gate anything here. Still
   * routed through runInTenantScope rather than a bare pool.query so every query goes through the
   * same least-privilege connection path, and so this keeps working unchanged if the table is
   * ever made tenant-scoped later. */
  async loadActiveValidationRuleVersionIds(organizationId: string): Promise<Map<string, string>> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const result = await client.query<{ rule_code: string; id: string }>(
        `SELECT rule_code, id FROM validation_rule_version WHERE status = 'ACTIVE'`,
      );
      return new Map(result.rows.map((row) => [row.rule_code, row.id]));
    });
  }

  /** Persists one file's validation_issue rows + canonical_record rows (one per row that
   * individually passed Step 3, regardless of the file's overall pass/fail -- this is what makes
   * partial import possible, matching fileValidationEngine.ts's own doc comment) and updates that
   * file's import_file status/counts/date range. ruleVersionIdsByCode should come from
   * loadActiveValidationRuleVersionIds, loaded once per job and reused across both files rather
   * than re-queried per issue. */
  async recordFileValidationOutcome(
    organizationId: string,
    input: RecordFileValidationOutcomeInput,
    ruleVersionIdsByCode: Map<string, string>,
  ): Promise<RecordFileValidationOutcomeResult> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      for (const issue of input.issues) {
        const ruleVersionId = ruleVersionIdsByCode.get(issue.code);
        if (!ruleVersionId) {
          throw new Error(
            `No ACTIVE validation_rule_version row for code "${issue.code}" -- ` +
              'the seed (changeset 0047) is out of sync with ruleCatalog.ts.',
          );
        }

        await client.query(
          `INSERT INTO validation_issue
             (organization_id, import_job_id, import_file_id, rule_version_id, severity, code,
              row_number, entry_id, field, message)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            organizationId,
            input.importJobId,
            input.importFileId,
            ruleVersionId,
            issue.severity,
            issue.code,
            issue.rowNumber ?? null,
            issue.entryId ?? null,
            issue.field ?? null,
            issue.message,
          ],
        );
      }

      for (const record of input.normalized) {
        await client.query(
          `INSERT INTO canonical_record
             (organization_id, import_job_id, import_file_id, reconciliation_run_id, source_type,
              record_id, source_line_number, account, txn_date, currency_code, signed_amount,
              direction, magnitude, description, reference_ids, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb)`,
          [
            organizationId,
            input.importJobId,
            input.importFileId,
            input.reconciliationRunId,
            record.sourceType,
            record.recordId,
            record.sourceLineNumber,
            record.account,
            record.date,
            record.currencyCode,
            record.signedAmount,
            record.direction,
            record.magnitude,
            record.description,
            record.reference ? JSON.stringify({ reference: record.reference }) : null,
            JSON.stringify(record.raw),
          ],
        );
      }

      const errorCount = input.issues.filter((issue) => issue.severity === 'ERROR').length;
      const warningCount = input.issues.filter((issue) => issue.severity === 'WARNING').length;
      const validationStatus: FileValidationStatus =
        errorCount > 0 ? 'INVALID' : warningCount > 0 ? 'VALID_WITH_WARNINGS' : 'VALID';

      const dateRange = input.normalized.reduce<{ start: string | null; end: string | null }>(
        (range, record) => ({
          start: range.start === null || record.date < range.start ? record.date : range.start,
          end: range.end === null || record.date > range.end ? record.date : range.end,
        }),
        { start: null, end: null },
      );

      await client.query(
        `UPDATE import_file
            SET validation_status = $1, row_count = $2, error_count = $3, warning_count = $4,
                date_range_start = $5, date_range_end = $6
          WHERE id = $7`,
        [
          validationStatus,
          input.totalRowCount,
          errorCount,
          warningCount,
          dateRange.start,
          dateRange.end,
          input.importFileId,
        ],
      );

      return { validationStatus, errorCount, warningCount };
    });
  }

  /** Marks the run VALIDATION_FAILED or PENDING_APPROVAL (never gates the matching pipeline --
   * see reconciliation_run's own table comment, changeset 0042) and the job SUCCEEDED: the worker
   * did its job correctly either way, whether or not the files themselves turned out valid. */
  async finalizeRun(organizationId: string, runId: string, importJobId: string, input: { passed: boolean }): Promise<void> {
    await runInTenantScope(this.pool, organizationId, async (client) => {
      await client.query(`UPDATE reconciliation_run SET status = $1 WHERE id = $2`, [
        input.passed ? 'PENDING_APPROVAL' : 'VALIDATION_FAILED',
        runId,
      ]);
      await client.query(`UPDATE import_job SET status = 'SUCCEEDED', finished_at = NOW() WHERE id = $1`, [
        importJobId,
      ]);
    });
  }

  /** Links reconciliation_run to the id the existing matching pipeline produced (see changeset
   * 0048's own comment: that id doubles as both the ReconciliationRun.id returned to the caller
   * and the reconciliation_job.id it registers under). Called after finalizeRun, once matching
   * has actually fired -- kept as its own update rather than folded into finalizeRun since
   * matching only ever runs when input.passed was true there. */
  async recordMatchingJobId(organizationId: string, runId: string, matchingJobId: string): Promise<void> {
    await runInTenantScope(this.pool, organizationId, (client) =>
      client.query(`UPDATE reconciliation_run SET matching_job_id = $1 WHERE id = $2`, [
        matchingJobId,
        runId,
      ]),
    );
  }

  /** Phase 12 (Screen 06): accepts a VALIDATION_FAILED run's already-passing rows and moves it to
   * PENDING_APPROVAL -- the caller triggers matching afterward, same as a run that passed outright
   * (recordMatchingJobId is still the right next call). Guarded here, atomically with the FOR
   * UPDATE lock, against the two cases Screen 06 doesn't apply to: a structural (HEADER/
   * COLUMN_ORDER) gate failure has no per-row detail to accept, and a file with zero importable
   * rows has nothing to accept either -- both are Screen 05/07's territory, not this one's. */
  async acceptPartialImport(
    organizationId: string,
    runId: string,
  ): Promise<
    | { outcome: 'not_found' }
    | { outcome: 'invalid_state'; currentStatus: string }
    | { outcome: 'structural_failure'; importFileId: string }
    | { outcome: 'no_importable_rows'; importFileId: string }
    | { outcome: 'accepted' }
  > {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const runResult = await client.query<{ status: string }>(
        'SELECT status FROM reconciliation_run WHERE id = $1 FOR UPDATE',
        [runId],
      );
      const runRow = runResult.rows[0];
      if (!runRow) {
        return { outcome: 'not_found' as const };
      }
      if (runRow.status !== 'VALIDATION_FAILED') {
        return { outcome: 'invalid_state' as const, currentStatus: runRow.status };
      }

      const filesResult = await client.query<{ id: string; validation_status: string }>(
        `SELECT f.id, f.validation_status
           FROM run_source_file rsf
           JOIN import_file f ON f.id = rsf.import_file_id
          WHERE rsf.reconciliation_run_id = $1`,
        [runId],
      );

      for (const file of filesResult.rows) {
        if (file.validation_status !== 'INVALID') {
          continue;
        }

        const structuralResult = await client.query(
          `SELECT 1 FROM validation_issue
            WHERE import_file_id = $1 AND severity = 'ERROR'
              AND code IN ('STRUCT_HEADER_MISSING', 'STRUCT_COLUMN_MISSING', 'STRUCT_COLUMN_ORDER')
            LIMIT 1`,
          [file.id],
        );
        if ((structuralResult.rowCount ?? 0) > 0) {
          return { outcome: 'structural_failure' as const, importFileId: file.id };
        }

        const importableResult = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM canonical_record WHERE import_file_id = $1`,
          [file.id],
        );
        if (Number(importableResult.rows[0]?.count ?? '0') === 0) {
          return { outcome: 'no_importable_rows' as const, importFileId: file.id };
        }
      }

      await client.query(`UPDATE reconciliation_run SET status = 'PENDING_APPROVAL' WHERE id = $1`, [
        runId,
      ]);

      return { outcome: 'accepted' as const };
    });
  }

  /** Paginated validation_issue rows for a run's review drilldown (Phase 8). validation_issue has
   * no reconciliation_run_id column of its own (only import_job_id/import_file_id, changeset
   * 0042) -- submitRun only ever creates one import_job per run today (DRAFT -> VALIDATING is a
   * one-way gate, no resubmit path exists), but the subquery scopes by run rather than assuming
   * that 1:1 shape, so it stays correct if a retry path is added later. Returns null when the run
   * itself doesn't exist/isn't visible under this tenant's RLS scope, so the route can 404 instead
   * of silently returning an empty page. */
  async listRunIssues(
    organizationId: string,
    runId: string,
    limit: number,
    offset: number,
    filters: RunIssuesFilter = {},
  ): Promise<PaginatedRunIssuesResult | null> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const runResult = await client.query('SELECT 1 FROM reconciliation_run WHERE id = $1', [runId]);
      if (runResult.rowCount === 0) {
        return null;
      }

      const conditions = [
        'import_job_id IN (SELECT id FROM import_job WHERE reconciliation_run_id = $1)',
      ];
      const filterParams: unknown[] = [runId];

      if (filters.severity) {
        filterParams.push(filters.severity);
        conditions.push(`severity = $${filterParams.length}`);
      }
      if (filters.code) {
        filterParams.push(filters.code);
        conditions.push(`code = $${filterParams.length}`);
      }
      if (filters.importFileId) {
        filterParams.push(filters.importFileId);
        conditions.push(`import_file_id = $${filterParams.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const itemsResult = await client.query<{
        id: string;
        import_file_id: string;
        severity: ImportSeverity;
        code: string;
        row_number: number | null;
        entry_id: string | null;
        field: string | null;
        message: string;
        created_at: string;
      }>(
        `SELECT id, import_file_id, severity, code, row_number, entry_id, field, message, created_at
           FROM validation_issue
          WHERE ${whereClause}
          ORDER BY id ASC
          LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
        [...filterParams, limit, offset],
      );
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM validation_issue WHERE ${whereClause}`,
        filterParams,
      );

      const total = Number(countResult.rows[0]?.count ?? '0');
      const items: RunIssueItem[] = itemsResult.rows.map((row) => ({
        id: row.id,
        importFileId: row.import_file_id,
        severity: row.severity,
        code: row.code,
        rowNumber: row.row_number,
        entryId: row.entry_id,
        field: row.field,
        message: row.message,
        createdAt: row.created_at,
      }));

      return { items, total, limit, offset, hasMore: offset + items.length < total };
    });
  }

  /** Paginated canonical_record rows for a run's review drilldown (Phase 8). Unlike
   * validation_issue, canonical_record denormalizes reconciliation_run_id directly (changeset
   * 0042's own comment: "purely for query convenience"), so this filters on it straight rather
   * than going through import_job. Returns null when the run doesn't exist/isn't visible, same as
   * listRunIssues. */
  async listRunRecords(
    organizationId: string,
    runId: string,
    limit: number,
    offset: number,
    filters: RunRecordsFilter = {},
  ): Promise<PaginatedRunRecordsResult | null> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const runResult = await client.query('SELECT 1 FROM reconciliation_run WHERE id = $1', [runId]);
      if (runResult.rowCount === 0) {
        return null;
      }

      const conditions = ['reconciliation_run_id = $1'];
      const filterParams: unknown[] = [runId];

      if (filters.sourceType) {
        filterParams.push(filters.sourceType);
        conditions.push(`source_type = $${filterParams.length}`);
      }
      if (filters.importFileId) {
        filterParams.push(filters.importFileId);
        conditions.push(`import_file_id = $${filterParams.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const itemsResult = await client.query<{
        id: string;
        import_file_id: string;
        source_type: string;
        record_id: string;
        source_line_number: number;
        account: string;
        txn_date: string;
        currency_code: string;
        signed_amount: string;
        direction: 'INFLOW' | 'OUTFLOW';
        magnitude: string;
        excluded: boolean;
        exclusion_reason: string | null;
        description: string;
        reference_ids: unknown;
        counterparty_type: string | null;
        counterparty_id: string | null;
        counterparty_name: string | null;
        value_date: string | null;
        effective_date: string | null;
        evidence: unknown;
        created_at: string;
      }>(
        `SELECT id, import_file_id, source_type, record_id, source_line_number, account, txn_date,
                currency_code, signed_amount, direction, magnitude, excluded, exclusion_reason,
                description, reference_ids, counterparty_type, counterparty_id, counterparty_name,
                value_date, effective_date, evidence, created_at
           FROM canonical_record
          WHERE ${whereClause}
          ORDER BY source_line_number ASC, id ASC
          LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
        [...filterParams, limit, offset],
      );
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM canonical_record WHERE ${whereClause}`,
        filterParams,
      );

      const total = Number(countResult.rows[0]?.count ?? '0');
      const items: RunRecordItem[] = itemsResult.rows.map((row) => ({
        id: row.id,
        importFileId: row.import_file_id,
        sourceType: row.source_type,
        recordId: row.record_id,
        sourceLineNumber: row.source_line_number,
        account: row.account,
        txnDate: row.txn_date,
        currencyCode: row.currency_code,
        signedAmount: row.signed_amount,
        direction: row.direction,
        magnitude: row.magnitude,
        excluded: row.excluded,
        exclusionReason: row.exclusion_reason,
        description: row.description,
        referenceIds: row.reference_ids,
        counterpartyType: row.counterparty_type,
        counterpartyId: row.counterparty_id,
        counterpartyName: row.counterparty_name,
        valueDate: row.value_date,
        effectiveDate: row.effective_date,
        evidence: row.evidence,
        createdAt: row.created_at,
      }));

      return { items, total, limit, offset, hasMore: offset + items.length < total };
    });
  }

  /** Single-row lookup by user_name AND organization_id -- the same narrow, already-tenant-scoped
   * shape submitRun already uses (see reconciliationUserAccessGuard.test.ts's allowlist entry for
   * this file: never a list/filter across reconciliation_user, which has RLS fully disabled). */
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

  /** Resolves display usernames for a bounded, already-known set of ids (the submitted_by/
   * decided_by values that came back from an already-tenant-scoped reconciliation_run query) --
   * WHERE id = ANY(...), never an unbounded list/filter of reconciliation_user itself, same
   * reasoning as resolveUserId above. */
  private async resolveUsernamesByIds(
    client: PoolClient,
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const result = await client.query<{ id: string; user_name: string }>(
      'SELECT id, user_name FROM reconciliation_user WHERE id = ANY($1::uuid[]) AND organization_id = $2',
      [ids, organizationId],
    );
    return new Map(result.rows.map((row) => [row.id, row.user_name]));
  }

  private toRunApprovalListItem(
    row: {
      id: string;
      label: string;
      frequency: 'MONTHLY' | 'ANNUAL';
      period_year: number;
      period_month: number | null;
      status: RunApprovalStatus;
      submitted_by: string;
      decided_by: string | null;
      decision_note: string | null;
      submitted_at: string;
      decided_at: string | null;
    },
    usernamesById: Map<string, string>,
  ): RunApprovalListItem {
    return {
      id: row.id,
      label: row.label,
      frequency: row.frequency,
      periodYear: row.period_year,
      periodMonth: row.period_month,
      status: row.status,
      submittedByUsername: usernamesById.get(row.submitted_by) ?? row.submitted_by,
      decidedByUsername: row.decided_by ? (usernamesById.get(row.decided_by) ?? row.decided_by) : null,
      decisionNote: row.decision_note,
      submittedAt: row.submitted_at,
      decidedAt: row.decided_at,
    };
  }

  /** Lists reconciliation_run rows that have reached the Approvals surface (PENDING_APPROVAL/
   * APPROVED/REJECTED only -- DRAFT/VALIDATING/VALIDATION_FAILED/RECONCILING/RECONCILED never
   * show up here, same "only decided-relevant statuses" scoping as listImportApprovals). */
  async listRunApprovals(
    organizationId: string,
    filter: ListRunApprovalsFilter,
  ): Promise<RunApprovalListItem[]> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const submittedByUserId = filter.submittedByUsername
        ? await this.resolveUserId(client, organizationId, filter.submittedByUsername)
        : null;
      const routedToOrUnassignedUserId = filter.routedToOrUnassignedUsername
        ? await this.resolveUserId(client, organizationId, filter.routedToOrUnassignedUsername)
        : null;

      const result = await client.query<{
        id: string;
        label: string;
        frequency: 'MONTHLY' | 'ANNUAL';
        period_year: number;
        period_month: number | null;
        status: RunApprovalStatus;
        submitted_by: string;
        decided_by: string | null;
        decision_note: string | null;
        submitted_at: string;
        decided_at: string | null;
      }>(
        `SELECT id, label, frequency, period_year, period_month, status, submitted_by, decided_by,
                decision_note, submitted_at, decided_at
           FROM reconciliation_run
          WHERE status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')
            AND ($1::text IS NULL OR status = $1)
            AND ($2::uuid IS NULL OR submitted_by = $2)
            AND ($3::uuid IS NULL OR decided_by = $3 OR decided_by IS NULL)
          ORDER BY submitted_at DESC`,
        [filter.status ?? null, submittedByUserId, routedToOrUnassignedUserId],
      );

      const userIds = [
        ...new Set(
          result.rows.flatMap((row) => [row.submitted_by, row.decided_by]).filter((id): id is string => !!id),
        ),
      ];
      const usernamesById = await this.resolveUsernamesByIds(client, organizationId, userIds);

      return result.rows.map((row) => this.toRunApprovalListItem(row, usernamesById));
    });
  }

  /** Mirrors getImportApprovalCounts exactly: an approver's pending count only shows unclaimed-or
   * -mine, but their approved/rejected counts are org-wide; a non-approver only ever sees their
   * own submissions. */
  async getRunApprovalCounts(
    organizationId: string,
    username: string,
    canApprove: boolean,
  ): Promise<RunApprovalCounts> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const userId = await this.resolveUserId(client, organizationId, username);
      const result = await client.query<{
        pending: string;
        approved: string;
        rejected: string;
        my_submissions: string;
      }>(
        canApprove
          ? `SELECT
               COUNT(*) FILTER (WHERE status = 'PENDING_APPROVAL' AND (decided_by = $1 OR decided_by IS NULL)) AS pending,
               COUNT(*) FILTER (WHERE status = 'APPROVED') AS approved,
               COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected,
               COUNT(*) FILTER (WHERE submitted_by = $1) AS my_submissions
             FROM reconciliation_run`
          : `SELECT
               COUNT(*) FILTER (WHERE status = 'PENDING_APPROVAL' AND submitted_by = $1) AS pending,
               COUNT(*) FILTER (WHERE status = 'APPROVED' AND submitted_by = $1) AS approved,
               COUNT(*) FILTER (WHERE status = 'REJECTED' AND submitted_by = $1) AS rejected,
               COUNT(*) FILTER (WHERE submitted_by = $1) AS my_submissions
             FROM reconciliation_run`,
        [userId],
      );
      const row = result.rows[0];
      return {
        pending: Number(row?.pending ?? 0),
        approved: Number(row?.approved ?? 0),
        rejected: Number(row?.rejected ?? 0),
        mySubmissions: Number(row?.my_submissions ?? 0),
      };
    });
  }

  /** Assigns actor as decided_by on an unclaimed PENDING_APPROVAL run, without deciding it --
   * mirrors claimImportApproval/claimApprovalRequest, both of which reuse their own "decider"
   * column the exact same way rather than adding a separate claimed_by column. A later
   * recordRunApprovalDecision overwrites decided_by with whoever actually decides (usually, but
   * not necessarily, the same claimer), identical to how the other two claim/decide pairs behave
   * today. Throws if actorUsername has no matching reconciliation_user row -- unlike submitRun's
   * submitter, the decider's identity is integrity-critical here (segregation of duty), so this
   * must fail loudly rather than silently record a NULL decider. */
  async claimRunApproval(
    organizationId: string,
    runId: string,
    actorUsername: string,
  ): Promise<ClaimRunApprovalResult> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const actorUserId = await this.resolveUserId(client, organizationId, actorUsername);
      if (!actorUserId) {
        throw new Error(
          `claimRunApproval: actor username "${actorUsername}" has no matching reconciliation_user row.`,
        );
      }

      const result = await client.query(
        `UPDATE reconciliation_run
            SET decided_by = $2
          WHERE id = $1 AND status = 'PENDING_APPROVAL' AND decided_by IS NULL
        RETURNING id`,
        [runId, actorUserId],
      );

      return result.rows.length > 0 ? { outcome: 'claimed' } : { outcome: 'not_claimable' };
    });
  }

  /** Decides a PENDING_APPROVAL run. The segregation-of-duty CHECK constraint
   * (reconciliation_run_segregation_of_duty_check, changeset 0042: decided_by IS NULL OR
   * submitted_by IS DISTINCT FROM decided_by) can reject this UPDATE with a Postgres 23514
   * violation when the actor is also the run's own submitter -- deliberately left uncaught here,
   * same convention as createApprovalRequest's unique-violation (23505, readModelStore.ts's own
   * doc comment): the route layer catches the raw error code, this layer doesn't guess at HTTP
   * semantics. Throws (rather than returning a result variant) if actorUsername has no matching
   * reconciliation_user row, same reasoning as claimRunApproval. */
  async recordRunApprovalDecision(
    organizationId: string,
    input: RecordRunApprovalDecisionInput,
  ): Promise<RunApprovalDecisionResult> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const actorUserId = await this.resolveUserId(client, organizationId, input.actorUsername);
      if (!actorUserId) {
        throw new Error(
          `recordRunApprovalDecision: actor username "${input.actorUsername}" has no matching reconciliation_user row.`,
        );
      }

      const result = await client.query<{
        id: string;
        label: string;
        frequency: 'MONTHLY' | 'ANNUAL';
        period_year: number;
        period_month: number | null;
        status: RunApprovalStatus;
        submitted_by: string;
        decided_by: string | null;
        decision_note: string | null;
        submitted_at: string;
        decided_at: string | null;
      }>(
        `UPDATE reconciliation_run
            SET status = $2, decided_by = $3, decision_note = $4, decided_at = NOW()
          WHERE id = $1 AND status = 'PENDING_APPROVAL'
        RETURNING id, label, frequency, period_year, period_month, status, submitted_by, decided_by,
                  decision_note, submitted_at, decided_at`,
        [input.runId, input.toStatus, actorUserId, input.rationale ?? null],
      );

      const row = result.rows[0];
      if (!row) {
        return { outcome: 'not_found' };
      }

      const usernamesById = await this.resolveUsernamesByIds(
        client,
        organizationId,
        [row.submitted_by, row.decided_by].filter((id): id is string => !!id),
      );

      return { outcome: 'decided', item: this.toRunApprovalListItem(row, usernamesById) };
    });
  }

  /** README §7 item 7: "an analyst... may withdraw a submission" -- pulls a PENDING_APPROVAL run
   * (already validated, matching already fired per this build's immediate-execution decision)
   * back to DRAFT so the analyst can fix and resubmit. Only the run's own submitter may withdraw
   * it -- checked here, not just at the route's role gate, since any senior-analyst passes that
   * gate but this is a self-service action on one's own submission, not a general capability. */
  async withdrawRunApproval(
    organizationId: string,
    runId: string,
    actorUsername: string,
  ): Promise<
    | { outcome: 'not_found' }
    | { outcome: 'invalid_state'; currentStatus: string }
    | { outcome: 'not_submitter' }
    | { outcome: 'withdrawn' }
  > {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const actorUserId = await this.resolveUserId(client, organizationId, actorUsername);
      if (!actorUserId) {
        throw new Error(
          `withdrawRunApproval: actor username "${actorUsername}" has no matching reconciliation_user row.`,
        );
      }

      const runResult = await client.query<{ status: string; submitted_by: string | null }>(
        'SELECT status, submitted_by FROM reconciliation_run WHERE id = $1 FOR UPDATE',
        [runId],
      );
      const runRow = runResult.rows[0];
      if (!runRow) {
        return { outcome: 'not_found' as const };
      }
      if (runRow.status !== 'PENDING_APPROVAL') {
        return { outcome: 'invalid_state' as const, currentStatus: runRow.status };
      }
      if (runRow.submitted_by !== actorUserId) {
        return { outcome: 'not_submitter' as const };
      }

      await client.query(
        `UPDATE reconciliation_run
            SET status = 'DRAFT', submitted_by = NULL, submitted_at = NULL
          WHERE id = $1`,
        [runId],
      );

      return { outcome: 'withdrawn' as const };
    });
  }
}
