import { beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { FILE_VALIDATION_RULES } from '@recon/core';

import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

interface ImportFileRow {
  id: string;
  organization_id: string;
  original_filename: string;
  file_format: 'CSV' | 'XLSX';
  source_type: string;
  content_sha256: string;
  byte_size: number;
  validation_status: string;
  row_count: number | null;
  error_count: number | null;
  warning_count: number | null;
}

interface RunRow {
  id: string;
  organization_id: string;
  label: string;
  account_identifier: string | null;
  frequency: string;
  period_year: number;
  period_month: number | null;
  status: string;
  matching_job_id: string | null;
  created_at: string;
}

interface RunSourceFileRow {
  id: string;
  reconciliation_run_id: string;
  import_file_id: string;
  role: string;
  created_at: string;
}

interface ImportJobRow {
  id: string;
  status: string;
}

/**
 * Full round-trip fake for POST /api/imports/runs -> POST /api/imports/runs/:id/submit,
 * covering everything the synchronous fallback path exercises (importValidationQueue disabled,
 * matching the established test convention -- no ENABLE_IMPORT_VALIDATION_QUEUE env var set):
 * import_file/import_file_content/reconciliation_run/run_source_file (creation, same shape as
 * imports-endpoints.test.ts's own fake), reconciliation_user (submitRun's submitted_by lookup),
 * validation_rule_version (seeded from FILE_VALIDATION_RULES -- the real registry, not a hand
 * -picked subset, since recordFileValidationOutcome throws on any code missing from the map),
 * validation_issue/canonical_record/import_job, and -- only reached when a run's files actually
 * pass -- reconciliation_payee_alias (loadPayeeAliases, matching alias-endpoints.test.ts's own
 * fake). lifecycleStore is intentionally left undefined (appWithPool below), which makes
 * registerLifecycleJob skip the *older* pipeline's own tables entirely (see its own early-return
 * for `!lifecycleStore`) -- otherwise this fake would also need reconciliation_job/
 * reconciliation_source_file/reconciliation_source_file_content.
 */
interface CapturedIssueRow {
  id: string;
  import_file_id: string;
  severity: 'ERROR' | 'WARNING';
  code: string;
  row_number: number | null;
  entry_id: string | null;
  field: string | null;
  message: string;
  created_at: string;
}

interface CapturedRecordRow {
  import_file_id: string;
  source_type: string;
}

const createFakeSubmitPool = () => {
  const importFiles: ImportFileRow[] = [];
  const runs: RunRow[] = [];
  const runSourceFiles: RunSourceFileRow[] = [];
  const importJobs: ImportJobRow[] = [];
  const contentByFileId = new Map<string, Buffer>();
  const ruleVersionIdByCode = new Map(
    FILE_VALIDATION_RULES.map((rule, index) => [rule.code, `rule-version-${index}`]),
  );
  // Phase 11: captured so GET .../failure-detail and .../error-report.csv (both read back what
  // validation wrote) have real data to serve -- the pre-Phase-11 INSERT handlers below just
  // acknowledged the write and discarded it, which was fine while nothing read it back.
  const capturedIssues: CapturedIssueRow[] = [];
  const capturedRecords: CapturedRecordRow[] = [];

  const query = (
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: unknown[]; rowCount: number }> => {
    if (text.includes('SELECT content FROM import_file_content')) {
      const [importFileId] = params as [string];
      const content = contentByFileId.get(importFileId);
      return Promise.resolve({ rows: content ? [{ content }] : [], rowCount: content ? 1 : 0 });
    }

    if (text.includes('FROM import_file') && text.includes('content_sha256 = $2')) {
      const [organizationId, contentSha256, sourceType] = params as [string, string, string];
      const match = importFiles.find(
        (row) =>
          row.organization_id === organizationId &&
          row.content_sha256 === contentSha256 &&
          row.source_type === sourceType,
      );
      return Promise.resolve({ rows: match ? [match] : [], rowCount: match ? 1 : 0 });
    }

    if (text.includes('INSERT INTO import_file_content')) {
      const [importFileId, , content] = params as [string, string, Buffer, number];
      contentByFileId.set(importFileId, content);
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('INSERT INTO import_file')) {
      const [id, organizationId, originalFilename, fileFormat, sourceType, contentSha256, byteSize] =
        params as [string, string, string, 'CSV' | 'XLSX', string, string, number];
      const row: ImportFileRow = {
        id,
        organization_id: organizationId,
        original_filename: originalFilename,
        file_format: fileFormat,
        source_type: sourceType,
        content_sha256: contentSha256,
        byte_size: byteSize,
        validation_status: 'PENDING',
        row_count: null,
        error_count: null,
        warning_count: null,
      };
      importFiles.push(row);
      return Promise.resolve({ rows: [row], rowCount: 1 });
    }

    if (text.includes('INSERT INTO reconciliation_run')) {
      const [id, organizationId, label, accountIdentifier, frequency, periodYear, periodMonth] =
        params as [string, string, string, string | null, string, number, number | null];
      const createdAt = new Date(1717200000000 + runs.length).toISOString();
      runs.push({
        id,
        organization_id: organizationId,
        label,
        account_identifier: accountIdentifier,
        frequency,
        period_year: periodYear,
        period_month: periodMonth,
        status: 'DRAFT',
        matching_job_id: null,
        created_at: createdAt,
      });
      return Promise.resolve({ rows: [{ created_at: createdAt, status: 'DRAFT' }], rowCount: 1 });
    }

    if (text.includes('INSERT INTO run_source_file')) {
      const [id, , reconciliationRunId, importFileId, role] = params as [
        string,
        string,
        string,
        string,
        string,
      ];
      runSourceFiles.push({
        id,
        reconciliation_run_id: reconciliationRunId,
        import_file_id: importFileId,
        role,
        created_at: new Date(1717200000000 + runSourceFiles.length).toISOString(),
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('FROM reconciliation_run') && text.includes('FOR UPDATE')) {
      const [id] = params as [string];
      const row = runs.find((run) => run.id === id);
      return Promise.resolve({ rows: row ? [{ status: row.status }] : [], rowCount: row ? 1 : 0 });
    }

    if (text.includes('FROM reconciliation_user')) {
      // No seeded users in this fake -- submitted_by always resolves to NULL, matching the
      // documented local-login-fallback behavior. Not under test here; imports-endpoints.test.ts
      // is unaffected by it (create doesn't touch reconciliation_user at all).
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes("SET status = 'VALIDATING'")) {
      const [submittedBy, id] = params as [string | null, string];
      const run = runs.find((candidate) => candidate.id === id)!;
      run.status = 'VALIDATING';
      void submittedBy;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('INSERT INTO import_job')) {
      const [id] = params as [string];
      importJobs.push({ id, status: 'QUEUED' });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes("SET status = 'RUNNING'")) {
      const [, id] = params as [string, string];
      const job = importJobs.find((candidate) => candidate.id === id)!;
      job.status = 'RUNNING';
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes("SET status = 'FAILED'")) {
      const [, id] = params as [string, string];
      const job = importJobs.find((candidate) => candidate.id === id)!;
      job.status = 'FAILED';
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('FROM validation_rule_version')) {
      const rows = [...ruleVersionIdByCode.entries()].map(([rule_code, id]) => ({ rule_code, id }));
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    if (text.includes('INSERT INTO validation_issue')) {
      const [, , importFileId, , severity, code, rowNumber, entryId, field, message] = params as [
        string,
        string,
        string,
        string,
        'ERROR' | 'WARNING',
        string,
        number | null,
        string | null,
        string | null,
        string,
      ];
      capturedIssues.push({
        id: `issue-${capturedIssues.length + 1}`,
        import_file_id: importFileId,
        severity,
        code,
        row_number: rowNumber,
        entry_id: entryId,
        field,
        message,
        created_at: new Date(1717200000000 + capturedIssues.length).toISOString(),
      });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('INSERT INTO canonical_record')) {
      const [, , importFileId, , sourceType] = params as [string, string, string, string, string];
      capturedRecords.push({ import_file_id: importFileId, source_type: sourceType });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    // Phase 12's acceptPartialImport guard queries -- narrower shapes than listRunIssues/
    // listRunRecords's (a single import_file_id param, no runId prefix), so these must be
    // checked before the generic FROM validation_issue/FROM canonical_record handlers below or
    // the shared idx-based param-walking there would misread this query's one param.
    if (text.includes('FROM validation_issue') && text.includes('code IN (')) {
      const [importFileId] = params as [string];
      const hasStructuralError = capturedIssues.some(
        (row) =>
          row.import_file_id === importFileId &&
          row.severity === 'ERROR' &&
          ['STRUCT_HEADER_MISSING', 'STRUCT_COLUMN_MISSING', 'STRUCT_COLUMN_ORDER'].includes(row.code),
      );
      return Promise.resolve({ rows: hasStructuralError ? [{ '?column?': 1 }] : [], rowCount: hasStructuralError ? 1 : 0 });
    }

    if (text.includes('COUNT(*)::text AS count FROM canonical_record') && !text.includes('source_type')) {
      const [importFileId] = params as [string];
      const count = capturedRecords.filter((row) => row.import_file_id === importFileId).length;
      return Promise.resolve({ rows: [{ count: String(count) }], rowCount: 1 });
    }

    if (text.includes("UPDATE reconciliation_run SET status = 'PENDING_APPROVAL' WHERE id = $1")) {
      const [id] = params as [string];
      const run = runs.find((candidate) => candidate.id === id)!;
      run.status = 'PENDING_APPROVAL';
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('FROM validation_issue')) {
      let idx = 1;
      let severity: string | undefined;
      let code: string | undefined;
      let importFileId: string | undefined;
      if (text.includes('severity = $')) severity = params[idx++] as string;
      if (text.includes('code = $')) code = params[idx++] as string;
      if (text.includes('import_file_id = $')) importFileId = params[idx++] as string;

      const filtered = capturedIssues.filter(
        (row) =>
          (!severity || row.severity === severity) &&
          (!code || row.code === code) &&
          (!importFileId || row.import_file_id === importFileId),
      );

      if (text.startsWith('SELECT COUNT')) {
        return Promise.resolve({ rows: [{ count: String(filtered.length) }], rowCount: 1 });
      }

      const [limit, offset] = params.slice(idx) as [number, number];
      const page = filtered.slice(offset, offset + limit);
      return Promise.resolve({ rows: page, rowCount: page.length });
    }

    if (text.includes('FROM canonical_record')) {
      let idx = 1;
      let sourceType: string | undefined;
      let importFileId: string | undefined;
      if (text.includes('source_type = $')) sourceType = params[idx++] as string;
      if (text.includes('import_file_id = $')) importFileId = params[idx++] as string;

      const filtered = capturedRecords.filter(
        (row) =>
          (!sourceType || row.source_type === sourceType) &&
          (!importFileId || row.import_file_id === importFileId),
      );

      if (text.startsWith('SELECT COUNT')) {
        return Promise.resolve({ rows: [{ count: String(filtered.length) }], rowCount: 1 });
      }

      const [limit, offset] = params.slice(idx) as [number, number];
      const page = filtered.slice(offset, offset + limit);
      return Promise.resolve({ rows: page, rowCount: page.length });
    }

    if (text.includes('UPDATE import_file')) {
      const [validationStatus, rowCount, errorCount, warningCount, , , importFileId] = params as [
        string,
        number,
        number,
        number,
        string | null,
        string | null,
        string,
      ];
      const file = importFiles.find((candidate) => candidate.id === importFileId)!;
      file.validation_status = validationStatus;
      file.row_count = rowCount;
      file.error_count = errorCount;
      file.warning_count = warningCount;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('UPDATE reconciliation_run SET status = $1 WHERE id = $2')) {
      const [status, id] = params as [string, string];
      const run = runs.find((candidate) => candidate.id === id)!;
      run.status = status;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes("SET status = 'SUCCEEDED'")) {
      const [id] = params as [string];
      const job = importJobs.find((candidate) => candidate.id === id)!;
      job.status = 'SUCCEEDED';
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('UPDATE reconciliation_run SET matching_job_id')) {
      const [matchingJobId, id] = params as [string, string];
      const run = runs.find((candidate) => candidate.id === id)!;
      run.matching_job_id = matchingJobId;
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (text.includes('FROM reconciliation_run') && text.includes('WHERE id = $1')) {
      const [id] = params as [string];
      const row = runs.find((run) => run.id === id);
      return Promise.resolve({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
    }

    if (text.includes('FROM run_source_file rsf') && text.includes('JOIN import_file')) {
      const [reconciliationRunId, requestedFileId] = params as [string, string | undefined];
      const links = runSourceFiles
        .filter(
          (link) =>
            link.reconciliation_run_id === reconciliationRunId &&
            (!text.includes('AND f.id = $2') || link.import_file_id === requestedFileId),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const rows = links.map((link) => {
        const file = importFiles.find((candidate) => candidate.id === link.import_file_id)!;
        return {
          id: file.id,
          source_type: file.source_type,
          original_filename: file.original_filename,
          file_format: file.file_format,
          validation_status: file.validation_status,
          byte_size: file.byte_size,
          content_sha256: file.content_sha256,
          row_count: file.row_count,
          error_count: file.error_count,
          warning_count: file.warning_count,
          role: link.role,
        };
      });
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    if (text.includes('FROM reconciliation_payee_alias')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    throw new Error(`createFakeSubmitPool: unexpected query: ${text}`);
  };

  const clientQuery = (text: string, params: unknown[] = []) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('set_config(')) {
      return Promise.resolve({ rows: [{ set_config: params[1] }], rowCount: 1 });
    }
    return query(text, params);
  };

  return {
    query,
    connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
  } as unknown as Pool;
};

const appWithPool = (pool: Pool) =>
  createApp(undefined, undefined, undefined, pool as Parameters<typeof createApp>[3]);

const cleanBankCsv = Buffer.from(
  'Date,Description,Sequence Number,Check Number,Reference,Debit,Credit,Balance\n' +
    '2026-07-01,"Payroll deposit, biweekly",1,,REF-1,,100.00,1000.00\n' +
    '2026-07-02,Card purchase,2,,REF-2,84.23,,915.77\n' +
    '2026-07-03,Rent check,3,CHK-1001,REF-3,500.00,,415.77\n',
);

// Issue #141: a run now always carries two bank files (one per account); this is Account B's
// file, kept minimal since most tests here aren't about the merge itself.
const cleanBankCsvB = Buffer.from(
  'Date,Description,Sequence Number,Check Number,Reference,Debit,Credit,Balance\n' +
    '2026-07-01,Second account deposit,1,,REF-9,,50.00,50.00\n',
);

const cleanGlCsv = Buffer.from(
  'Date,Type,Num,Name,Memo,Amount\n' + '2026-07-03,Check,CHK-1001,Landlord LLC,Rent check,-500.00\n',
);

// Issue #141: the merge step always re-serializes the merged bank dataset with a canonical
// header row (BANKING_HEADERS), and a raw per-account file with no recognizable header is now
// rejected pre-merge (BankFileStructuralError, a 400 at POST /api/imports/runs itself, before any
// run is even created) -- so a header-less BANK file can no longer reach the STRUCT_HEADER_MISSING
// failure-detail/error-report/acceptPartialImport tests below the way it did pre-#141. The GL file
// is not merged and still goes through File Validation completely unchanged, so it's used instead
// to exercise the same downstream (post-persistence) HEADER-gate failure paths.
const invalidGlCsv = Buffer.from(
  '9001,First row is data not a header,100.00\n' + '9002,Second row is also data,-50.00\n',
);

// Header/column-order gates pass (matches cleanBankCsv's header exactly); row 1 is clean, row 2
// has an unparseable Credit -- a Step 3 (CELL_VALUES)-only failure, i.e. Screen 06's territory.
const partiallyInvalidBankCsv = Buffer.from(
  'Date,Description,Sequence Number,Check Number,Reference,Debit,Credit,Balance\n' +
    '2026-07-01,Payroll deposit,1,,REF-1,,100.00,1000.00\n' +
    '2026-07-02,Card purchase,2,,REF-2,,not-a-number,915.77\n',
);

const createRun = async (
  app: ReturnType<typeof appWithPool>,
  files: { bankFileA: Buffer; bankFileB: Buffer; glFile: Buffer } = {
    bankFileA: cleanBankCsv,
    bankFileB: cleanBankCsvB,
    glFile: cleanGlCsv,
  },
) =>
  authedApp(app, { role: 'senior-analyst' })
    .post('/api/imports/runs')
    .field('label', 'Submit Test Run')
    .field('frequency', 'MONTHLY')
    .field('periodYear', '2026')
    .attach('bankFiles', files.bankFileA, { filename: '1111_bank.csv', contentType: 'text/csv' })
    .attach('bankFiles', files.bankFileB, { filename: '2222_bank.csv', contentType: 'text/csv' })
    .attach('glFile', files.glFile, { filename: 'gl.csv', contentType: 'text/csv' });

describe('POST /api/imports/runs/:id/submit', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createFakeSubmitPool();
  });

  it('validates a clean run synchronously, passes, and links a matching_job_id', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app);
    expect(created.status).toBe(201);

    const response = await authedApp(app, { role: 'senior-analyst' }).post(
      `/api/imports/runs/${created.body.id}/submit`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ passed: true });
    expect(response.body.matchingJobId).toBeTruthy();
    expect(response.body.run).toMatchObject({ status: 'PENDING_APPROVAL' });
  });

  it('validates a run with a structurally invalid file, fails, and never sets matching_job_id', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app, { bankFileA: cleanBankCsv, bankFileB: cleanBankCsvB, glFile: invalidGlCsv });
    expect(created.status).toBe(201);

    const response = await authedApp(app, { role: 'senior-analyst' }).post(
      `/api/imports/runs/${created.body.id}/submit`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ passed: false });
    expect(response.body.matchingJobId).toBeUndefined();
    expect(response.body.run).toMatchObject({ status: 'VALIDATION_FAILED' });
  });

  it('returns 403 for a role other than senior-analyst', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app);

    const response = await authedApp(app, { role: 'financial-analyst' }).post(
      `/api/imports/runs/${created.body.id}/submit`,
    );

    expect(response.status).toBe(403);
  });

  it('returns 404 for an unknown run id', async () => {
    const app = appWithPool(pool);

    const response = await authedApp(app, { role: 'senior-analyst' }).post(
      '/api/imports/runs/00000000-0000-0000-0000-000000000000/submit',
    );

    expect(response.status).toBe(404);
  });

  it('returns 409 when the run is not DRAFT (already submitted)', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app);

    const first = await authedApp(app, { role: 'senior-analyst' }).post(
      `/api/imports/runs/${created.body.id}/submit`,
    );
    expect(first.status).toBe(200);

    const second = await authedApp(app, { role: 'senior-analyst' }).post(
      `/api/imports/runs/${created.body.id}/submit`,
    );
    expect(second.status).toBe(409);
  });

  it('returns 501 when no database pool is configured', async () => {
    const app = createApp(undefined, undefined, undefined, undefined);

    const response = await authedApp(app, { role: 'senior-analyst' }).post(
      '/api/imports/runs/some-id/submit',
    );

    expect(response.status).toBe(501);
  });
});

