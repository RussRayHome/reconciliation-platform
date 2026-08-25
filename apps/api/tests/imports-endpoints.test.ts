import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';

import { ERROR_DEFINITIONS, OPERATIONS } from '@recon/domain';

import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

const expectNoPoolError = (body: unknown, operation: keyof typeof OPERATIONS): void => {
  const definition = ERROR_DEFINITIONS['RCN-DB-001'];
  const parsed = body as { message: string; code: string; reference: string; retryable: boolean };
  expect(parsed.message).toBe(`Unable to ${OPERATIONS[operation]}. ${definition.publicMessage}`);
  expect(parsed.code).toBe('RCN-DB-001');
  expect(parsed.reference.length).toBeGreaterThan(0);
  expect(parsed.retryable).toBe(definition.retryable);
};

interface ImportFileRow {
  id: string;
  organization_id: string;
  original_filename: string;
  file_format: 'CSV' | 'XLSX';
  source_type: string;
  content_sha256: string;
  byte_size: number;
  validation_status: string;
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
  created_at: string;
}

interface RunSourceFileRow {
  id: string;
  reconciliation_run_id: string;
  import_file_id: string;
  role: string;
  created_at: string;
}

/**
 * Stateful fake backing import_file/import_file_content/reconciliation_run/run_source_file
 * (changesets 0042/0045). PostgresImportRunStore.createRun runs entirely inside
 * runInTenantScope (packages/persistence/src/postgres.ts) -- a single pool.connect() client
 * doing BEGIN / SET LOCAL app.current_organization_id / ... / COMMIT -- so the fake has to answer
 * pool.connect(), not just pool.query, matching alias-endpoints.test.ts's own fake. Insert
 * branches are order-sensitive: 'INSERT INTO import_file_content' is checked before the plain
 * 'INSERT INTO import_file' insert, since the latter is a substring of the former.
 */
const createFakeImportsPool = () => {
  const importFiles: ImportFileRow[] = [];
  const runs: RunRow[] = [];
  const runSourceFiles: RunSourceFileRow[] = [];

  const query = (
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: unknown[]; rowCount: number }> => {
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
      };
      importFiles.push(row);
      return Promise.resolve({ rows: [row], rowCount: 1 });
    }

    // Unreconciled Item Roll-Forward PR E.2/§3.8 point 4: createRun's pre-check for an existing
    // CLOSED run blocking the same account+period. No test in this file seeds a CLOSED run, so
    // this always answers "no closed period blocks this create."
    if (text.includes("status = 'CLOSED'") && text.includes('FROM reconciliation_run')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
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

    // Issue #154: loadRunSummaryWithClient's run query now LEFT JOINs reconciliation_job and is
    // aliased (r./j.) -- matched by the LEFT JOIN fragment specifically, distinct from
    // getLatestRunSummary's own plain "SELECT id FROM reconciliation_run" lookup below. No test
    // in this file seeds a reconciliation_job row, so the joined columns are always null here --
    // real Stage-2-shape coverage lives in packages/persistence/tests/importRunStore.test.ts
    // against a real Postgres, not duplicated here.
    if (text.includes('LEFT JOIN reconciliation_job')) {
      const [id] = params as [string];
      const row = runs.find((run) => run.id === id);
      return Promise.resolve({
        rows: row
          ? [
              {
                ...row,
                matching_job_id: null,
                job_current_state: null,
                job_failure_code: null,
                job_failure_message: null,
                job_completed_at: null,
              },
            ]
          : [],
        rowCount: row ? 1 : 0,
      });
    }

    // getLatestRunSummary's own "pick the newest run for this org" lookup -- distinct from the
    // by-id lookup above (that one always includes the LEFT JOIN fragment; this one never does).
    if (text.includes('SELECT id') && text.includes('FROM reconciliation_run') && text.includes('ORDER BY created_at DESC')) {
      const [organizationId] = params as [string];
      const latest = runs
        .filter((run) => run.organization_id === organizationId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return Promise.resolve({ rows: latest ? [{ id: latest.id }] : [], rowCount: latest ? 1 : 0 });
    }

    // Issue #154: the newest import_job row for a run -- no test in this file seeds one, so this
    // always answers "no validation job recorded" (null), matching a run created straight through
    // POST /api/imports/runs with no subsequent submit/failure. Real coverage for FAILED/SUCCEEDED
    // import_job shapes lives in the Postgres-backed importRunStore.test.ts suite.
    if (text.includes('FROM import_job')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes('FROM run_source_file rsf') && text.includes('JOIN import_file')) {
      const [reconciliationRunId] = params as [string];
      const links = runSourceFiles
        .filter((link) => link.reconciliation_run_id === reconciliationRunId)
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
          role: link.role,
        };
      });
      return Promise.resolve({ rows, rowCount: rows.length });
    }

    throw new Error(`createFakeImportsPool: unexpected query: ${text}`);
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

