import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import type { NormalizedTransaction, RawTransactionRow, SourceFile } from '@recon/domain';
import { PostgresReconciliationLifecycleStore, listNormalizedTransactionsForRun } from '../src';
import { createDatabaseFromTemplate } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

/**
 * The replay estimate's input side (ADR-0018, Issue #531).
 *
 * To show an approver what a DRAFT rule version would have produced against a closed period, the
 * engine has to be handed exactly what that period matched on. This proves the round trip: what
 * `persistNormalizedRows` wrote is what `listNormalizedTransactionsForRun` returns, field for
 * field -- because a replay rebuilt from a lossy projection would diverge from the original run for
 * reasons unrelated to the proposed rule, and every delta would be untrustworthy while looking
 * entirely plausible.
 */
describe('Replay inputs (against the Liquibase-migrated database)', () => {
  let database: TestDatabase | undefined;
  let pool: Pool;
  let store: PostgresReconciliationLifecycleStore;
  let organizationId: string;

  const buildSourceFile = (id: string, source: 'bank' | 'gl'): SourceFile => ({
    id,
    source,
    fileName: `${source}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 1024,
    worksheetName: 'Transactions',
    headerRow: 1,
    transactionStartRow: 2,
    excludedRowNumbers: [],
    uploadedAt: new Date().toISOString(),
  });

  const buildRawRow = (
    id: string,
    sourceFileId: string,
    source: 'bank' | 'gl',
    lineNumber: number,
  ): RawTransactionRow =>
    ({
      id,
      sourceFileId,
      source,
      spreadsheetFileName: `${source}.xlsx`,
      worksheetName: 'Transactions',
      lineNumber,
      rawValues: { Description: `Row ${lineNumber}` },
      excluded: false,
      parsingIssues: [],
    }) as RawTransactionRow;

  /** Deliberately populates every field the matching engine reads, so a dropped column shows up. */
  const buildCanonicalRow = (
    id: string,
    rawRowId: string,
    sourceFileId: string,
    source: 'bank' | 'gl',
    lineNumber: number,
  ): NormalizedTransaction =>
    ({
      id,
      runId: 'seeded',
      rawRowId,
      sourceFileId,
      source,
      spreadsheetFileName: `${source}.xlsx`,
      worksheetName: 'Transactions',
      lineNumber,
      transactionDate: '2026-01-15',
      postingDate: '2026-01-16',
      transactionType: 'Check',
      checkNumber: `10${lineNumber}`,
      serialNumber: `S${lineNumber}`,
      referenceNumber: `REF-${lineNumber}`,
      description: `Payment to Northwind ${lineNumber}`,
      merchantName: 'Northwind',
      payeeName: 'Northwind Traders',
      amount: lineNumber * 10,
      splitAmount: null,
      debit: null,
      credit: null,
      runningBalance: 500,
      normalizedComparisonText: `PAYMENT NORTHWIND ${lineNumber}`,
      normalizedComparisonTokens: ['PAYMENT', 'NORTHWIND', String(lineNumber)],
      normalizedReferenceTokens: [`REF${lineNumber}`],
      rawSourceValues: { Description: `Payment to Northwind ${lineNumber}` },
      dataQualityIssues: [],
      isExcluded: false,
      isZeroAmount: false,
      contextFingerprint: `${source}-${lineNumber}`,
      accountIdentifier: 'OPERATING-001',
    }) as NormalizedTransaction;

  const seedRun = async (): Promise<{ runId: string; rows: NormalizedTransaction[] }> => {
    const jobId = randomUUID();
    const bankSourceFileId = randomUUID();
    const glSourceFileId = randomUUID();
    const startedAt = new Date().toISOString();

    await store.createJob({
      jobId,
      correlationId: `corr-${jobId.slice(0, 8)}`,
      startedAt,
      rulepackVersion: '2026-04-06',
      organizationId,
      accountIdentifier: 'OPERATING-001',
      periodLabel: 'January 2026',
      reconciliationFrequency: 'Monthly',
      inputFingerprint: `fp-${jobId.slice(0, 8)}`,
      sourceFiles: [
        {
          id: bankSourceFileId,
          sourceSystem: 'bank',
          sourceFormat: 'xlsx',
          fileName: 'bank.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: 1024,
          sha256: 'bank-sha',
          uploadedAt: startedAt,
        },
        {
          id: glSourceFileId,
          sourceSystem: 'gl',
          sourceFormat: 'xlsx',
          fileName: 'gl.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: 1024,
          sha256: 'gl-sha',
          uploadedAt: startedAt,
        },
      ],
    });

    const sourceFiles = [
      buildSourceFile(bankSourceFileId, 'bank'),
      buildSourceFile(glSourceFileId, 'gl'),
    ];
    const rawRows = [
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 2),
      buildRawRow(randomUUID(), glSourceFileId, 'gl', 2),
    ];
    await store.persistParsedRows(organizationId, jobId, sourceFiles, rawRows);

    const rows = rawRows.map((row) =>
      buildCanonicalRow(randomUUID(), row.id, row.sourceFileId, row.source, row.lineNumber),
    );
    await store.persistNormalizedRows(organizationId, jobId, rows);

    return { runId: jobId, rows };
  };

  beforeAll(async () => {
    database = await createDatabaseFromTemplate('recon_replay_inputs');
    pool = database.pool;
    store = new PostgresReconciliationLifecycleStore(pool);
    const found = await pool.query<{ id: string }>(
      "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
    );
    const id = found.rows[0]?.id;
    if (!id) throw new Error("Expected migrations to seed a 'Default Organization' row.");
    organizationId = id;
  });

  afterAll(async () => {
    if (database) {
      await database.drop();
    }
  });

  // The fields listed here are the ones a replay would silently lose if it were rebuilt from
  // `canonical_record` (the file-import projection) instead: it has no checkNumber, serialNumber,
  // merchantName, payeeName or transactionType columns, and the engine matches on all of them.
  it('round-trips every field the matching engine reads', async () => {
    const { runId, rows } = await seedRun();

    const read = await listNormalizedTransactionsForRun(pool, organizationId, runId);

    expect(read).toHaveLength(rows.length);
    const first = read.find((row) => row.id === rows[0]!.id);
    expect(first).toBeDefined();
    expect(first).toMatchObject({
      checkNumber: rows[0]!.checkNumber,
      serialNumber: rows[0]!.serialNumber,
      referenceNumber: rows[0]!.referenceNumber,
      transactionType: rows[0]!.transactionType,
      merchantName: rows[0]!.merchantName,
      payeeName: rows[0]!.payeeName,
      description: rows[0]!.description,
      source: rows[0]!.source,
      lineNumber: rows[0]!.lineNumber,
      accountIdentifier: rows[0]!.accountIdentifier,
    });
  });

  // The comparison tokens are what the text-similarity rules actually operate on. Losing them
  // would not fail a shape check -- the rows would still be there, and would simply stop matching.
  it('preserves the comparison and reference tokens the similarity rules use', async () => {
    const { runId, rows } = await seedRun();

    const read = await listNormalizedTransactionsForRun(pool, organizationId, runId);
    const first = read.find((row) => row.id === rows[0]!.id)!;

    expect(first.normalizedComparisonTokens).toEqual(rows[0]!.normalizedComparisonTokens);
    expect(first.normalizedReferenceTokens).toEqual(rows[0]!.normalizedReferenceTokens);
    expect(first.normalizedComparisonText).toBe(rows[0]!.normalizedComparisonText);
  });

  it('scopes to one run, and to one organization', async () => {
    const first = await seedRun();
    const second = await seedRun();

    const read = await listNormalizedTransactionsForRun(pool, organizationId, first.runId);
    expect(read.map((row) => row.id).sort()).toEqual(first.rows.map((row) => row.id).sort());

    const other = await pool.query<{ id: string }>(
      "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Replay Inputs Other Org') RETURNING id",
    );
    expect(
      await listNormalizedTransactionsForRun(pool, other.rows[0]!.id, second.runId),
    ).toEqual([]);
  });

  // Distinct from "no difference": a period with no retained rows cannot be replayed at all, and
  // the caller turns this into a stated reason rather than three zeros.
  it('returns an empty set for a run with no retained rows', async () => {
    expect(await listNormalizedTransactionsForRun(pool, organizationId, randomUUID())).toEqual([]);
  });
});
