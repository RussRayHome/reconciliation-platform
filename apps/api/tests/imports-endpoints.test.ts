import { beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

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

    if (text.includes('FROM reconciliation_run') && text.includes('WHERE id = $1')) {
      const [id] = params as [string];
      const row = runs.find((run) => run.id === id);
      return Promise.resolve({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
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

const bankCsv = Buffer.from(
  'transaction_id,account_id,posted_date,amount,currency_code,transaction_type,description\n' +
    'TXN-1,ACCT-1,2026-08-01,100.00,USD,CREDIT,Deposit\n',
);
const glXlsx = Buffer.from('gl-bytes-not-real-xlsx');

describe('imports endpoints', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createFakeImportsPool();
  });

  describe('POST /api/imports/runs', () => {
    it('creates a DRAFT run and returns 201 with both files, detecting format from extension', async () => {
      const response = await authedApp(appWithPool(pool), { role: 'senior-analyst' })
        .post('/api/imports/runs')
        .field('label', 'August 2026 Operating Recon')
        .field('accountIdentifier', 'OPERATING-001')
        .field('frequency', 'MONTHLY')
        .field('periodYear', '2026')
        .field('periodMonth', '8')
        .attach('bankFile', bankCsv, { filename: 'bank.csv', contentType: 'text/csv' })
        .attach('glFile', glXlsx, {
          filename: 'gl.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

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
      expect(files).toHaveLength(2);
      expect(files.find((file) => file.role === 'BANK')).toMatchObject({ fileFormat: 'CSV' });
      expect(files.find((file) => file.role === 'GL')).toMatchObject({ fileFormat: 'XLSX' });
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
        .attach('bankFile', bankCsv, { filename: 'bank.csv', contentType: 'text/csv' })
        .attach('glFile', bankCsv, { filename: 'gl.csv', contentType: 'text/csv' });

      expect(response.status).toBe(201);
      expect(response.body.files.every((file: { fileFormat: string }) => file.fileFormat === 'CSV')).toBe(
        true,
      );
    });

    it('returns 403 for a role other than senior-analyst', async () => {
      const response = await authedApp(appWithPool(pool), { role: 'financial-analyst' })
        .post('/api/imports/runs')
        .field('label', 'Should Be Blocked')
        .field('frequency', 'MONTHLY')
        .field('periodYear', '2026')
        .attach('bankFile', bankCsv, { filename: 'bank.csv', contentType: 'text/csv' })
        .attach('glFile', glXlsx, {
          filename: 'gl.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ message: expect.stringContaining('senior analyst') });
    });

    it('returns 400 when either file is missing', async () => {
      const response = await authedApp(appWithPool(pool), { role: 'senior-analyst' })
        .post('/api/imports/runs')
        .field('label', 'Missing GL')
        .field('frequency', 'MONTHLY')
        .field('periodYear', '2026')
        .attach('bankFile', bankCsv, { filename: 'bank.csv', contentType: 'text/csv' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ message: expect.stringContaining('bankFile and glFile') });
    });

    it('returns 400 when the body fails validation', async () => {
      const response = await authedApp(appWithPool(pool), { role: 'senior-analyst' })
        .post('/api/imports/runs')
        .field('frequency', 'WEEKLY')
        .field('periodYear', '2026')
        .attach('bankFile', bankCsv, { filename: 'bank.csv', contentType: 'text/csv' })
        .attach('glFile', glXlsx, {
          filename: 'gl.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ message: expect.any(String) });
    });

    it('returns 501 when no database pool is configured', async () => {
      const response = await authedApp(appWithPool(undefined), { role: 'senior-analyst' })
        .post('/api/imports/runs')
        .field('label', 'No Pool')
        .field('frequency', 'MONTHLY')
        .field('periodYear', '2026')
        .attach('bankFile', bankCsv, { filename: 'bank.csv', contentType: 'text/csv' })
        .attach('glFile', glXlsx, {
          filename: 'gl.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      expect(response.status).toBe(501);
    });
  });

  describe('GET /api/imports/runs/:id', () => {
    it('returns the run created by a prior POST', async () => {
      const app = appWithPool(pool);
      const created = await authedApp(app, { role: 'senior-analyst' })
        .post('/api/imports/runs')
        .field('label', 'Fetch Me')
        .field('frequency', 'ANNUAL')
        .field('periodYear', '2025')
        .attach('bankFile', bankCsv, { filename: 'bank.csv', contentType: 'text/csv' })
        .attach('glFile', glXlsx, {
          filename: 'gl.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

      const response = await authedApp(app).get(`/api/imports/runs/${created.body.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: created.body.id, label: 'Fetch Me', status: 'DRAFT' });
      expect(response.body.files).toHaveLength(2);
    });

    it('returns 404 for an unknown run id', async () => {
      const response = await authedApp(appWithPool(pool)).get(
        '/api/imports/runs/00000000-0000-0000-0000-000000000000',
      );

      expect(response.status).toBe(404);
    });

    it('returns 501 when no database pool is configured', async () => {
      const response = await authedApp(appWithPool(undefined)).get('/api/imports/runs/some-id');

      expect(response.status).toBe(501);
    });
  });
});