describe('GET /api/imports/runs/:id/files/:fileId/failure-detail (Phase 11)', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createFakeSubmitPool();
  });

  const submitFailingRun = async (app: ReturnType<typeof appWithPool>) => {
    const created = await createRun(app, { bankFileA: cleanBankCsv, bankFileB: cleanBankCsvB, glFile: invalidGlCsv });
    const submitted = await authedApp(app, { role: 'senior-analyst' }).post(
      `/api/imports/runs/${created.body.id}/submit`,
    );
    expect(submitted.body.run.status).toBe('VALIDATION_FAILED');
    const failedFile = submitted.body.run.files.find(
      (file: { validationStatus: string }) => file.validationStatus === 'INVALID',
    );
    return { runId: created.body.id, failedFile };
  };

  it('returns the gate sequence and header comparison for a HEADER-gate failure', async () => {
    const app = appWithPool(pool);
    const { runId, failedFile } = await submitFailingRun(app);

    const response = await authedApp(app, { role: 'senior-analyst' }).get(
      `/api/imports/runs/${runId}/files/${failedFile.importFileId}/failure-detail`,
    );

    expect(response.status).toBe(200);
    expect(response.body.gateSequence).toEqual([
      { gate: 'HEADER', state: 'FAILED' },
      { gate: 'COLUMN_ORDER', state: 'NOT_RUN' },
      { gate: 'CELL_VALUES', state: 'NOT_RUN' },
    ]);
    expect(response.body.headerComparison).toBeTruthy();
    expect(
      response.body.issues.some((issue: { code: string }) => issue.code === 'STRUCT_HEADER_MISSING'),
    ).toBe(true);
    expect(response.body.importableRowCount).toBe(0);
  });

  it('returns 404 when the file is not part of the given run', async () => {
    const app = appWithPool(pool);
    const { runId } = await submitFailingRun(app);

    const response = await authedApp(app, { role: 'senior-analyst' }).get(
      `/api/imports/runs/${runId}/files/00000000-0000-0000-0000-000000000000/failure-detail`,
    );

    expect(response.status).toBe(404);
  });

  it('returns 404 for an unknown run id', async () => {
    const app = appWithPool(pool);

    const response = await authedApp(app, { role: 'senior-analyst' }).get(
      '/api/imports/runs/00000000-0000-0000-0000-000000000000/files/some-file/failure-detail',
    );

    expect(response.status).toBe(404);
  });
});