const appWithPool = (pool?: Pool) =>
  createApp(undefined, undefined, undefined, pool as Parameters<typeof createApp>[3]);

const bankCsvA = Buffer.from(
  'Date,Description,Sequence Number,Debit,Credit,Balance\n' + '2026-08-01,Deposit,1,,100.00,100.00\n',
);
const bankCsvB = Buffer.from(
  'Date,Description,Sequence Number,Debit,Credit,Balance\n' +
    '2026-08-01,Second account deposit,1,,50.00,50.00\n',
);
// Distinct content for the #153 4-account test -- reusing bankCsvA/B a second time would trip the
// byte-identical dedupe-collision guard, which is exactly what it's supposed to do.
const bankCsvC = Buffer.from(
  'Date,Description,Sequence Number,Debit,Credit,Balance\n' +
    '2026-08-01,Third account deposit,1,,25.00,25.00\n',
);
const bankCsvD = Buffer.from(
  'Date,Description,Sequence Number,Debit,Credit,Balance\n' +
    '2026-08-01,Fourth account deposit,1,,10.00,10.00\n',
);
// Issue #141's pre-merge structural gate (mergeBankFiles) rejects this before it ever reaches
// createRun -- kept as a fixture for the "structurally invalid" test below, not for the happy-path
// tests above, which need real BANKING_HEADERS-shaped content to reach 201.
const structurallyInvalidBankCsv = Buffer.from(
  'transaction_id,account_id,posted_date,amount,currency_code,transaction_type,description\n' +
    'TXN-1,ACCT-1,2026-08-01,100.00,USD,CREDIT,Deposit\n',
);
const glXlsx = Buffer.from('gl-bytes-not-real-xlsx');

/** Issue #153: `bankFiles` is one repeated field (1-4 uploads), not per-slot `bankFileA`/
 * `bankFileB` names. Defaults to today's 2-file happy path; pass `bankFiles` to override count,
 * content, or filenames for a specific test. */
