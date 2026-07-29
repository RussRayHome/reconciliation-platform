import type {
  ExceptionItem,
  GroupedMatchResult,
  MatchResult,
  NormalizedTransaction,
  OutputWorkbook,
  RawTransactionRow,
  ReviewerDecision,
  ReviewerObservation,
  SourceFile,
  SummaryMetrics,
} from '@recon/domain';
import {
  PostgresReconciliationLifecycleStore,
  PostgresReconciliationReadModelStore,
  computeSha256Hex,
  createPostgresPool,
  runPostgresMigrations,
} from '../src';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GenericContainer } from 'testcontainers';
import type { Pool } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import { randomUUID } from 'node:crypto';

let container: StartedTestContainer;
let pool: Pool;
let startupError: Error | null = null;

const buildSourceFile = (id: string, source: 'bank' | 'qbo'): SourceFile => ({
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
  source: 'bank' | 'qbo',
  lineNumber: number,
): RawTransactionRow => ({
  id,
  sourceFileId,
  source,
  spreadsheetFileName: `${source}.xlsx`,
  worksheetName: 'Transactions',
  lineNumber,
  rawValues: { Description: `Row ${lineNumber}`, Amount: lineNumber * 10 },
  transactionDateRaw: '2025-01-01',
  amountRaw: String(lineNumber * 10),
  excluded: false,
  parsingIssues: [],
});

const buildCanonicalRow = (
  id: string,
  rawRowId: string,
  sourceFileId: string,
  source: 'bank' | 'qbo',
  lineNumber: number,
): NormalizedTransaction => ({
  id,
  runId: 'job-1',
  rawRowId,
  sourceFileId,
  source,
  spreadsheetFileName: `${source}.xlsx`,
  worksheetName: 'Transactions',
  lineNumber,
  transactionDate: '2025-01-01',
  amount: lineNumber * 10,
  splitAmount: null,
  debit: null,
  credit: null,
  runningBalance: null,
  normalizedComparisonText: `ROW ${lineNumber}`,
  normalizedComparisonTokens: ['ROW', String(lineNumber)],
  normalizedReferenceTokens: [],
  rawSourceValues: { Description: `Row ${lineNumber}` },
  dataQualityIssues: [],
  isExcluded: false,
  isZeroAmount: false,
  contextFingerprint: `${source}-${lineNumber}`,
});

const buildSummary = (): SummaryMetrics => ({
  totalRecordsReviewed: 4,
  bankRecords: 2,
  qboRecords: 2,
  exactMatches: 1,
  probableMatches: 1,
  unmatchedItems: 1,
  duplicates: 0,
  bankDuplicates: 0,
  qboDuplicates: 0,
  dateVariances: 0,
  timingDifferences: 0,
  dataQualityIssues: 0,
  amountMismatches: 0,
  missingFromBank: 0,
  missingFromQBO: 1,
  unmatchedBankNetAmount: 0,
  unmatchedQboNetAmount: 10,
  cleanMatchedAmount: 20,
  unresolvedExposure: 10,
  countsByCategory: { MissingFromQBO: 1 },
  amountByCategory: { MissingFromQBO: 10 },
  charts: [
    { id: 'countByCategory', title: 'Counts', data: [{ label: 'MissingFromQBO', value: 1 }] },
    { id: 'exposureByCategory', title: 'Exposure', data: [{ label: 'MissingFromQBO', value: 10 }] },
  ],
});

const createRegisteredJob = async (
  store: PostgresReconciliationLifecycleStore,
  overrides: Partial<CreateJobOverrides> = {},
) => {
  const jobId = overrides.jobId ?? randomUUID();
  const bankSourceFileId = overrides.bankSourceFileId ?? randomUUID();
  const qboSourceFileId = overrides.qboSourceFileId ?? randomUUID();
  const startedAt = overrides.startedAt ?? new Date().toISOString();

  await store.createJob({
    jobId,
    correlationId: overrides.correlationId ?? 'corr-helper',
    startedAt,
    rulepackVersion: overrides.rulepackVersion ?? '2026-04-06',
    accountIdentifier: overrides.accountIdentifier,
    periodLabel: overrides.periodLabel,
    reconciliationFrequency: overrides.reconciliationFrequency,
    inputFingerprint: overrides.inputFingerprint,
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
        id: qboSourceFileId,
        sourceSystem: 'qbo',
        sourceFormat: 'xlsx',
        fileName: 'qbo.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 1024,
        sha256: 'qbo-sha',
        uploadedAt: startedAt,
      },
    ],
  });

  return { jobId, bankSourceFileId, qboSourceFileId, startedAt };
};

type CreateJobOverrides = {
  jobId: string;
  bankSourceFileId: string;
  qboSourceFileId: string;
  startedAt: string;
  correlationId: string;
  rulepackVersion: string;
  accountIdentifier: string;
  periodLabel: string;
  reconciliationFrequency: 'Monthly' | 'Annual';
  inputFingerprint: string;
};