describe('GET /api/imports/runs/:id/error-report.csv (Phase 11)', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createFakeSubmitPool();
  });

  it('returns a CSV with one row per finding, including the failed file\'s name', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app, { bankFileA: cleanBankCsv, bankFileB: cleanBankCsvB, glFile: invalidGlCsv });
    await authedApp(app, { role: 'senior-analyst' }).post(
      `/api/imports/runs/${created.body.id}/submit`,
    );

    const response = await authedApp(app, { role: 'senior-analyst' }).get(
      `/api/imports/runs/${created.body.id}/error-report.csv`,
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text.split('\n')[0]).toBe('file,line,column,code,severity,message,raw_value');
    expect(response.text).toContain('gl.csv');
    expect(response.text).toContain('STRUCT_HEADER_MISSING');
  });

  it('returns 404 for an unknown run id', async () => {
    const app = appWithPool(pool);

    const response = await authedApp(app, { role: 'senior-analyst' }).get(
      '/api/imports/runs/00000000-0000-0000-0000-000000000000/error-report.csv',
    );

    expect(response.status).toBe(404);
  });
});

describe('GET /api/imports/runs/:id/files/:fileId/rows (Phase 12)', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createFakeSubmitPool();
  });

  it('returns every row re-parsed from the stored file, annotated with its issue', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app, { bankFileA: partiallyInvalidBankCsv, bankFileB: cleanBankCsvB, glFile: cleanGlCsv });
    const submitted = await authedApp(app, { role: 'senior-analyst' }).post(
      `/api/imports/runs/${created.body.id}/submit`,
    );
    const bankFileId = submitted.body.run.files.find(
      (file: { role: string }) => file.role === 'BANK_MERGED',
    ).importFileId;

    const response = await authedApp(app, { role: 'senior-analyst' }).get(
      `/api/imports/runs/${created.body.id}/files/${bankFileId}/rows`,
    );

    expect(response.status).toBe(200);
    // 2 rows from bankFileA (partiallyInvalidBankCsv) + 1 clean row from bankFileB
    // (cleanBankCsvB), concatenated in that order by mergeBankFiles.
    expect(response.body.totalRows).toBe(3);
    expect(response.body.errorRowCount).toBe(1);
    expect(response.body.cleanRowCount).toBe(2);

    const [row1, row2, row3] = response.body.rows;
    expect(row1).toMatchObject({ lineNumber: 1, status: 'IMPORT', flaggedFields: {} });
    expect(row2.lineNumber).toBe(2);
    expect(row2.status).toBe('SKIP');
    expect(row2.flaggedFields.Credit).toBeTruthy();
    expect(row2.values.Description).toBe('Card purchase');
    expect(row3).toMatchObject({ lineNumber: 3, status: 'IMPORT', flaggedFields: {} });
    expect(row3.values.Description).toBe('Second account deposit');
  });

  it('returns 404 for an unknown file id', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app);
    await authedApp(app, { role: 'senior-analyst' }).post(`/api/imports/runs/${created.body.id}/submit`);

    const response = await authedApp(app, { role: 'senior-analyst' }).get(
      `/api/imports/runs/${created.body.id}/files/00000000-0000-0000-0000-000000000000/rows`,
    );

    expect(response.status).toBe(404);
  });
});