const attachImportFiles = (
  request: ReturnType<ReturnType<typeof authedApp>['post']>,
  overrides: { bankFiles?: Array<{ buffer?: Buffer; filename?: string }> } = {},
) => {
  const bankFiles = overrides.bankFiles ?? [
    { buffer: bankCsvA, filename: '1111_bank.csv' },
    { buffer: bankCsvB, filename: '2222_bank.csv' },
  ];

  let req = request;
  bankFiles.forEach((file, index) => {
    req = req.attach('bankFiles', file.buffer ?? bankCsvA, {
      filename: file.filename ?? `${1111 * (index + 1)}_bank.csv`,
      contentType: 'text/csv',
    });
  });

  return req.attach('glFile', glXlsx, {
    filename: 'gl.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

describe('imports endpoints', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createFakeImportsPool();
  });

  describe('POST /api/imports/runs', () => {
    it('creates a DRAFT run and returns 201 with all four files, detecting format from extension', async () => {
      const response = await attachImportFiles(
        authedApp(appWithPool(pool), { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('label', 'August 2026 Operating Recon')
          .field('accountIdentifier', 'OPERATING-001')
          .field('frequency', 'MONTHLY')
          .field('periodYear', '2026')
          .field('periodMonth', '8'),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        label: 'August 2026 Operating Recon',
        accountIdentifier: 'OPERATING-001',
        frequency: 'MONTHLY',
        periodYear: 2026,
        periodMonth: 8,
        status: 'DRAFT',
      });

      const files = response.body.files as Array<{ role: string; fileFormat: string }>;
      expect(files).toHaveLength(4);
      expect(files.find((file) => file.role === 'BANK_ACCOUNT_1')).toMatchObject({ fileFormat: 'CSV' });
      expect(files.find((file) => file.role === 'BANK_ACCOUNT_2')).toMatchObject({ fileFormat: 'CSV' });
      expect(files.find((file) => file.role === 'BANK_MERGED')).toMatchObject({ fileFormat: 'CSV' });
      expect(files.find((file) => file.role === 'GL')).toMatchObject({ fileFormat: 'XLSX' });
    });

    it('creates a DRAFT run with just 1 bank account (the #153 minimum)', async () => {
      const response = await attachImportFiles(
        authedApp(appWithPool(pool), { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('label', 'Single Account Recon')
          .field('frequency', 'MONTHLY')
          .field('periodYear', '2026'),
        { bankFiles: [{ buffer: bankCsvA, filename: '1111_bank.csv' }] },
      );

      expect(response.status).toBe(201);
      const files = response.body.files as Array<{ role: string; fileFormat: string }>;
      expect(files).toHaveLength(3);
      expect(files.find((file) => file.role === 'BANK_ACCOUNT_1')).toMatchObject({ fileFormat: 'CSV' });
      expect(files.find((file) => file.role === 'BANK_MERGED')).toMatchObject({ fileFormat: 'CSV' });
      expect(files.find((file) => file.role === 'GL')).toMatchObject({ fileFormat: 'XLSX' });
    });

    it('creates a DRAFT run with 4 bank accounts (the #153 maximum)', async () => {
      const response = await attachImportFiles(
        authedApp(appWithPool(pool), { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('label', 'Four Account Recon')
          .field('frequency', 'MONTHLY')
          .field('periodYear', '2026'),
        {
          bankFiles: [
            { buffer: bankCsvA, filename: '1111_bank.csv' },
            { buffer: bankCsvB, filename: '2222_bank.csv' },
            { buffer: bankCsvC, filename: '3333_bank.csv' },
            { buffer: bankCsvD, filename: '4444_bank.csv' },
          ],
        },
      );

      expect(response.status).toBe(201);
      const files = response.body.files as Array<{ role: string; fileFormat: string }>;
      expect(files).toHaveLength(6);
      for (const index of [1, 2, 3, 4]) {
        expect(files.find((file) => file.role === `BANK_ACCOUNT_${index}`)).toMatchObject({
          fileFormat: 'CSV',
        });
      }
    });

    it('returns 400 for a 5th bank account (exceeds the #153 maximum of 4)', async () => {
      const response = await attachImportFiles(
        authedApp(appWithPool(pool), { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('label', 'Five Account Recon')
          .field('frequency', 'MONTHLY')
          .field('periodYear', '2026'),
        {
          bankFiles: [
            { buffer: bankCsvA, filename: '1111_bank.csv' },
            { buffer: bankCsvB, filename: '2222_bank.csv' },
            { buffer: bankCsvA, filename: '3333_bank.csv' },
            { buffer: bankCsvB, filename: '4444_bank.csv' },
            { buffer: bankCsvA, filename: '5555_bank.csv' },
          ],
        },
      );

      expect(response.status).toBe(400);
    });

    it('rejects a .csv upload sent through a client that mislabels its extension the same way the old .xlsx-only filter would have', async () => {
      // Regression guard for the fix that split `upload` (.xlsx only, /api/reconciliation/run)
      // from `importUpload` (.xlsx + .csv, /api/imports/runs): a .csv bankFile must reach the
      // route (and get a normal validation response), not be rejected by multer's file filter.
      const response = await authedApp(appWithPool(pool), { role: 'senior-analyst' })
        .post('/api/imports/runs')
        .field('label', 'CSV-only run')
        .field('frequency', 'MONTHLY')
        .field('periodYear', '2026')
        .attach('bankFiles', bankCsvA, { filename: '1111_bank.csv', contentType: 'text/csv' })
        .attach('bankFiles', bankCsvB, { filename: '2222_bank.csv', contentType: 'text/csv' })
        .attach('glFile', bankCsvA, { filename: 'gl.csv', contentType: 'text/csv' });

      expect(response.status).toBe(201);
      expect(response.body.files.every((file: { fileFormat: string }) => file.fileFormat === 'CSV')).toBe(
        true,
      );
    });

    it('returns 403 for a role other than senior-analyst', async () => {
      const response = await attachImportFiles(
        authedApp(appWithPool(pool), { role: 'financial-analyst' })
          .post('/api/imports/runs')
          .field('label', 'Should Be Blocked')
          .field('frequency', 'MONTHLY')
          .field('periodYear', '2026'),
      );

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ message: expect.stringContaining('senior analyst') });
    });

    it('returns 400 when a file is missing', async () => {
      const response = await authedApp(appWithPool(pool), { role: 'senior-analyst' })
        .post('/api/imports/runs')
        .field('label', 'Missing Files')
        .field('frequency', 'MONTHLY')
        .field('periodYear', '2026')
        .attach('bankFiles', bankCsvA, { filename: '1111_bank.csv', contentType: 'text/csv' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message: expect.stringContaining('bankFiles'),
      });
    });

    it('returns 400 when zero bank files are attached', async () => {
      const response = await authedApp(appWithPool(pool), { role: 'senior-analyst' })
        .post('/api/imports/runs')
        .field('label', 'No Bank Files')
        .field('frequency', 'MONTHLY')
        .field('periodYear', '2026')
        .attach('glFile', glXlsx, {
          filename: 'gl.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message: expect.stringContaining('bankFiles'),
      });
    });

    it('returns 400 when two bank files are byte-identical', async () => {
      const response = await authedApp(appWithPool(pool), { role: 'senior-analyst' })
        .post('/api/imports/runs')
        .field('label', 'Identical Bank Files')
        .field('frequency', 'MONTHLY')
        .field('periodYear', '2026')
        .attach('bankFiles', bankCsvA, { filename: '1111_bank.csv', contentType: 'text/csv' })
        .attach('bankFiles', bankCsvA, { filename: '2222_bank.csv', contentType: 'text/csv' })
        .attach('glFile', glXlsx, {
          filename: 'gl.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message: expect.stringContaining('cannot be identical uploads'),
      });
    });

    it('returns 400 naming the file when a bank filename has no account-number prefix', async () => {
      const response = await attachImportFiles(
        authedApp(appWithPool(pool), { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('label', 'Bad Filename')
          .field('frequency', 'MONTHLY')
          .field('periodYear', '2026'),
        {
          bankFiles: [
            { buffer: bankCsvA, filename: '1111_bank.csv' },
            { buffer: bankCsvB, filename: 'checking-account.csv' },
          ],
        },
      );

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message: expect.stringContaining('checking-account.csv'),
      });
    });

    it('returns 400 with structural issues when a raw bank file fails Step 1/Step 2 on its own', async () => {
      const response = await attachImportFiles(
        authedApp(appWithPool(pool), { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('label', 'Structurally Invalid Bank File')
          .field('frequency', 'MONTHLY')
          .field('periodYear', '2026'),
        {
          bankFiles: [
            { buffer: structurallyInvalidBankCsv, filename: '1111_bank.csv' },
            { buffer: bankCsvB, filename: '2222_bank.csv' },
          ],
        },
      );

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        originalFilename: '1111_bank.csv',
        issues: expect.arrayContaining([expect.objectContaining({ code: 'STRUCT_HEADER_MISSING' })]),
      });
    });

    it('returns 400 when the body fails validation', async () => {
      const response = await attachImportFiles(
        authedApp(appWithPool(pool), { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('frequency', 'WEEKLY')
          .field('periodYear', '2026'),
      );

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ message: expect.any(String) });
    });

    it('returns 503 when no database pool is configured', async () => {
      const response = await attachImportFiles(
        authedApp(appWithPool(undefined), { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('label', 'No Pool')
          .field('frequency', 'MONTHLY')
          .field('periodYear', '2026'),
      );

      expect(response.status).toBe(ERROR_DEFINITIONS['RCN-DB-001'].httpStatus);
      expectNoPoolError(response.body, 'IMPORT_RUN_CREATE');
    });
  });

  describe('GET /api/imports/runs/:id', () => {
    it('returns the run created by a prior POST', async () => {
      const app = appWithPool(pool);
      const created = await attachImportFiles(
        authedApp(app, { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('label', 'Fetch Me')
          .field('frequency', 'ANNUAL')
          .field('periodYear', '2025'),
      );

      const response = await authedApp(app).get(`/api/imports/runs/${created.body.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: created.body.id, label: 'Fetch Me', status: 'DRAFT' });
      expect(response.body.files).toHaveLength(4);
    });

    it('returns 404 for an unknown run id', async () => {
      const response = await authedApp(appWithPool(pool)).get(
        '/api/imports/runs/00000000-0000-0000-0000-000000000000',
      );

      expect(response.status).toBe(404);
    });

    it('returns 503 when no database pool is configured', async () => {
      const response = await authedApp(appWithPool(undefined)).get('/api/imports/runs/some-id');

      expect(response.status).toBe(ERROR_DEFINITIONS['RCN-DB-001'].httpStatus);
      expectNoPoolError(response.body, 'IMPORT_RUN_GET');
    });
  });

  describe('GET /api/imports/runs/latest (Issue #154)', () => {
    it('returns the most recently created run for the organization', async () => {
      const app = appWithPool(pool);
      await attachImportFiles(
        authedApp(app, { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('label', 'Older Run')
          .field('frequency', 'ANNUAL')
          .field('periodYear', '2025'),
      );
      const newer = await attachImportFiles(
        authedApp(app, { role: 'senior-analyst' })
          .post('/api/imports/runs')
          .field('label', 'Newer Run')
          .field('frequency', 'ANNUAL')
          .field('periodYear', '2025'),
      );

      const response = await authedApp(app).get('/api/imports/runs/latest');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: newer.body.id, label: 'Newer Run' });
    });

    it('returns 204 for an organization with no runs yet', async () => {
      const response = await authedApp(appWithPool(pool)).get('/api/imports/runs/latest');

      expect(response.status).toBe(204);
    });

    it('is not shadowed by GET /api/imports/runs/:id (route-ordering regression)', async () => {
      // If 'latest' were ever registered below ':id', Express would match it as an :id lookup
      // and this would 404 with "Import run not found." instead of the empty-org 204 above.
      const response = await authedApp(appWithPool(pool)).get('/api/imports/runs/latest');

      expect(response.status).not.toBe(404);
      expect(response.body).not.toMatchObject({ message: 'Import run not found.' });
    });

    it('returns 401 without a bearer token', async () => {
      const response = await request(appWithPool(pool)).get('/api/imports/runs/latest');

      expect(response.status).toBe(401);
    });

    it('returns 503 when no database pool is configured', async () => {
      const response = await authedApp(appWithPool(undefined)).get('/api/imports/runs/latest');

      expect(response.status).toBe(ERROR_DEFINITIONS['RCN-DB-001'].httpStatus);
      expectNoPoolError(response.body, 'IMPORT_RUN_LATEST');
    });
  });
});