const createReviewReadyJob = async (store: PostgresReconciliationLifecycleStore) => {
  const { jobId, bankSourceFileId, qboSourceFileId } = await createRegisteredJob(store, {
    correlationId: 'corr-review-ready',
    accountIdentifier: 'OPERATING-001',
    periodLabel: 'January 2025',
    reconciliationFrequency: 'Monthly',
    inputFingerprint: 'fingerprint-review-ready',
  });

  const sourceFiles = [
    buildSourceFile(bankSourceFileId, 'bank'),
    buildSourceFile(qboSourceFileId, 'qbo'),
  ];
  const rawRows = [
    buildRawRow(randomUUID(), bankSourceFileId, 'bank', 2),
    buildRawRow(randomUUID(), qboSourceFileId, 'qbo', 2),
  ];
  await store.persistParsedRows(jobId, sourceFiles, rawRows);

  const canonicalRows = rawRows.map((row) =>
    buildCanonicalRow(randomUUID(), row.id, row.sourceFileId, row.source, row.lineNumber),
  );
  await store.persistNormalizedRows(jobId, canonicalRows);

  const probableMatch: MatchResult = {
    id: randomUUID(),
    disposition: 'ProbableMatch',
    confidence: 'Probable',
    ruleId: 'amount-date-reference-variance',
    ruleName: 'Amount + Date + Text with Reference Variance',
    reason: 'Needs reviewer confirmation',
    score: 0.78,
    bankTransactionId: canonicalRows[0]?.id,
    qboTransactionId: canonicalRows[1]?.id,
    dateDifferenceDays: 1,
    amountDifference: 0,
    evidence: ['Reference mismatch'],
    exceptionCategory: 'ReferenceNumberMismatch',
  };
  await store.persistMatchingArtifacts({
    jobId,
    matchResults: [],
    probableMatches: [probableMatch],
    groupedMatchResults: [],
  });

  await store.persistReviewArtifacts({
    jobId,
    exceptions: [],
    reviewerObservations: [],
    summary: buildSummary(),
  });

  return { jobId, probableMatchId: probableMatch.id };
};

type QueryCounterClient = {
  query: (...args: unknown[]) => Promise<unknown>;
};

const countQueriesDuring = async <T>(
  client: QueryCounterClient,
  action: () => Promise<T>,
): Promise<{ result: T; queryCount: number }> => {
  let queryCount = 0;
  const originalQuery = client.query.bind(client);

  client.query = async (...args: unknown[]) => {
    queryCount += 1;
    return originalQuery(...args);
  };

  try {
    const result = await action();
    return { result, queryCount };
  } finally {
    client.query = originalQuery;
  }
};

