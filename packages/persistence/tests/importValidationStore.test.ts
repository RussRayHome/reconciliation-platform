import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import {
  PostgresImportRunStore,
  PostgresImportValidationStore,
  type CanonicalRecordInput,
  type CreateImportRunInput,
  type ValidationIssueInput,
} from '../src';
import { createDatabaseFromTemplate } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

let database: TestDatabase | undefined;
let pool: Pool;
let startupError: Error | null = null;
let defaultOrganizationId: string;
let submitterUserId: string;
let approverUserId: string;
const submittedByUserName = 'analyst.jane';
const approverUserName = 'approver.alice';

const bankBytes = Buffer.from('transaction_id,amount\nTXN-1,100.00\n', 'utf8');
const glBytes = Buffer.from('entry_id,line_number\nJE-1,1\n', 'utf8');

const buildRunInput = (overrides: Partial<CreateImportRunInput> = {}): CreateImportRunInput => ({
  organizationId: defaultOrganizationId,
  label: 'Monthly Recon for August 2026',
  accountIdentifier: 'OPERATING-001',
  frequency: 'MONTHLY',
  periodYear: 2026,
  periodMonth: 8,
  files: [
    { role: 'BANK_MERGED', sourceType: 'BANK', originalFilename: 'bank.csv', fileFormat: 'CSV', bytes: bankBytes },
    { role: 'GL', sourceType: 'GL', originalFilename: 'gl.csv', fileFormat: 'CSV', bytes: glBytes },
  ],
  ...overrides,
});

