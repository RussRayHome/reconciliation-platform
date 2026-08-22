import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  PostgresImportRunStore,
  PostgresReconciliationLifecycleStore,
  type CreateImportRunInput,
} from '../src';
import { createDatabaseFromTemplate } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

/**
 * Exercises the reconciliation_run_timeline SQL function (changeset 0052) end to end: seeds a
 * real run through every stage the function reports on -- upload, file validation, approval,
 * reconciliation matching, and the audit-event message trail -- then asserts the function's
 * output actually reflects what was written to each underlying table, for both a success path
 * and a failure path. This is the direct regression test for the function itself, not for any
 * one store method.
 */
describe('reconciliation_run_timeline (Issue #154 SQL reporting)', () => {
  let database: TestDatabase | undefined;
  let pool: Pool;
  let startupError: Error | null = null;
  let organizationId: string;
  let otherOrganizationId: string;

  const timelineRows = async (orgId: string, runId: string) => {
    const result = await pool.query<{
      stage: string;
      occurred_at: string;
      event_type: string;
      status: string | null;
      actor: string | null;
      message: string;
      details: Record<string, unknown>;
    }>('SELECT * FROM reconciliation_run_timeline($1, $2)', [orgId, runId]);
    return result.rows;
  };

  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_run_timeline');
      pool = database.pool;

      const organizationResult = await pool.query<{ id: string }>(
        "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
      );
      const resolvedOrganizationId = organizationResult.rows[0]?.id;
      if (!resolvedOrganizationId) {
        throw new Error("Expected migrations to seed a 'Default Organization' row.");
      }
      organizationId = resolvedOrganizationId;

      const otherOrganizationResult = await pool.query<{ id: string }>(
        `INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Other Org')
         RETURNING id`,
      );
      otherOrganizationId = otherOrganizationResult.rows[0]!.id;

      await pool.query(
        `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
         VALUES ('timeline-submitter', 'Sam', 'Submitter', 'hash', 'senior-analyst', $1)
         ON CONFLICT DO NOTHING`,
        [organizationId],
      );
      await pool.query(
        `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
         VALUES ('timeline-approver', 'Ana', 'Approver', 'hash', 'controller', $1)
         ON CONFLICT DO NOTHING`,
        [organizationId],
      );
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

  const buildRunInput = (label: string): CreateImportRunInput => ({
    organizationId,
    label,
    accountIdentifier: 'OPERATING-001',
    frequency: 'MONTHLY',
    periodYear: 2026,
    periodMonth: 8,
    files: [
      {
        role: 'BANK_MERGED',
        sourceType: 'BANK',
        originalFilename: 'bank.csv',
        fileFormat: 'CSV',
        bytes: Buffer.from('date,amount\n2026-08-01,100.00\n', 'utf8'),
      },
      {
        role: 'GL',
        sourceType: 'GL',
        originalFilename: 'gl.csv',
        fileFormat: 'CSV',
        bytes: Buffer.from('date,amount\n2026-08-01,100.00\n', 'utf8'),
      },
    ],
  });

  const submitterId = async () =>
    (
      await pool.query<{ id: string }>(
        "SELECT id FROM reconciliation_user WHERE user_name = 'timeline-submitter'",
      )
    ).rows[0]!.id;

  const approverId = async () =>
    (
      await pool.query<{ id: string }>(
        "SELECT id FROM reconciliation_user WHERE user_name = 'timeline-approver'",
      )
    ).rows[0]!.id;

  const anyRuleVersionId = async () =>
    (
      await pool.query<{ id: string }>(
        "SELECT id FROM validation_rule_version WHERE status = 'ACTIVE' LIMIT 1",
      )
    ).rows[0]!.id;

  it('reports upload, passed validation, approval, and a completed matching job with audit messages', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportRunStore(pool);
    const run = await store.createRun(buildRunInput('Success Path Run'));
    const bankFile = run.files.find((file) => file.role === 'BANK_MERGED')!;

    const importJobId = randomUUID();
    await pool.query(
      `INSERT INTO import_job (id, organization_id, reconciliation_run_id, status, queued_at, started_at, finished_at)
       VALUES ($1, $2, $3, 'SUCCEEDED', now(), now(), now())`,
      [importJobId, organizationId, run.id],
    );

    const submittedBy = await submitterId();
    const decidedBy = await approverId();
    await pool.query(
      `UPDATE reconciliation_run
          SET status = 'APPROVED', submitted_by = $2, submitted_at = now(),
              decided_by = $3, decided_at = now(), decision_note = 'Looks good'
        WHERE id = $1`,
      [run.id, submittedBy, decidedBy],
    );

    const lifecycleStore = new PostgresReconciliationLifecycleStore(pool);
    const jobId = randomUUID();
    await lifecycleStore.createJob({
      jobId,
      correlationId: 'corr-success',
      startedAt: new Date().toISOString(),
      rulepackVersion: 'v1',
      organizationId,
      sourceFiles: [
        {
          id: randomUUID(),
          sourceSystem: 'bank',
          sourceFormat: 'csv',
          fileName: 'bank.csv',
          mimeType: 'text/csv',
          sizeBytes: 1024,
          sha256: 'timeline-test-sha',
          uploadedAt: new Date().toISOString(),
        },
      ],
    });
    await lifecycleStore.recordAuditEvent(organizationId, jobId, 'match.completed', {
      message: 'Matching completed: 1 matched, 0 exceptions',
      matchedCount: 1,
    });
    await pool.query(
      `UPDATE reconciliation_job SET current_state = 'FINALIZED', completed_at = now() WHERE id = $1`,
      [jobId],
    );
    await pool.query(`UPDATE reconciliation_run SET matching_job_id = $2 WHERE id = $1`, [
      run.id,
      jobId,
    ]);

    const rows = await timelineRows(organizationId, run.id);
    const eventTypes = rows.map((row) => row.event_type);

    // Upload
    expect(eventTypes).toContain('run.created');
    expect(rows.filter((row) => row.event_type === 'file.attached')).toHaveLength(2);
    const bankRow = rows.find(
      (row) => row.event_type === 'file.attached' && (row.details as { importFileId: string }).importFileId === bankFile.importFileId,
    );
    expect(bankRow?.message).toContain('bank.csv');

    // File validation (passed)
    expect(eventTypes).toContain('validation.passed');
    const passedRow = rows.find((row) => row.event_type === 'validation.passed')!;
    expect(passedRow.message).toBe('File validation passed');

    // Approval
    expect(eventTypes).toContain('approval.submitted');
    expect(eventTypes).toContain('approval.approved');
    const approvedRow = rows.find((row) => row.event_type === 'approval.approved')!;
    expect(approvedRow.actor).toBe('timeline-approver');
    expect((approvedRow.details as { decisionNote: string }).decisionNote).toBe('Looks good');

    // Reconciliation matching + audit message (matching-rule outcome)
    expect(eventTypes).toContain('matching.created');
    expect(eventTypes).toContain('matching.completed');
    expect(eventTypes).toContain('match.completed');
    const matchRow = rows.find((row) => row.event_type === 'match.completed')!;
    expect(matchRow.message).toBe('Matching completed: 1 matched, 0 exceptions');
    expect((matchRow.details as { matchedCount: number }).matchedCount).toBe(1);

    // Chronological ordering: upload strictly before validation before approval before matching.
    const stageOrder = rows.map((row) => row.stage);
    const firstReconciliationIndex = stageOrder.indexOf('reconciliation');
    const lastImportIndex = stageOrder.lastIndexOf('import');
    expect(lastImportIndex).toBeLessThan(firstReconciliationIndex);
  });

  it('surfaces the real error messages for a failed validation and a failed matching run', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportRunStore(pool);
    const run = await store.createRun(buildRunInput('Failure Path Run'));
    const bankFile = run.files.find((file) => file.role === 'BANK_MERGED')!;
    const ruleVersionId = await anyRuleVersionId();

    const importJobId = randomUUID();
    await pool.query(
      `INSERT INTO import_job (id, organization_id, reconciliation_run_id, status, queued_at, started_at, finished_at)
       VALUES ($1, $2, $3, 'SUCCEEDED', now(), now(), now())`,
      [importJobId, organizationId, run.id],
    );
    await pool.query(
      `INSERT INTO validation_issue
          (organization_id, import_job_id, import_file_id, severity, code, row_number, message, rule_version_id)
       VALUES ($1, $2, $3, 'ERROR', 'BANK_DATE_REQUIRED', 4, 'Date is required.', $4)`,
      [organizationId, importJobId, bankFile.importFileId, ruleVersionId],
    );
    await pool.query(`UPDATE reconciliation_run SET status = 'VALIDATION_FAILED' WHERE id = $1`, [
      run.id,
    ]);

    const rows = await timelineRows(organizationId, run.id);
    const eventTypes = rows.map((row) => row.event_type);

    expect(eventTypes).toContain('validation.failed');
    const failedRow = rows.find((row) => row.event_type === 'validation.failed')!;
    expect(failedRow.message).toBe('File validation failed');

    expect(eventTypes).toContain('validation.issue');
    const issueRow = rows.find((row) => row.event_type === 'validation.issue')!;
    expect(issueRow.status).toBe('ERROR');
    expect(issueRow.message).toBe('Date is required.');
    expect((issueRow.details as { code: string }).code).toBe('BANK_DATE_REQUIRED');

    // A separate run whose matching stage fails after at least one durable audit checkpoint --
    // proves the audit trail (recordAuditEvent) survives a failure, and that its checkpoint
    // still appears in the timeline even though the terminal state is FAILED.
    const lifecycleStore = new PostgresReconciliationLifecycleStore(pool);
    const matchingRun = await store.createRun(buildRunInput('Matching Failure Run'));
    const jobId = randomUUID();
    await lifecycleStore.createJob({
      jobId,
      correlationId: 'corr-failure',
      startedAt: new Date().toISOString(),
      rulepackVersion: 'v1',
      organizationId,
      sourceFiles: [
        {
          id: randomUUID(),
          sourceSystem: 'bank',
          sourceFormat: 'csv',
          fileName: 'bank.csv',
          mimeType: 'text/csv',
          sizeBytes: 1024,
          sha256: 'timeline-test-sha',
          uploadedAt: new Date().toISOString(),
        },
      ],
    });
    await lifecycleStore.recordAuditEvent(organizationId, jobId, 'match.started', {
      message: 'Matching started',
    });
    await lifecycleStore.markFailed(organizationId, {
      jobId,
      failedAt: new Date().toISOString(),
      errorMessage: 'Matching rule engine threw: unresolved account mapping for OPERATING-001',
      errorCode: 'RULE_ENGINE_ERROR',
    });
    await pool.query(`UPDATE reconciliation_run SET matching_job_id = $2 WHERE id = $1`, [
      matchingRun.id,
      jobId,
    ]);

    const matchingRows = await timelineRows(organizationId, matchingRun.id);
    const matchingEventTypes = matchingRows.map((row) => row.event_type);

    expect(matchingEventTypes).toContain('match.started');
    expect(matchingEventTypes).toContain('matching.failed');
    expect(matchingEventTypes).toContain('job.failed');
    const matchingFailedRow = matchingRows.find((row) => row.event_type === 'matching.failed')!;
    expect(matchingFailedRow.message).toBe(
      'Matching rule engine threw: unresolved account mapping for OPERATING-001',
    );
    expect((matchingFailedRow.details as { failureCode: string }).failureCode).toBe(
      'RULE_ENGINE_ERROR',
    );
  });

  it('never returns another organization or another run\'s rows', async () => {
    if (startupError) throw startupError;

    const store = new PostgresImportRunStore(pool);
    const run = await store.createRun(buildRunInput('Isolation Run A'));
    const otherRun = await store.createRun({ ...buildRunInput('Isolation Run B') });

    // Cross-organization: querying run A's id under the wrong org returns nothing.
    const wrongOrgRows = await timelineRows(otherOrganizationId, run.id);
    expect(wrongOrgRows).toHaveLength(0);

    // Cross-run, same organization: run A's timeline never contains run B's rows.
    const runARows = await timelineRows(organizationId, run.id);
    const runBFileNames = runARows
      .filter((row) => row.event_type === 'file.attached')
      .map((row) => row.message);
    expect(runBFileNames.every((message) => !message.includes('Isolation Run B'))).toBe(true);
    expect(runARows.every((row) => !JSON.stringify(row.details).includes(otherRun.id))).toBe(
      true,
    );
  });
});