describe('PostgresReconciliationLifecycleStore', () => {
  beforeAll(async () => {
    try {
      container = await new GenericContainer('postgres:16.13')
        .withEnvironment({
          POSTGRES_DB: 'recon_test',
          POSTGRES_USER: 'recon',
          POSTGRES_PASSWORD: 'recon',
        })
        .withExposedPorts(5432)
        .start();
      pool = createPostgresPool({
        connectionString: `postgresql://recon:recon@${container.getHost()}:${container.getMappedPort(5432)}/recon_test`,
      });
      await runPostgresMigrations(pool);
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`PostgreSQL integration setup failed: ${startupError.message}`);
      throw startupError;
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  beforeEach(async () => {
    if (startupError) {
      throw startupError;
    }

    if (!pool) {
      throw new Error('Postgres pool is not initialized.');
    }

    await pool.query(
      'TRUNCATE reconciliation_audit_event, reconciliation_review_decision, reconciliation_export, reconciliation_job_summary, reconciliation_review_observation, reconciliation_exception, reconciliation_rule_result, reconciliation_match_result, reconciliation_match_group, reconciliation_canonical_row, reconciliation_raw_row, reconciliation_import_batch, reconciliation_source_file, reconciliation_job RESTART IDENTITY CASCADE',
    );
  });

  it('installs the phase 2 report and review indexes used by the PostgreSQL read model', async () => {
    if (startupError) {
      throw startupError;
    }

    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN (
            'reconciliation_job',
            'reconciliation_match_result',
            'reconciliation_exception',
            'reconciliation_review_decision',
            'reconciliation_review_observation'
          )`,
    );
    const indexNames = new Set(result.rows.map((row) => row.indexname));

    expect([...indexNames]).toEqual(
      expect.arrayContaining([
        'reconciliation_job_completed_report_idx',
        'reconciliation_match_result_job_result_bucket_created_idx',
        'reconciliation_match_result_job_bank_transaction_lookup_idx',
        'reconciliation_match_result_job_qbo_transaction_lookup_idx',
        'reconciliation_exception_job_line_order_idx',
        'reconciliation_exception_job_category_line_order_idx',
        'reconciliation_review_decision_job_created_idx',
        'reconciliation_review_observation_job_created_idx',
      ]),
    );
  });

  it('persists lifecycle state, row data, derived results, and review decisions through finalization', async () => {
    if (startupError) {
      throw startupError;
    }

    const store = new PostgresReconciliationLifecycleStore(pool, {
      rawRowBatchSize: 2,
      canonicalRowBatchSize: 2,
      resultBatchSize: 2,
    });
    const jobId = randomUUID();
    const bankSourceFileId = randomUUID();
    const qboSourceFileId = randomUUID();
    const startedAt = new Date().toISOString();

    await store.createJob({
      jobId,
      correlationId: 'corr-1',
      startedAt,
      rulepackVersion: '2026-04-06',
      accountIdentifier: 'OPERATING-001',
      periodLabel: 'January 2025',
      reconciliationFrequency: 'Monthly',
      inputFingerprint: 'fingerprint-1',
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
          id: qboSourceFileId,
          sourceSystem: 'qbo',
          sourceFormat: 'xlsx',
          fileName: 'qbo.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: 1024,
          sha256: 'qbo-sha',
          uploadedAt: startedAt,
        },
      ],
    });

    const sourceFiles = [
      buildSourceFile(bankSourceFileId, 'bank'),
      buildSourceFile(qboSourceFileId, 'qbo'),
    ];
    const rawRows = [
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 2),
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 3),
      buildRawRow(randomUUID(), qboSourceFileId, 'qbo', 2),
      buildRawRow(randomUUID(), qboSourceFileId, 'qbo', 3),
    ];
    await store.persistParsedRows(jobId, sourceFiles, rawRows);

    const canonicalRows = rawRows.map((row) =>
      buildCanonicalRow(randomUUID(), row.id, row.sourceFileId, row.source, row.lineNumber),
    );
    await store.persistNormalizedRows(jobId, canonicalRows);

    const exactMatch: MatchResult = {
      id: randomUUID(),
      disposition: 'ExactMatch',
      confidence: 'Exact',
      ruleId: 'amount-date-text-match',
      ruleName: 'Amount + Date + Text Match',
      reason: 'Exact match',
      score: 0.93,
      bankTransactionId: canonicalRows[0]?.id,
      qboTransactionId: canonicalRows[2]?.id,
      dateDifferenceDays: 0,
      amountDifference: 0,
      evidence: ['Amounts agree'],
    };
    const probableMatch: MatchResult = {
      id: randomUUID(),
      disposition: 'ProbableMatch',
      confidence: 'Probable',
      ruleId: 'amount-date-reference-variance',
      ruleName: 'Amount + Date + Text with Reference Variance',
      reason: 'Needs review',
      score: 0.78,
      bankTransactionId: canonicalRows[1]?.id,
      qboTransactionId: canonicalRows[3]?.id,
      dateDifferenceDays: 1,
      amountDifference: 0,
      evidence: ['Reference mismatch'],
      exceptionCategory: 'ReferenceNumberMismatch',
    };
    const groupedMatch: GroupedMatchResult = {
      id: randomUUID(),
      disposition: 'GroupedReviewMatch',
      confidence: 'Probable',
      category: 'DepositGroupingIssue',
      bankTransactionIds: [canonicalRows[0]?.id ?? ''],
      qboTransactionIds: [canonicalRows[2]?.id ?? ''],
      bankMembers: [
        {
          transactionId: canonicalRows[0]?.id ?? '',
          source: 'bank',
          spreadsheetFileName: 'bank.xlsx',
          lineNumber: 2,
          amount: 20,
        },
      ],
      qboMembers: [
        {
          transactionId: canonicalRows[2]?.id ?? '',
          source: 'qbo',
          spreadsheetFileName: 'qbo.xlsx',
          lineNumber: 2,
          amount: 20,
        },
      ],
      totalAmount: 20,
      dateDifferenceDays: 0,
      score: 0.8,
      ruleId: 'grouped-deposit-match',
      ruleName: 'Grouped Deposit Match',
      reason: 'Grouped deposit review',
      evidence: ['Grouped evidence'],
    };

    await store.persistMatchingArtifacts({
      jobId,
      matchResults: [exactMatch],
      probableMatches: [probableMatch],
      groupedMatchResults: [groupedMatch],
    });

    const exception: ExceptionItem = {
      id: randomUUID(),
      runId: jobId,
      category: 'MissingFromQBO',
      severity: 'High',
      source: 'bank',
      spreadsheetFileName: 'bank.xlsx',
      lineNumber: 3,
      transactionDate: '2025-01-01',
      amount: 10,
      errorMessage: 'No QBO counterpart found',
      ruleTrace: {
        ruleId: 'residual-missing-from-qbo',
        ruleName: 'Missing from QBO',
        reason: 'No counterpart remained after matching.',
        evidence: ['No QBO candidate'],
      },
      recommendedNextActions: ['Verify QBO export completeness'],
      normalizedComparisonTokens: ['ROW', '3'],
      relatedTransactionIds: [canonicalRows[1]?.id ?? ''],
    };
    const observation: ReviewerObservation = {
      id: randomUUID(),
      runId: jobId,
      category: 'Review',
      title: 'Review open items',
      message: 'One exception remains open.',
      severity: 'Medium',
      createdAt: new Date().toISOString(),
      relatedTransactionIds: [canonicalRows[1]?.id ?? ''],
    };

    await store.persistReviewArtifacts({
      jobId,
      exceptions: [exception],
      reviewerObservations: [observation],
      summary: buildSummary(),
    });

    const workbookBinary = Buffer.from('fake-workbook-binary');
    const outputWorkbook: OutputWorkbook = {
      fileName: 'reconciliation.xlsx',
      generatedAt: new Date().toISOString(),
      tabNames: ['Summary', 'Exceptions'],
      binary: Uint8Array.from(workbookBinary),
    };
    await store.persistExportAndFinalize({
      jobId,
      outputWorkbook,
      completedAt: new Date().toISOString(),
      auditEvents: [
        {
          timestamp: new Date().toISOString(),
          action: 'reconciliation.run.completed',
          details: { runId: jobId, exactMatches: 1 },
        },
      ],
    });

    const decision: ReviewerDecision = {
      id: randomUUID(),
      runId: jobId,
      targetType: 'ProbableMatch',
      targetId: probableMatch.id,
      outcome: 'ApprovedMatch',
      reviewerName: 'Controller',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.persistReviewerDecision(decision);

    const stateResult = await pool.query<{ current_state: string }>(
      'SELECT current_state FROM reconciliation_job WHERE id = $1',
      [jobId],
    );
    expect(stateResult.rows[0]?.current_state).toBe('FINALIZED');

    const counts = await Promise.all([
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM reconciliation_source_file WHERE job_id = $1',
        [jobId],
      ),
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM reconciliation_import_batch WHERE job_id = $1',
        [jobId],
      ),
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM reconciliation_raw_row WHERE job_id = $1',
        [jobId],
      ),
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM reconciliation_canonical_row WHERE job_id = $1',
        [jobId],
      ),
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM reconciliation_match_result WHERE job_id = $1',
        [jobId],
      ),
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM reconciliation_match_group WHERE job_id = $1',
        [jobId],
      ),
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM reconciliation_exception WHERE job_id = $1',
        [jobId],
      ),
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM reconciliation_rule_result WHERE job_id = $1',
        [jobId],
      ),
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM reconciliation_review_decision WHERE job_id = $1',
        [jobId],
      ),
      pool.query<{ checksum_sha256: string }>(
        'SELECT checksum_sha256 FROM reconciliation_export WHERE job_id = $1',
        [jobId],
      ),
    ]);

    expect(counts[0].rows[0]?.count).toBe(2);
    expect(counts[1].rows[0]?.count).toBe(2);
    expect(counts[2].rows[0]?.count).toBe(4);
    expect(counts[3].rows[0]?.count).toBe(4);
    expect(counts[4].rows[0]?.count).toBe(2);
    expect(counts[5].rows[0]?.count).toBe(1);
    expect(counts[6].rows[0]?.count).toBe(1);
    expect(counts[7].rows[0]?.count).toBeGreaterThanOrEqual(4);
    expect(counts[8].rows[0]?.count).toBe(1);
    expect(counts[9].rows[0]?.checksum_sha256).toBe(computeSha256Hex(workbookBinary));

    const readModelStore = new PostgresReconciliationReadModelStore(pool);
    const latestRun = await readModelStore.findLatestRunReport();
    const runReport = await readModelStore.findRunReportById(jobId);
    const exceptionPage = await readModelStore.listRunExceptionsPage(jobId, 1, 0);

    expect(latestRun?.id).toBe(jobId);
    expect(runReport?.summary.totalRecordsReviewed).toBe(4);
    expect(runReport?.probableMatches).toHaveLength(1);
    expect(runReport?.groupedMatchResults).toHaveLength(1);
    expect(runReport?.reviewerDecisions).toHaveLength(1);
    expect(runReport?.outputWorkbook?.fileName).toBe('reconciliation.xlsx');
    expect(exceptionPage.total).toBe(1);
    expect(exceptionPage.items).toHaveLength(1);
    expect(exceptionPage.hasMore).toBe(false);

    // Clearing the decision removes it and is idempotent.
    await store.deleteReviewerDecision(jobId, decision.targetType, decision.targetId);
    await store.deleteReviewerDecision(jobId, decision.targetType, decision.targetId);

    const afterDelete = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reconciliation_review_decision WHERE job_id = $1',
      [jobId],
    );
    expect(afterDelete.rows[0]?.count).toBe(0);
    expect((await readModelStore.findRunReportById(jobId))?.reviewerDecisions).toHaveLength(0);
  });

  it('rolls back raw-row persistence and leaves the job pre-import when duplicate line numbers violate uniqueness', async () => {
    if (startupError) {
      throw startupError;
    }

    const store = new PostgresReconciliationLifecycleStore(pool, { rawRowBatchSize: 10 });
    const jobId = randomUUID();
    const bankSourceFileId = randomUUID();
    const startedAt = new Date().toISOString();

    await store.createJob({
      jobId,
      correlationId: 'corr-rollback',
      startedAt,
      rulepackVersion: '2026-04-06',
      sourceFiles: [
        {
          id: bankSourceFileId,
          sourceSystem: 'bank',
          sourceFormat: 'xlsx',
          fileName: 'bank.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: 512,
          sha256: 'sha',
          uploadedAt: startedAt,
        },
      ],
    });

    const sourceFiles = [buildSourceFile(bankSourceFileId, 'bank')];
    const duplicateRows = [
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 2),
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 2),
    ];

    await expect(store.persistParsedRows(jobId, sourceFiles, duplicateRows)).rejects.toThrow();

    const stateResult = await pool.query<{ current_state: string }>(
      'SELECT current_state FROM reconciliation_job WHERE id = $1',
      [jobId],
    );
    const rawRowCount = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reconciliation_raw_row WHERE job_id = $1',
      [jobId],
    );

    expect(stateResult.rows[0]?.current_state).toBe('FILE_REGISTERED');
    expect(rawRowCount.rows[0]?.count).toBe(0);
  });

  it('serializes concurrent import writes for the same job and prevents duplicate persistence', async () => {
    if (startupError) {
      throw startupError;
    }

    const store = new PostgresReconciliationLifecycleStore(pool);
    const { jobId, bankSourceFileId, qboSourceFileId } = await createRegisteredJob(store, {
      correlationId: 'corr-concurrent-import',
      inputFingerprint: 'fingerprint-concurrent-import',
    });

    const sourceFiles = [
      buildSourceFile(bankSourceFileId, 'bank'),
      buildSourceFile(qboSourceFileId, 'qbo'),
    ];
    const firstAttemptRows = [
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 2),
      buildRawRow(randomUUID(), qboSourceFileId, 'qbo', 2),
    ];
    const secondAttemptRows = [
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 3),
      buildRawRow(randomUUID(), qboSourceFileId, 'qbo', 3),
    ];

    const outcomes = await Promise.allSettled([
      store.persistParsedRows(jobId, sourceFiles, firstAttemptRows),
      store.persistParsedRows(jobId, sourceFiles, secondAttemptRows),
    ]);

    const fulfilledCount = outcomes.filter((outcome) => outcome.status === 'fulfilled').length;
    const rejectedOutcomes = outcomes.filter((outcome) => outcome.status === 'rejected');
    const rejectedMessages = rejectedOutcomes.map((outcome) =>
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    );

    expect(fulfilledCount).toBe(1);
    expect(rejectedOutcomes).toHaveLength(1);
    expect(
      rejectedMessages.some((message) => message.includes('Invalid reconciliation_job transition')),
    ).toBe(true);

    const stateResult = await pool.query<{ current_state: string }>(
      'SELECT current_state FROM reconciliation_job WHERE id = $1',
      [jobId],
    );
    const rawRowResult = await pool.query<{ line_number: number }>(
      'SELECT line_number FROM reconciliation_raw_row WHERE job_id = $1 ORDER BY line_number ASC',
      [jobId],
    );
    const importBatchCount = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reconciliation_import_batch WHERE job_id = $1',
      [jobId],
    );

    expect(stateResult.rows[0]?.current_state).toBe('IMPORTED');
    expect(rawRowResult.rows).toHaveLength(2);
    expect(importBatchCount.rows[0]?.count).toBe(2);

    const persistedLines = rawRowResult.rows.map((row) => row.line_number);
    expect(new Set(persistedLines).size).toBe(1);
    expect([2, 3]).toContain(persistedLines[0]);
  });

  it('upserts reviewer decisions in place, increments record version, and leaves a single durable row', async () => {
    if (startupError) {
      throw startupError;
    }

    const store = new PostgresReconciliationLifecycleStore(pool);
    const { jobId, probableMatchId } = await createReviewReadyJob(store);

    const createdAt = new Date().toISOString();
    const updatedAt = new Date(Date.now() + 1000).toISOString();

    await store.persistReviewerDecision({
      id: randomUUID(),
      runId: jobId,
      targetType: 'ProbableMatch',
      targetId: probableMatchId,
      outcome: 'ApprovedMatch',
      notes: 'Approved on first review.',
      reviewerName: 'Controller One',
      createdAt,
      updatedAt: createdAt,
    });

    await store.persistReviewerDecision({
      id: randomUUID(),
      runId: jobId,
      targetType: 'ProbableMatch',
      targetId: probableMatchId,
      outcome: 'RejectedMatch',
      finalCategory: 'ReferenceNumberMismatch',
      notes: 'Rejected after follow-up.',
      reviewerName: 'Controller Two',
      createdAt,
      updatedAt,
    });

    const decisionRows = await pool.query<{
      outcome: string;
      final_category: string | null;
      notes: string | null;
      reviewer_name: string | null;
      record_version: number;
      updated_at: string;
      count: number;
    }>(
      `SELECT outcome, final_category, notes, reviewer_name, record_version, updated_at,
              COUNT(*) OVER ()::int AS count
         FROM reconciliation_review_decision
        WHERE job_id = $1 AND target_type = 'ProbableMatch' AND target_id = $2`,
      [jobId, probableMatchId],
    );
    const auditRows = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM reconciliation_audit_event
        WHERE job_id = $1 AND event_type = 'review.decision.persisted'`,
      [jobId],
    );

    expect(decisionRows.rows).toHaveLength(1);
    expect(decisionRows.rows[0]?.count).toBe(1);
    expect(decisionRows.rows[0]?.outcome).toBe('RejectedMatch');
    expect(decisionRows.rows[0]?.final_category).toBe('ReferenceNumberMismatch');
    expect(decisionRows.rows[0]?.notes).toBe('Rejected after follow-up.');
    expect(decisionRows.rows[0]?.reviewer_name).toBe('Controller Two');
    expect(decisionRows.rows[0]?.record_version).toBe(2);
    expect(new Date(String(decisionRows.rows[0]?.updated_at)).toISOString()).toContain(
      updatedAt.slice(0, 19),
    );
    expect(auditRows.rows[0]?.count).toBe(2);

    const readModelStore = new PostgresReconciliationReadModelStore(pool);
    const reviewerDecisions = await readModelStore.listReviewerDecisions(jobId);

    expect(reviewerDecisions).toHaveLength(1);
    expect(reviewerDecisions[0]?.targetId).toBe(probableMatchId);
    expect(reviewerDecisions[0]?.outcome).toBe('RejectedMatch');
    expect(reviewerDecisions[0]?.finalCategory).toBe('ReferenceNumberMismatch');
  });

  it('marks jobs for retry with failure metadata and does not create unrelated persistence rows', async () => {
    if (startupError) {
      throw startupError;
    }

    const store = new PostgresReconciliationLifecycleStore(pool);
    const { jobId } = await createRegisteredJob(store, {
      correlationId: 'corr-retry',
      inputFingerprint: 'fingerprint-retry',
    });

    await store.markFailed({
      jobId,
      failedAt: '2026-04-07T15:00:00.000Z',
      errorCode: 'PARSE_FAILURE',
      errorMessage: 'Workbook header mapping failed.',
      nextState: 'RETRY_PENDING',
    });

    const jobRows = await pool.query<{
      current_state: string;
      retry_count: number;
      failure_code: string | null;
      failure_message: string | null;
      completed_at: string | null;
    }>(
      `SELECT current_state, retry_count, failure_code, failure_message, completed_at
         FROM reconciliation_job
        WHERE id = $1`,
      [jobId],
    );
    const auditRows = await pool.query<{ event_type: string; count: number }>(
      `SELECT event_type, COUNT(*)::int AS count
         FROM reconciliation_audit_event
        WHERE job_id = $1
        GROUP BY event_type`,
      [jobId],
    );
    const rawRowCount = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reconciliation_raw_row WHERE job_id = $1',
      [jobId],
    );

    expect(jobRows.rows[0]?.current_state).toBe('RETRY_PENDING');
    expect(jobRows.rows[0]?.retry_count).toBe(1);
    expect(jobRows.rows[0]?.failure_code).toBe('PARSE_FAILURE');
    expect(jobRows.rows[0]?.failure_message).toBe('Workbook header mapping failed.');
    expect(new Date(String(jobRows.rows[0]?.completed_at)).toISOString()).toContain(
      '2026-04-07T15:00:00',
    );
    expect(rawRowCount.rows[0]?.count).toBe(0);
    expect(auditRows.rows.some((row) => row.event_type === 'job.failed' && row.count === 1)).toBe(
      true,
    );
  });

  it('rejects invalid failure transitions and leaves finalized jobs unchanged', async () => {
    if (startupError) {
      throw startupError;
    }

    const store = new PostgresReconciliationLifecycleStore(pool);
    const { jobId } = await createRegisteredJob(store, {
      correlationId: 'corr-finalized',
      inputFingerprint: 'fingerprint-finalized',
    });

    await pool.query(
      `UPDATE reconciliation_job
          SET current_state = 'FINALIZED', completed_at = '2026-04-07T14:00:00.000Z'
        WHERE id = $1`,
      [jobId],
    );

    await expect(
      store.markFailed({
        jobId,
        failedAt: '2026-04-07T16:00:00.000Z',
        errorCode: 'LATE_FAILURE',
        errorMessage: 'Should not be written after finalization.',
      }),
    ).rejects.toThrow('Invalid reconciliation_job transition: FINALIZED -> FAILED');

    const jobRows = await pool.query<{
      current_state: string;
      retry_count: number;
      failure_code: string | null;
      failure_message: string | null;
      completed_at: string | null;
    }>(
      `SELECT current_state, retry_count, failure_code, failure_message, completed_at
         FROM reconciliation_job
        WHERE id = $1`,
      [jobId],
    );
    const failedAuditCount = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM reconciliation_audit_event
        WHERE job_id = $1 AND event_type = 'job.failed'`,
      [jobId],
    );

    expect(jobRows.rows[0]?.current_state).toBe('FINALIZED');
    expect(jobRows.rows[0]?.retry_count).toBe(0);
    expect(jobRows.rows[0]?.failure_code).toBeNull();
    expect(jobRows.rows[0]?.failure_message).toBeNull();
    expect(new Date(String(jobRows.rows[0]?.completed_at)).toISOString()).toContain(
      '2026-04-07T14:00:00',
    );
    expect(failedAuditCount.rows[0]?.count).toBe(0);
  });

  it('rejects match artifacts that reference non-existent canonical rows and rolls the transaction back', async () => {
    if (startupError) {
      throw startupError;
    }

    const store = new PostgresReconciliationLifecycleStore(pool);
    const { jobId, bankSourceFileId, qboSourceFileId } = await createRegisteredJob(store, {
      correlationId: 'corr-orphan-match',
      inputFingerprint: 'fingerprint-orphan-match',
    });

    const sourceFiles = [
      buildSourceFile(bankSourceFileId, 'bank'),
      buildSourceFile(qboSourceFileId, 'qbo'),
    ];
    const rawRows = [
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 2),
      buildRawRow(randomUUID(), qboSourceFileId, 'qbo', 2),
    ];
    await store.persistParsedRows(jobId, sourceFiles, rawRows);

    const canonicalRows = rawRows.map((row) =>
      buildCanonicalRow(randomUUID(), row.id, row.sourceFileId, row.source, row.lineNumber),
    );
    await store.persistNormalizedRows(jobId, canonicalRows);

    await expect(
      store.persistMatchingArtifacts({
        jobId,
        matchResults: [
          {
            id: randomUUID(),
            disposition: 'ExactMatch',
            confidence: 'Exact',
            ruleId: 'amount-date-text-match',
            ruleName: 'Amount + Date + Text Match',
            reason: 'Should fail because one referenced row does not exist.',
            score: 0.99,
            bankTransactionId: canonicalRows[0]?.id,
            qboTransactionId: randomUUID(),
            dateDifferenceDays: 0,
            amountDifference: 0,
            evidence: ['Foreign key should reject this row.'],
          },
        ],
        probableMatches: [],
        groupedMatchResults: [],
      }),
    ).rejects.toThrow(/foreign key|violates/i);

    const stateResult = await pool.query<{ current_state: string }>(
      'SELECT current_state FROM reconciliation_job WHERE id = $1',
      [jobId],
    );
    const matchResultCount = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reconciliation_match_result WHERE job_id = $1',
      [jobId],
    );
    const ruleResultCount = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reconciliation_rule_result WHERE job_id = $1',
      [jobId],
    );

    expect(stateResult.rows[0]?.current_state).toBe('NORMALIZED');
    expect(matchResultCount.rows[0]?.count).toBe(0);
    expect(ruleResultCount.rows[0]?.count).toBe(0);
  });

  it('persists a probable match only once when it is also present in matchResults', async () => {
    if (startupError) {
      throw startupError;
    }

    const store = new PostgresReconciliationLifecycleStore(pool);
    const { jobId, bankSourceFileId, qboSourceFileId } = await createRegisteredJob(store, {
      correlationId: 'corr-duplicate-probable-match',
      inputFingerprint: 'fingerprint-duplicate-probable-match',
    });

    const sourceFiles = [
      buildSourceFile(bankSourceFileId, 'bank'),
      buildSourceFile(qboSourceFileId, 'qbo'),
    ];
    const rawRows = [
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 2),
      buildRawRow(randomUUID(), qboSourceFileId, 'qbo', 2),
    ];
    await store.persistParsedRows(jobId, sourceFiles, rawRows);

    const canonicalRows = rawRows.map((row) =>
      buildCanonicalRow(randomUUID(), row.id, row.sourceFileId, row.source, row.lineNumber),
    );
    await store.persistNormalizedRows(jobId, canonicalRows);

    const probableMatch: MatchResult = {
      id: randomUUID(),
      disposition: 'ProbableMatch',
      confidence: 'Probable',
      ruleId: 'amount-date-reference-variance',
      ruleName: 'Amount + Date + Text with Reference Variance',
      reason: 'Needs review',
      score: 0.78,
      bankTransactionId: canonicalRows[0]?.id,
      qboTransactionId: canonicalRows[1]?.id,
      dateDifferenceDays: 1,
      amountDifference: 0,
      evidence: ['Reference mismatch'],
      exceptionCategory: 'ReferenceNumberMismatch',
    };

    await store.persistMatchingArtifacts({
      jobId,
      matchResults: [probableMatch],
      probableMatches: [probableMatch],
      groupedMatchResults: [],
    });

    const persistedMatches = await pool.query<{
      id: string;
      result_bucket: string;
      disposition: string;
    }>(
      `SELECT id::text, result_bucket, disposition
         FROM reconciliation_match_result
        WHERE job_id = $1`,
      [jobId],
    );

    expect(persistedMatches.rows).toEqual([
      {
        id: probableMatch.id,
        result_bucket: 'PROBABLE',
        disposition: 'ProbableMatch',
      },
    ]);
  });

  it('rejects review artifacts whose rule lineage points at non-existent canonical rows and rolls the transaction back', async () => {
    if (startupError) {
      throw startupError;
    }

    const store = new PostgresReconciliationLifecycleStore(pool);
    const { jobId, bankSourceFileId, qboSourceFileId } = await createRegisteredJob(store, {
      correlationId: 'corr-orphan-review',
      inputFingerprint: 'fingerprint-orphan-review',
    });

    const sourceFiles = [
      buildSourceFile(bankSourceFileId, 'bank'),
      buildSourceFile(qboSourceFileId, 'qbo'),
    ];
    const rawRows = [
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 2),
      buildRawRow(randomUUID(), qboSourceFileId, 'qbo', 2),
    ];
    await store.persistParsedRows(jobId, sourceFiles, rawRows);

    const canonicalRows = rawRows.map((row) =>
      buildCanonicalRow(randomUUID(), row.id, row.sourceFileId, row.source, row.lineNumber),
    );
    await store.persistNormalizedRows(jobId, canonicalRows);

    await store.persistMatchingArtifacts({
      jobId,
      matchResults: [],
      probableMatches: [],
      groupedMatchResults: [],
    });

    await expect(
      store.persistReviewArtifacts({
        jobId,
        exceptions: [
          {
            id: randomUUID(),
            runId: jobId,
            category: 'MissingFromQBO',
            severity: 'High',
            source: 'bank',
            spreadsheetFileName: 'bank.xlsx',
            lineNumber: 2,
            transactionDate: '2025-01-01',
            amount: 20,
            errorMessage: 'Should fail because the rule lineage points at a missing row.',
            ruleTrace: {
              ruleId: 'residual-missing-from-qbo',
              ruleName: 'Missing from QBO',
              reason: 'No counterpart remained after matching.',
              evidence: ['Missing counterpart'],
              counterpart: {
                transactionId: randomUUID(),
                source: 'qbo',
                spreadsheetFileName: 'qbo.xlsx',
                lineNumber: 2,
              },
            },
            recommendedNextActions: ['Investigate the missing counterpart.'],
            normalizedComparisonTokens: ['ROW', '2'],
            relatedTransactionIds: [canonicalRows[0]?.id ?? ''],
          },
        ],
        reviewerObservations: [],
        summary: buildSummary(),
      }),
    ).rejects.toThrow(/foreign key|violates/i);

    const stateResult = await pool.query<{ current_state: string }>(
      'SELECT current_state FROM reconciliation_job WHERE id = $1',
      [jobId],
    );
    const exceptionCount = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reconciliation_exception WHERE job_id = $1',
      [jobId],
    );
    const summaryCount = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reconciliation_job_summary WHERE job_id = $1',
      [jobId],
    );
    const ruleResultCount = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM reconciliation_rule_result WHERE job_id = $1',
      [jobId],
    );

    expect(stateResult.rows[0]?.current_state).toBe('MATCHED');
    expect(exceptionCount.rows[0]?.count).toBe(0);
    expect(summaryCount.rows[0]?.count).toBe(0);
    expect(ruleResultCount.rows[0]?.count).toBe(0);
  });

  it('keeps read-model query counts bounded for large exception sets', async () => {
    if (startupError) {
      throw startupError;
    }

    const store = new PostgresReconciliationLifecycleStore(pool);
    const { jobId, bankSourceFileId, qboSourceFileId } = await createRegisteredJob(store, {
      correlationId: 'corr-query-budget',
      inputFingerprint: 'fingerprint-query-budget',
    });

    const sourceFiles = [
      buildSourceFile(bankSourceFileId, 'bank'),
      buildSourceFile(qboSourceFileId, 'qbo'),
    ];
    const rawRows = [
      buildRawRow(randomUUID(), bankSourceFileId, 'bank', 2),
      buildRawRow(randomUUID(), qboSourceFileId, 'qbo', 2),
    ];
    await store.persistParsedRows(jobId, sourceFiles, rawRows);

    const canonicalRows = rawRows.map((row) =>
      buildCanonicalRow(randomUUID(), row.id, row.sourceFileId, row.source, row.lineNumber),
    );
    await store.persistNormalizedRows(jobId, canonicalRows);

    await store.persistMatchingArtifacts({
      jobId,
      matchResults: [],
      probableMatches: [],
      groupedMatchResults: [],
    });

    const exceptions: ExceptionItem[] = Array.from({ length: 20 }, (_, index) => ({
      id: randomUUID(),
      runId: jobId,
      category: 'MissingFromQBO',
      severity: 'High',
      source: 'bank',
      spreadsheetFileName: 'bank.xlsx',
      lineNumber: index + 2,
      transactionDate: '2025-01-01',
      amount: 10 + index,
      errorMessage: `Synthetic exception ${index + 1}`,
      ruleTrace: {
        ruleId: 'residual-missing-from-qbo',
        ruleName: 'Missing from QBO',
        reason: 'Synthetic query-budget scenario',
        evidence: ['Synthetic fixture row'],
      },
      recommendedNextActions: ['Review source and ledger values.'],
      normalizedComparisonTokens: [`ROW-${index + 1}`],
      relatedTransactionIds: [canonicalRows[0]?.id ?? ''],
    }));

    await store.persistReviewArtifacts({
      jobId,
      exceptions,
      reviewerObservations: [],
      summary: buildSummary(),
    });

    const readModelStore = new PostgresReconciliationReadModelStore(pool);

    const pageLookup = await countQueriesDuring(pool as unknown as QueryCounterClient, () =>
      readModelStore.listRunExceptionsPage(jobId, 20, 0),
    );

    expect(pageLookup.result.items).toHaveLength(exceptions.length);
    expect(pageLookup.result.total).toBe(exceptions.length);
    expect(pageLookup.queryCount).toBeLessThanOrEqual(2);

    const reportLookup = await countQueriesDuring(pool as unknown as QueryCounterClient, () =>
      readModelStore.findRunReportById(jobId),
    );

    expect(reportLookup.result?.exceptions).toHaveLength(exceptions.length);
    expect(reportLookup.queryCount).toBeLessThanOrEqual(9);
  });
});