describe('POST /api/imports/runs/:id/import (Phase 12 Screen 06)', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createFakeSubmitPool();
  });

  it('accepts a partial-failure run, transitions to PENDING_APPROVAL, and triggers matching', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app, { bankFileA: partiallyInvalidBankCsv, bankFileB: cleanBankCsvB, glFile: cleanGlCsv });
    const submitted = await authedApp(app, { role: 'senior-analyst' }).post(
      `/api/imports/runs/${created.body.id}/submit`,
    );
    expect(submitted.body.run.status).toBe('VALIDATION_FAILED');

    const response = await authedApp(app, { role: 'senior-analyst' })
      .post(`/api/imports/runs/${created.body.id}/import`)
      .send({ skipInvalidRows: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'completed', passed: true });
    expect(response.body.matchingJobId).toBeTruthy();
    expect(response.body.run.status).toBe('PENDING_APPROVAL');
  });

  it('returns 409 for a structurally-failed run', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app, { bankFileA: cleanBankCsv, bankFileB: cleanBankCsvB, glFile: invalidGlCsv });
    await authedApp(app, { role: 'senior-analyst' }).post(`/api/imports/runs/${created.body.id}/submit`);

    const response = await authedApp(app, { role: 'senior-analyst' })
      .post(`/api/imports/runs/${created.body.id}/import`)
      .send({ skipInvalidRows: true });

    expect(response.status).toBe(409);
  });

  it('returns 400 when skipInvalidRows is not true', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app, { bankFileA: partiallyInvalidBankCsv, bankFileB: cleanBankCsvB, glFile: cleanGlCsv });
    await authedApp(app, { role: 'senior-analyst' }).post(`/api/imports/runs/${created.body.id}/submit`);

    const response = await authedApp(app, { role: 'senior-analyst' })
      .post(`/api/imports/runs/${created.body.id}/import`)
      .send({ skipInvalidRows: false });

    expect(response.status).toBe(400);
  });

  it('returns 403 for a role other than senior-analyst', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app, { bankFileA: partiallyInvalidBankCsv, bankFileB: cleanBankCsvB, glFile: cleanGlCsv });
    await authedApp(app, { role: 'senior-analyst' }).post(`/api/imports/runs/${created.body.id}/submit`);

    const response = await authedApp(app, { role: 'financial-analyst' })
      .post(`/api/imports/runs/${created.body.id}/import`)
      .send({ skipInvalidRows: true });

    expect(response.status).toBe(403);
  });

  it('returns 404 for an unknown run id', async () => {
    const app = appWithPool(pool);

    const response = await authedApp(app, { role: 'senior-analyst' })
      .post('/api/imports/runs/00000000-0000-0000-0000-000000000000/import')
      .send({ skipInvalidRows: true });

    expect(response.status).toBe(404);
  });

  it('returns 409 on a second call after the run has already been accepted', async () => {
    const app = appWithPool(pool);
    const created = await createRun(app, { bankFileA: partiallyInvalidBankCsv, bankFileB: cleanBankCsvB, glFile: cleanGlCsv });
    await authedApp(app, { role: 'senior-analyst' }).post(`/api/imports/runs/${created.body.id}/submit`);

    const first = await authedApp(app, { role: 'senior-analyst' })
      .post(`/api/imports/runs/${created.body.id}/import`)
      .send({ skipInvalidRows: true });
    expect(first.status).toBe(200);

    const second = await authedApp(app, { role: 'senior-analyst' })
      .post(`/api/imports/runs/${created.body.id}/import`)
      .send({ skipInvalidRows: true });
    expect(second.status).toBe(409);
  });
});
