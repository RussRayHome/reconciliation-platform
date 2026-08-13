import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

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
}