describe('PostgresImportValidationStore', () => {
  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_import_validation_store');
      pool = database.pool;

      const organizationResult = await pool.query<{ id: string }>(
        "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
      );
      const organizationId = organizationResult.rows[0]?.id;
      if (!organizationId) {
        throw new Error("Expected migrations to seed a 'Default Organization' row.");
      }
      defaultOrganizationId = organizationId;

      await pool.query(
        `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
         VALUES ($1, 'Jane', 'Analyst', 'hash', 'senior-analyst', $2)
         ON CONFLICT DO NOTHING`,
        [submittedByUserName, defaultOrganizationId],
      );
      await pool.query(
        `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
         VALUES ($1, 'Alice', 'Approver', 'hash', 'controller', $2)
         ON CONFLICT DO NOTHING`,
        [approverUserName, defaultOrganizationId],
      );
      const submitter = await pool.query<{ id: string }>(
        'SELECT id FROM reconciliation_user WHERE user_name = $1',
        [submittedByUserName],
      );
      submitterUserId = submitter.rows[0]!.id;
      const approver = await pool.query<{ id: string }>(
        'SELECT id FROM reconciliation_user WHERE user_name = $1',
        [approverUserName],
      );
      approverUserId = approver.rows[0]!.id;
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`PostgreSQL integration setup failed: ${startupError.message}`);
      throw startupError;
    }
  });

  afterAll(async () => {
    if (database) {
      await database.drop();
    }
  });

  const createDraftRun = async (overrides: Partial<CreateImportRunInput> = {}) => {
    const runStore = new PostgresImportRunStore(pool);
    return runStore.createRun(buildRunInput(overrides));
  };

  /** Drives a run straight to PENDING_APPROVAL for approval-layer tests, bypassing the full
   * submit/validate pipeline (already covered by the submitRun/recordFileValidationOutcome/
   * finalizeRun tests above) -- this test block is about the approval surface itself. */
  const createPendingApprovalRun = async (overrides: Partial<CreateImportRunInput> = {}) => {
    const run = await createDraftRun(overrides);
    await pool.query(
      `UPDATE reconciliation_run SET status = 'PENDING_APPROVAL', submitted_by = $1, submitted_at = NOW()
        WHERE id = $2`,
      [submitterUserId, run.id],
    );
    return run;
  };

  describe('submitRun', () => {
    it('transitions DRAFT -> VALIDATING, resolves submitted_by, and creates a QUEUED import_job', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Submit Me' });
      const store = new PostgresImportValidationStore(pool);

      const result = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);

      expect(result.outcome).toBe('submitted');
      const importJobId = result.outcome === 'submitted' ? result.importJobId : undefined;
      expect(importJobId).toBeTruthy();

      const runRow = await pool.query<{ status: string; submitted_by: string; submitted_at: Date }>(
        'SELECT status, submitted_by, submitted_at FROM reconciliation_run WHERE id = $1',
        [run.id],
      );
      expect(runRow.rows[0]?.status).toBe('VALIDATING');
      expect(runRow.rows[0]?.submitted_by).toBeTruthy();
      expect(runRow.rows[0]?.submitted_at).toBeTruthy();

      const jobRow = await pool.query<{ status: string; reconciliation_run_id: string }>(
        'SELECT status, reconciliation_run_id FROM import_job WHERE id = $1',
        [importJobId],
      );
      expect(jobRow.rows[0]).toMatchObject({ status: 'QUEUED', reconciliation_run_id: run.id });
    });

    it('leaves submitted_by NULL when the username has no matching reconciliation_user row', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Unresolvable Submitter' });
      const store = new PostgresImportValidationStore(pool);

      await store.submitRun(defaultOrganizationId, run.id, 'local-dev-fallback-user');

      const runRow = await pool.query<{ submitted_by: string | null }>(
        'SELECT submitted_by FROM reconciliation_run WHERE id = $1',
        [run.id],
      );
      expect(runRow.rows[0]?.submitted_by).toBeNull();
    });

    it('returns not_found for an unknown run id', async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportValidationStore(pool);
      const result = await store.submitRun(
        defaultOrganizationId,
        '00000000-0000-0000-0000-000000000000',
        submittedByUserName,
      );

      expect(result).toEqual({ outcome: 'not_found' });
    });

    it('returns invalid_state when the run is not DRAFT', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Already Submitted' });
      const store = new PostgresImportValidationStore(pool);

      await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const second = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);

      expect(second).toEqual({ outcome: 'invalid_state', currentStatus: 'VALIDATING' });
    });
  });

  describe('import_job lifecycle', () => {
    it('markJobRunning sets RUNNING, worker_id, started_at, and increments attempts', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Job Lifecycle Running' });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';

      await store.markJobRunning(defaultOrganizationId, importJobId, 'worker-1');

      const jobRow = await pool.query<{ status: string; worker_id: string; attempts: number }>(
        'SELECT status, worker_id, attempts FROM import_job WHERE id = $1',
        [importJobId],
      );
      expect(jobRow.rows[0]).toMatchObject({ status: 'RUNNING', worker_id: 'worker-1', attempts: 1 });
    });

    it('markJobFailed sets FAILED, error_summary, and finished_at', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Job Lifecycle Failed' });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';

      await store.markJobFailed(defaultOrganizationId, importJobId, 'boom');

      const jobRow = await pool.query<{ status: string; error_summary: string; finished_at: Date }>(
        'SELECT status, error_summary, finished_at FROM import_job WHERE id = $1',
        [importJobId],
      );
      expect(jobRow.rows[0]).toMatchObject({ status: 'FAILED', error_summary: 'boom' });
      expect(jobRow.rows[0]?.finished_at).toBeTruthy();
    });
  });

  it('loadActiveValidationRuleVersionIds returns every seeded rule code', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportValidationStore(pool);
    const ruleVersionIds = await store.loadActiveValidationRuleVersionIds(defaultOrganizationId);

    expect(ruleVersionIds.size).toBe(24);
    expect(ruleVersionIds.get('BANK_SEQUENCE_REQUIRED')).toBeTruthy();
    expect(ruleVersionIds.get('GL_AMOUNT_FORMAT')).toBeTruthy();
    expect(ruleVersionIds.get('STRUCT_HEADER_MISSING')).toBeTruthy();
  });

  describe('recordFileValidationOutcome', () => {
    const errorIssue: ValidationIssueInput = {
      severity: 'ERROR',
      code: 'BANK_SEQUENCE_REQUIRED',
      field: 'Sequence Number',
      rowNumber: 3,
      message: 'Sequence Number is required',
    };
    const warningIssue: ValidationIssueInput = {
      severity: 'WARNING',
      code: 'GL_AMOUNT_ZERO',
      field: 'Amount',
      rowNumber: 1,
      message: 'Amount is zero',
    };
    const normalizedRecord: CanonicalRecordInput = {
      sourceType: 'BANK',
      recordId: 'TXN-1',
      account: 'ACCT-1',
      date: '2026-08-05',
      currencyCode: 'USD',
      signedAmount: 100,
      direction: 'INFLOW',
      magnitude: 100,
      description: 'Deposit',
      reference: 'REF-1',
      sourceLineNumber: 1,
      raw: { transaction_id: 'TXN-1', amount: '100.00' },
    };

    it('marks the file INVALID, persists issues + rule_version_id linkage, and canonical_record rows', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Outcome Invalid' });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';
      const bankFile = run.files.find((file) => file.role === 'BANK_MERGED')!;
      const ruleVersionIds = await store.loadActiveValidationRuleVersionIds(defaultOrganizationId);

      const result = await store.recordFileValidationOutcome(
        defaultOrganizationId,
        {
          importJobId,
          importFileId: bankFile.importFileId,
          reconciliationRunId: run.id,
          totalRowCount: 3,
          issues: [errorIssue, warningIssue],
          normalized: [normalizedRecord],
        },
        ruleVersionIds,
      );

      expect(result).toEqual({ validationStatus: 'INVALID', errorCount: 1, warningCount: 1 });

      const issueRows = await pool.query<{ code: string; rule_version_id: string; row_number: number }>(
        'SELECT code, rule_version_id, row_number FROM validation_issue WHERE import_file_id = $1 ORDER BY code',
        [bankFile.importFileId],
      );
      expect(issueRows.rows).toHaveLength(2);
      expect(issueRows.rows[0]?.rule_version_id).toBe(ruleVersionIds.get('BANK_SEQUENCE_REQUIRED'));
      expect(issueRows.rows[1]?.rule_version_id).toBe(ruleVersionIds.get('GL_AMOUNT_ZERO'));

      const canonicalRows = await pool.query<{ record_id: string; reference_ids: { reference: string } }>(
        'SELECT record_id, reference_ids FROM canonical_record WHERE import_file_id = $1',
        [bankFile.importFileId],
      );
      expect(canonicalRows.rows).toHaveLength(1);
      expect(canonicalRows.rows[0]).toMatchObject({
        record_id: 'TXN-1',
        reference_ids: { reference: 'REF-1' },
      });

      const fileRow = await pool.query<{
        validation_status: string;
        row_count: number;
        error_count: number;
        warning_count: number;
        date_range_start: string;
        date_range_end: string;
      }>(
        `SELECT validation_status, row_count, error_count, warning_count, date_range_start, date_range_end
           FROM import_file WHERE id = $1`,
        [bankFile.importFileId],
      );
      expect(fileRow.rows[0]).toMatchObject({
        validation_status: 'INVALID',
        row_count: 3,
        error_count: 1,
        warning_count: 1,
      });
    });

    it('marks the file VALID_WITH_WARNINGS when only warnings are present', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Outcome Warnings Only' });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';
      const bankFile = run.files.find((file) => file.role === 'BANK_MERGED')!;
      const ruleVersionIds = await store.loadActiveValidationRuleVersionIds(defaultOrganizationId);

      const result = await store.recordFileValidationOutcome(
        defaultOrganizationId,
        {
          importJobId,
          importFileId: bankFile.importFileId,
          reconciliationRunId: run.id,
          totalRowCount: 1,
          issues: [warningIssue],
          normalized: [normalizedRecord],
        },
        ruleVersionIds,
      );

      expect(result).toEqual({ validationStatus: 'VALID_WITH_WARNINGS', errorCount: 0, warningCount: 1 });
    });

    it('marks the file VALID with zero issues', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Outcome Fully Valid' });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';
      const bankFile = run.files.find((file) => file.role === 'BANK_MERGED')!;
      const ruleVersionIds = await store.loadActiveValidationRuleVersionIds(defaultOrganizationId);

      const result = await store.recordFileValidationOutcome(
        defaultOrganizationId,
        {
          importJobId,
          importFileId: bankFile.importFileId,
          reconciliationRunId: run.id,
          totalRowCount: 1,
          issues: [],
          normalized: [normalizedRecord],
        },
        ruleVersionIds,
      );

      expect(result).toEqual({ validationStatus: 'VALID', errorCount: 0, warningCount: 0 });
    });

    it('throws when an issue code has no matching ACTIVE rule version', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Outcome Unknown Code' });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';
      const bankFile = run.files.find((file) => file.role === 'BANK_MERGED')!;

      await expect(
        store.recordFileValidationOutcome(
          defaultOrganizationId,
          {
            importJobId,
            importFileId: bankFile.importFileId,
            reconciliationRunId: run.id,
            totalRowCount: 1,
            issues: [{ severity: 'ERROR', code: 'MADE_UP_CODE', message: 'nope' }],
            normalized: [],
          },
          new Map(),
        ),
      ).rejects.toThrow(/MADE_UP_CODE/);
    });
  });

  describe('review drilldown (listRunIssues / listRunRecords)', () => {
    /** Submits a run and records validation outcomes on both its files, so listRunIssues/
     * listRunRecords have real cross-file data to page/filter over -- mirrors the
     * recordFileValidationOutcome tests' own submit->load-rule-versions->record sequence. */
    const seedRun = async (label: string) => {
      const run = await createDraftRun({ label });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';
      const bankFile = run.files.find((file) => file.role === 'BANK_MERGED')!;
      const glFile = run.files.find((file) => file.role === 'GL')!;
      const ruleVersionIds = await store.loadActiveValidationRuleVersionIds(defaultOrganizationId);

      await store.recordFileValidationOutcome(
        defaultOrganizationId,
        {
          importJobId,
          importFileId: bankFile.importFileId,
          reconciliationRunId: run.id,
          totalRowCount: 2,
          issues: [
            { severity: 'ERROR', code: 'BANK_SEQUENCE_REQUIRED', field: 'Sequence Number', rowNumber: 2, message: 'missing' },
            { severity: 'ERROR', code: 'BANK_DATE_REQUIRED', field: 'Date', rowNumber: 1, message: 'missing' },
          ],
          normalized: [
            {
              sourceType: 'BANK',
              recordId: 'TXN-1',
              account: 'ACCT-1',
              date: '2026-08-05',
              currencyCode: 'USD',
              signedAmount: 100,
              direction: 'INFLOW',
              magnitude: 100,
              description: 'Deposit',
              reference: 'REF-1',
              sourceLineNumber: 1,
              raw: { transaction_id: 'TXN-1' },
            },
          ],
        },
        ruleVersionIds,
      );

      await store.recordFileValidationOutcome(
        defaultOrganizationId,
        {
          importJobId,
          importFileId: glFile.importFileId,
          reconciliationRunId: run.id,
          totalRowCount: 1,
          issues: [
            { severity: 'WARNING', code: 'GL_AMOUNT_ZERO', field: 'Amount', rowNumber: 1, message: 'zero' },
          ],
          normalized: [
            {
              sourceType: 'GL',
              recordId: 'JE-1',
              account: 'ACCT-1',
              date: '2026-08-05',
              currencyCode: 'USD',
              signedAmount: 100,
              direction: 'INFLOW',
              magnitude: 100,
              description: 'Journal entry',
              sourceLineNumber: 1,
              raw: { entry_id: 'JE-1' },
            },
          ],
        },
        ruleVersionIds,
      );

      return { run, bankFile, glFile };
    };

    describe('listRunIssues', () => {
      it('returns null for a run that does not exist', async () => {
        if (startupError) throw startupError;

        const store = new PostgresImportValidationStore(pool);
        const page = await store.listRunIssues(
          defaultOrganizationId,
          '00000000-0000-0000-0000-000000000000',
          50,
          0,
        );
        expect(page).toBeNull();
      });

      it('pages every issue across both files with total/hasMore metadata', async () => {
        if (startupError) throw startupError;

        const { run } = await seedRun('Issues Drilldown Paging');
        const store = new PostgresImportValidationStore(pool);

        const page = await store.listRunIssues(defaultOrganizationId, run.id, 2, 0);
        expect(page).not.toBeNull();
        expect(page!.total).toBe(3);
        expect(page!.items).toHaveLength(2);
        expect(page!.hasMore).toBe(true);

        const secondPage = await store.listRunIssues(defaultOrganizationId, run.id, 2, 2);
        expect(secondPage!.items).toHaveLength(1);
        expect(secondPage!.hasMore).toBe(false);
      });

      it('filters by severity', async () => {
        if (startupError) throw startupError;

        const { run } = await seedRun('Issues Drilldown Severity Filter');
        const store = new PostgresImportValidationStore(pool);

        const page = await store.listRunIssues(defaultOrganizationId, run.id, 50, 0, {
          severity: 'WARNING',
        });
        expect(page!.total).toBe(1);
        expect(page!.items[0]?.code).toBe('GL_AMOUNT_ZERO');
      });

      it('filters by code', async () => {
        if (startupError) throw startupError;

        const { run } = await seedRun('Issues Drilldown Code Filter');
        const store = new PostgresImportValidationStore(pool);

        const page = await store.listRunIssues(defaultOrganizationId, run.id, 50, 0, {
          code: 'GL_AMOUNT_ZERO',
        });
        expect(page!.total).toBe(1);
        expect(page!.items[0]).toMatchObject({
          code: 'GL_AMOUNT_ZERO',
          severity: 'WARNING',
          field: 'Amount',
          rowNumber: 1,
        });
      });

      it('filters by importFileId (Phase 11 failure detail)', async () => {
        if (startupError) throw startupError;

        const { run, bankFile } = await seedRun('Issues Drilldown ImportFileId Filter');
        const store = new PostgresImportValidationStore(pool);

        const page = await store.listRunIssues(defaultOrganizationId, run.id, 50, 0, {
          importFileId: bankFile.importFileId,
        });
        expect(page!.total).toBe(2);
        expect(page!.items.every((item) => item.importFileId === bankFile.importFileId)).toBe(true);
      });
    });

    describe('listRunRecords', () => {
      it('returns null for a run that does not exist', async () => {
        if (startupError) throw startupError;

        const store = new PostgresImportValidationStore(pool);
        const page = await store.listRunRecords(
          defaultOrganizationId,
          '00000000-0000-0000-0000-000000000000',
          50,
          0,
        );
        expect(page).toBeNull();
      });

      it('returns records from both files for the run', async () => {
        if (startupError) throw startupError;

        const { run } = await seedRun('Records Drilldown Both Files');
        const store = new PostgresImportValidationStore(pool);

        const page = await store.listRunRecords(defaultOrganizationId, run.id, 50, 0);
        expect(page!.total).toBe(2);
        expect(page!.items.map((item) => item.recordId).sort()).toEqual(['JE-1', 'TXN-1']);
      });

      it('filters by sourceType', async () => {
        if (startupError) throw startupError;

        const { run } = await seedRun('Records Drilldown SourceType Filter');
        const store = new PostgresImportValidationStore(pool);

        const page = await store.listRunRecords(defaultOrganizationId, run.id, 50, 0, {
          sourceType: 'GL',
        });
        expect(page!.total).toBe(1);
        expect(page!.items[0]).toMatchObject({ recordId: 'JE-1', sourceType: 'GL' });
      });

      it('filters by importFileId', async () => {
        if (startupError) throw startupError;

        const { run, bankFile } = await seedRun('Records Drilldown ImportFileId Filter');
        const store = new PostgresImportValidationStore(pool);

        const page = await store.listRunRecords(defaultOrganizationId, run.id, 50, 0, {
          importFileId: bankFile.importFileId,
        });
        expect(page!.total).toBe(1);
        expect(page!.items[0]).toMatchObject({ recordId: 'TXN-1', importFileId: bankFile.importFileId });
      });
    });
  });

  describe('finalizeRun / recordMatchingJobId', () => {
    it('moves a passed run to PENDING_APPROVAL and the job to SUCCEEDED', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Finalize Passed' });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';

      await store.finalizeRun(defaultOrganizationId, run.id, importJobId, { passed: true });

      const runRow = await pool.query<{ status: string }>(
        'SELECT status FROM reconciliation_run WHERE id = $1',
        [run.id],
      );
      expect(runRow.rows[0]?.status).toBe('PENDING_APPROVAL');

      const jobRow = await pool.query<{ status: string; finished_at: Date }>(
        'SELECT status, finished_at FROM import_job WHERE id = $1',
        [importJobId],
      );
      expect(jobRow.rows[0]?.status).toBe('SUCCEEDED');
      expect(jobRow.rows[0]?.finished_at).toBeTruthy();
    });

    it('moves a failed run to VALIDATION_FAILED', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Finalize Failed' });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';

      await store.finalizeRun(defaultOrganizationId, run.id, importJobId, { passed: false });

      const runRow = await pool.query<{ status: string }>(
        'SELECT status FROM reconciliation_run WHERE id = $1',
        [run.id],
      );
      expect(runRow.rows[0]?.status).toBe('VALIDATION_FAILED');
    });

    it('recordMatchingJobId links the run to the existing pipeline job id', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Matching Link' });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';
      await store.finalizeRun(defaultOrganizationId, run.id, importJobId, { passed: true });

      await pool.query(
        `INSERT INTO reconciliation_job (id, organization_id, correlation_id, current_state, rulepack_version, started_at)
         VALUES (gen_random_uuid(), $1, 'corr-1', 'MATCHED', 'test', NOW()) RETURNING id`,
        [defaultOrganizationId],
      );
      const matchingJobRow = await pool.query<{ id: string }>(
        `SELECT id FROM reconciliation_job WHERE organization_id = $1 AND correlation_id = 'corr-1'`,
        [defaultOrganizationId],
      );
      const matchingJobId = matchingJobRow.rows[0]!.id;

      await store.recordMatchingJobId(defaultOrganizationId, run.id, matchingJobId);

      const runRow = await pool.query<{ matching_job_id: string }>(
        'SELECT matching_job_id FROM reconciliation_run WHERE id = $1',
        [run.id],
      );
      expect(runRow.rows[0]?.matching_job_id).toBe(matchingJobId);
    });
  });

  describe('acceptPartialImport (Phase 12 Screen 06)', () => {
    /** Submits a run and records outcomes on both files, ending with finalizeRun(passed: false)
     * so the run reaches VALIDATION_FAILED -- acceptPartialImport's own precondition. The GL side
     * always passes cleanly; `mode` controls the bank side's shape. */
    const seedFailedRun = async (
      label: string,
      mode: 'partial' | 'structural' | 'zero-importable',
    ) => {
      // import_file dedupes by (organization_id, content_sha256, source_type) -- distinct bytes
      // per call (not just per mode) keep each test's validation_issue rows on their own
      // import_file_id, so an earlier test's issues can't bleed into a later one that happens to
      // reuse the same default fixture bytes.
      const run = await createDraftRun({
        label,
        files: [
          {
            role: 'BANK_MERGED',
            sourceType: 'BANK',
            originalFilename: 'bank.csv',
            fileFormat: 'CSV',
            bytes: Buffer.from(`transaction_id,amount\nTXN-${label}-${mode},100.00\n`, 'utf8'),
          },
          {
            role: 'GL',
            sourceType: 'GL',
            originalFilename: 'gl.csv',
            fileFormat: 'CSV',
            bytes: Buffer.from(`entry_id,line_number\nJE-${label}-${mode},1\n`, 'utf8'),
          },
        ],
      });
      const store = new PostgresImportValidationStore(pool);
      const submitted = await store.submitRun(defaultOrganizationId, run.id, submittedByUserName);
      const importJobId = submitted.outcome === 'submitted' ? submitted.importJobId : '';
      const bankFile = run.files.find((file) => file.role === 'BANK_MERGED')!;
      const glFile = run.files.find((file) => file.role === 'GL')!;
      const ruleVersionIds = await store.loadActiveValidationRuleVersionIds(defaultOrganizationId);

      await store.recordFileValidationOutcome(
        defaultOrganizationId,
        {
          importJobId,
          importFileId: glFile.importFileId,
          reconciliationRunId: run.id,
          totalRowCount: 1,
          issues: [],
          normalized: [
            {
              sourceType: 'GL',
              recordId: 'JE-1',
              account: 'ACCT-1',
              date: '2026-08-05',
              currencyCode: 'USD',
              signedAmount: 100,
              direction: 'INFLOW',
              magnitude: 100,
              description: 'Journal entry',
              sourceLineNumber: 1,
              raw: { entry_id: 'JE-1' },
            },
          ],
        },
        ruleVersionIds,
      );

      const bankOutcomeByMode: Record<
        typeof mode,
        { issues: ValidationIssueInput[]; normalized: CanonicalRecordInput[] }
      > = {
        partial: {
          issues: [
            {
              severity: 'ERROR',
              code: 'BANK_DEBIT_FORMAT',
              field: 'Debit',
              rowNumber: 3,
              message: '"Debit" is not a valid amount.',
            },
          ],
          normalized: [
            {
              sourceType: 'BANK',
              recordId: 'TXN-1',
              account: 'ACCT-1',
              date: '2026-08-05',
              currencyCode: 'USD',
              signedAmount: 100,
              direction: 'INFLOW',
              magnitude: 100,
              description: 'Deposit',
              sourceLineNumber: 1,
              raw: { transaction_id: 'TXN-1' },
            },
          ],
        },
        structural: {
          issues: [
            {
              severity: 'ERROR',
              code: 'STRUCT_COLUMN_MISSING',
              field: 'Sequence Number',
              message: 'Required column "Sequence Number" is absent.',
            },
          ],
          normalized: [],
        },
        'zero-importable': {
          issues: [
            {
              severity: 'ERROR',
              code: 'BANK_DEBIT_FORMAT',
              field: 'Debit',
              rowNumber: 2,
              message: '"Debit" is not a valid amount.',
            },
          ],
          normalized: [],
        },
      };

      await store.recordFileValidationOutcome(
        defaultOrganizationId,
        {
          importJobId,
          importFileId: bankFile.importFileId,
          reconciliationRunId: run.id,
          totalRowCount: 2,
          ...bankOutcomeByMode[mode],
        },
        ruleVersionIds,
      );

      await store.finalizeRun(defaultOrganizationId, run.id, importJobId, { passed: false });

      return { run, bankFile, glFile };
    };

    it('returns not_found for a nonexistent run', async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportValidationStore(pool);
      const result = await store.acceptPartialImport(
        defaultOrganizationId,
        '00000000-0000-0000-0000-000000000000',
      );
      expect(result).toEqual({ outcome: 'not_found' });
    });

    it('returns invalid_state when the run is not VALIDATION_FAILED', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Still Draft' });
      const store = new PostgresImportValidationStore(pool);

      const result = await store.acceptPartialImport(defaultOrganizationId, run.id);
      expect(result).toEqual({ outcome: 'invalid_state', currentStatus: 'DRAFT' });
    });

    it('returns structural_failure when the invalid file has a STRUCT_* error', async () => {
      if (startupError) throw startupError;

      const { run, bankFile } = await seedFailedRun('Structural Failure Guard', 'structural');
      const store = new PostgresImportValidationStore(pool);

      const result = await store.acceptPartialImport(defaultOrganizationId, run.id);
      expect(result).toEqual({ outcome: 'structural_failure', importFileId: bankFile.importFileId });
    });

    it('returns no_importable_rows when the invalid file has zero canonical_record rows', async () => {
      if (startupError) throw startupError;

      const { run, bankFile } = await seedFailedRun('Zero Importable Guard', 'zero-importable');
      const store = new PostgresImportValidationStore(pool);

      const result = await store.acceptPartialImport(defaultOrganizationId, run.id);
      expect(result).toEqual({ outcome: 'no_importable_rows', importFileId: bankFile.importFileId });
    });

    it('accepts and moves the run to PENDING_APPROVAL when every invalid file has importable rows', async () => {
      if (startupError) throw startupError;

      const { run } = await seedFailedRun('Accepted Partial Import', 'partial');
      const store = new PostgresImportValidationStore(pool);

      const result = await store.acceptPartialImport(defaultOrganizationId, run.id);
      expect(result).toEqual({ outcome: 'accepted' });

      const runRow = await pool.query<{ status: string }>(
        'SELECT status FROM reconciliation_run WHERE id = $1',
        [run.id],
      );
      expect(runRow.rows[0]?.status).toBe('PENDING_APPROVAL');
    });

    it('returns invalid_state on a second call after the run has already been accepted', async () => {
      if (startupError) throw startupError;

      const { run } = await seedFailedRun('Double Accept Guard', 'partial');
      const store = new PostgresImportValidationStore(pool);

      await store.acceptPartialImport(defaultOrganizationId, run.id);
      const second = await store.acceptPartialImport(defaultOrganizationId, run.id);

      expect(second).toEqual({ outcome: 'invalid_state', currentStatus: 'PENDING_APPROVAL' });
    });
  });

  describe('withdrawRunApproval (Phase 14)', () => {
    it('returns not_found for a nonexistent run', async () => {
      if (startupError) throw startupError;

      const store = new PostgresImportValidationStore(pool);
      const result = await store.withdrawRunApproval(
        defaultOrganizationId,
        '00000000-0000-0000-0000-000000000000',
        submittedByUserName,
      );
      expect(result).toEqual({ outcome: 'not_found' });
    });

    it('returns invalid_state when the run is not PENDING_APPROVAL', async () => {
      if (startupError) throw startupError;

      const run = await createDraftRun({ label: 'Withdraw Still Draft' });
      const store = new PostgresImportValidationStore(pool);

      const result = await store.withdrawRunApproval(
        defaultOrganizationId,
        run.id,
        submittedByUserName,
      );
      expect(result).toEqual({ outcome: 'invalid_state', currentStatus: 'DRAFT' });
    });

    it('returns not_submitter when the actor did not submit the run', async () => {
      if (startupError) throw startupError;

      const run = await createPendingApprovalRun({ label: 'Withdraw Wrong Actor' });
      const store = new PostgresImportValidationStore(pool);

      const result = await store.withdrawRunApproval(defaultOrganizationId, run.id, approverUserName);
      expect(result).toEqual({ outcome: 'not_submitter' });
    });

    it('withdraws the run to DRAFT and clears submitted_by/submitted_at', async () => {
      if (startupError) throw startupError;

      const run = await createPendingApprovalRun({ label: 'Withdraw Me' });
      const store = new PostgresImportValidationStore(pool);

      const result = await store.withdrawRunApproval(
        defaultOrganizationId,
        run.id,
        submittedByUserName,
      );
      expect(result).toEqual({ outcome: 'withdrawn' });

      const runRow = await pool.query<{
        status: string;
        submitted_by: string | null;
        submitted_at: Date | null;
      }>('SELECT status, submitted_by, submitted_at FROM reconciliation_run WHERE id = $1', [run.id]);
      expect(runRow.rows[0]).toMatchObject({ status: 'DRAFT', submitted_by: null, submitted_at: null });
    });

    it('returns invalid_state on a second withdraw after the first succeeded', async () => {
      if (startupError) throw startupError;

      const run = await createPendingApprovalRun({ label: 'Withdraw Twice' });
      const store = new PostgresImportValidationStore(pool);

      await store.withdrawRunApproval(defaultOrganizationId, run.id, submittedByUserName);
      const second = await store.withdrawRunApproval(
        defaultOrganizationId,
        run.id,
        submittedByUserName,
      );

      expect(second).toEqual({ outcome: 'invalid_state', currentStatus: 'DRAFT' });
    });
  });

  describe('run approvals', () => {
    describe('listRunApprovals', () => {
      it('returns PENDING_APPROVAL runs with resolved usernames', async () => {
        if (startupError) throw startupError;

        const run = await createPendingApprovalRun({ label: 'List Me' });
        const store = new PostgresImportValidationStore(pool);

        const items = await store.listRunApprovals(defaultOrganizationId, {});
        const item = items.find((candidate) => candidate.id === run.id);

        expect(item).toMatchObject({
          label: 'List Me',
          status: 'PENDING_APPROVAL',
          submittedByUsername: submittedByUserName,
          decidedByUsername: null,
        });
      });

      it('excludes DRAFT runs', async () => {
        if (startupError) throw startupError;

        const draft = await createDraftRun({ label: 'Still Draft' });
        const store = new PostgresImportValidationStore(pool);

        const items = await store.listRunApprovals(defaultOrganizationId, {});
        expect(items.find((candidate) => candidate.id === draft.id)).toBeUndefined();
      });

      it('filters by status', async () => {
        if (startupError) throw startupError;

        const run = await createPendingApprovalRun({ label: 'Filter By Status' });
        const store = new PostgresImportValidationStore(pool);

        const pendingOnly = await store.listRunApprovals(defaultOrganizationId, {
          status: 'PENDING_APPROVAL',
        });
        expect(pendingOnly.some((candidate) => candidate.id === run.id)).toBe(true);

        const approvedOnly = await store.listRunApprovals(defaultOrganizationId, {
          status: 'APPROVED',
        });
        expect(approvedOnly.some((candidate) => candidate.id === run.id)).toBe(false);
      });

      it('scopes to submittedByUsername for "my submissions"', async () => {
        if (startupError) throw startupError;

        const run = await createPendingApprovalRun({ label: 'Mine' });
        const store = new PostgresImportValidationStore(pool);

        const mine = await store.listRunApprovals(defaultOrganizationId, {
          submittedByUsername: submittedByUserName,
        });
        expect(mine.some((candidate) => candidate.id === run.id)).toBe(true);

        const someoneElses = await store.listRunApprovals(defaultOrganizationId, {
          submittedByUsername: approverUserName,
        });
        expect(someoneElses.some((candidate) => candidate.id === run.id)).toBe(false);
      });

      it('routedToOrUnassignedUsername includes unclaimed and claimed-by-me, excludes claimed-by-others', async () => {
        if (startupError) throw startupError;

        const store = new PostgresImportValidationStore(pool);
        const unclaimed = await createPendingApprovalRun({ label: 'Unclaimed' });
        const claimedByMe = await createPendingApprovalRun({ label: 'Claimed By Me' });
        await store.claimRunApproval(defaultOrganizationId, claimedByMe.id, approverUserName);

        const otherApproverUserName = 'approver.bob';
        await pool.query(
          `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
           VALUES ($1, 'Bob', 'Approver', 'hash', 'controller', $2)
           ON CONFLICT DO NOTHING`,
          [otherApproverUserName, defaultOrganizationId],
        );
        const claimedByOther = await createPendingApprovalRun({ label: 'Claimed By Other' });
        await store.claimRunApproval(defaultOrganizationId, claimedByOther.id, otherApproverUserName);

        const routed = await store.listRunApprovals(defaultOrganizationId, {
          routedToOrUnassignedUsername: approverUserName,
        });
        const routedIds = routed.map((candidate) => candidate.id);
        expect(routedIds).toContain(unclaimed.id);
        expect(routedIds).toContain(claimedByMe.id);
        expect(routedIds).not.toContain(claimedByOther.id);
      });
    });

    describe('getRunApprovalCounts', () => {
      it('as an approver, counts pending as unclaimed-or-mine but approved/rejected org-wide', async () => {
        if (startupError) throw startupError;

        const store = new PostgresImportValidationStore(pool);
        const before = await store.getRunApprovalCounts(defaultOrganizationId, approverUserName, true);

        await createPendingApprovalRun({ label: 'Counts Pending' });
        const toApprove = await createPendingApprovalRun({ label: 'Counts Approved' });
        await store.recordRunApprovalDecision(defaultOrganizationId, {
          runId: toApprove.id,
          toStatus: 'APPROVED',
          actorUsername: approverUserName,
        });

        const after = await store.getRunApprovalCounts(defaultOrganizationId, approverUserName, true);
        expect(after.pending).toBe(before.pending + 1);
        expect(after.approved).toBe(before.approved + 1);
      });

      it('as a non-approver, only counts own submissions', async () => {
        if (startupError) throw startupError;

        const store = new PostgresImportValidationStore(pool);
        const before = await store.getRunApprovalCounts(
          defaultOrganizationId,
          submittedByUserName,
          false,
        );

        await createPendingApprovalRun({ label: 'Non-Approver Sees Own' });

        const after = await store.getRunApprovalCounts(
          defaultOrganizationId,
          submittedByUserName,
          false,
        );
        expect(after.pending).toBe(before.pending + 1);
        expect(after.mySubmissions).toBe(before.mySubmissions + 1);
      });
    });

    describe('claimRunApproval', () => {
      it('assigns decided_by on an unclaimed pending run without deciding it', async () => {
        if (startupError) throw startupError;

        const run = await createPendingApprovalRun({ label: 'To Be Claimed' });
        const store = new PostgresImportValidationStore(pool);

        const result = await store.claimRunApproval(defaultOrganizationId, run.id, approverUserName);
        expect(result).toEqual({ outcome: 'claimed' });

        const row = await pool.query<{ status: string; decided_by: string }>(
          'SELECT status, decided_by FROM reconciliation_run WHERE id = $1',
          [run.id],
        );
        expect(row.rows[0]).toMatchObject({ status: 'PENDING_APPROVAL', decided_by: approverUserId });
      });

      it('returns not_claimable when already claimed', async () => {
        if (startupError) throw startupError;

        const run = await createPendingApprovalRun({ label: 'Already Claimed' });
        const store = new PostgresImportValidationStore(pool);

        await store.claimRunApproval(defaultOrganizationId, run.id, approverUserName);
        const second = await store.claimRunApproval(defaultOrganizationId, run.id, submittedByUserName);

        expect(second).toEqual({ outcome: 'not_claimable' });
      });

      it('throws for an actor username with no matching reconciliation_user row', async () => {
        if (startupError) throw startupError;

        const run = await createPendingApprovalRun({ label: 'Unresolvable Actor' });
        const store = new PostgresImportValidationStore(pool);

        await expect(
          store.claimRunApproval(defaultOrganizationId, run.id, 'no-such-user'),
        ).rejects.toThrow(/no matching reconciliation_user row/);
      });
    });

    describe('recordRunApprovalDecision', () => {
      it('approves a pending run and records the decider and note', async () => {
        if (startupError) throw startupError;

        const run = await createPendingApprovalRun({ label: 'Decide Approve' });
        const store = new PostgresImportValidationStore(pool);

        const result = await store.recordRunApprovalDecision(defaultOrganizationId, {
          runId: run.id,
          toStatus: 'APPROVED',
          actorUsername: approverUserName,
          rationale: 'Looks good',
        });

        expect(result).toMatchObject({
          outcome: 'decided',
          item: {
            id: run.id,
            status: 'APPROVED',
            decidedByUsername: approverUserName,
            decisionNote: 'Looks good',
          },
        });
      });

      it('rejects a pending run', async () => {
        if (startupError) throw startupError;

        const run = await createPendingApprovalRun({ label: 'Decide Reject' });
        const store = new PostgresImportValidationStore(pool);

        const result = await store.recordRunApprovalDecision(defaultOrganizationId, {
          runId: run.id,
          toStatus: 'REJECTED',
          actorUsername: approverUserName,
        });

        expect(result).toMatchObject({ outcome: 'decided', item: { status: 'REJECTED' } });
      });

      it('returns not_found for a run that is not PENDING_APPROVAL', async () => {
        if (startupError) throw startupError;

        const draft = await createDraftRun({ label: 'Not Yet Submitted' });
        const store = new PostgresImportValidationStore(pool);

        const result = await store.recordRunApprovalDecision(defaultOrganizationId, {
          runId: draft.id,
          toStatus: 'APPROVED',
          actorUsername: approverUserName,
        });

        expect(result).toEqual({ outcome: 'not_found' });
      });

      it('rejects (Postgres 23514) when the actor is also the run\'s own submitter', async () => {
        if (startupError) throw startupError;

        const run = await createPendingApprovalRun({ label: 'Self Approval Attempt' });
        const store = new PostgresImportValidationStore(pool);

        await expect(
          store.recordRunApprovalDecision(defaultOrganizationId, {
            runId: run.id,
            toStatus: 'APPROVED',
            actorUsername: submittedByUserName,
          }),
        ).rejects.toMatchObject({ code: '23514' });
      });

      it('throws for an actor username with no matching reconciliation_user row', async () => {
        if (startupError) throw startupError;

        const run = await createPendingApprovalRun({ label: 'Decide Unresolvable Actor' });
        const store = new PostgresImportValidationStore(pool);

        await expect(
          store.recordRunApprovalDecision(defaultOrganizationId, {
            runId: run.id,
            toStatus: 'APPROVED',
            actorUsername: 'no-such-user',
          }),
        ).rejects.toThrow(/no matching reconciliation_user row/);
      });
    });
  });
});
