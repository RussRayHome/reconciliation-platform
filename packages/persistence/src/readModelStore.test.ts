import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  PostgresReconciliationReadModelStore,
  createPayeeAlias,
  deactivatePayeeAlias,
  loadPayeeAliases,
  updatePayeeAlias,
} from './readModelStore';

type QueryResult = { rows: unknown[]; rowCount?: number | null };

const makePool = (...responses: QueryResult[]): Pool => {
  const mock = vi.fn();
  for (const r of responses) {
    mock.mockResolvedValueOnce(r);
  }
  return { query: mock } as unknown as Pool;
};

const PAYEE_ROW = {
  id: 'alias-1',
  account_identifier: 'ACCT-001',
  bank_pattern: 'GOOGLE',
  canonical_payee_name: 'Google LLC',
  normalized_tokens: ['google'],
  source_direction: 'bank_to_qbo' as const,
  match_confidence: 0.95,
  is_active: true,
};

const JOB_ROW = {
  id: 'run-1',
  correlation_id: 'corr-1',
  account_identifier: 'ACCT-001',
  period_label: 'June 2026',
  reconciliation_frequency: 'Monthly' as const,
  current_state: 'FINALIZED',
  started_at: '2026-06-01T00:00:00Z',
  completed_at: '2026-06-01T01:00:00Z',
};

const SOURCE_FILE_ROW = {
  id: 'sf-1',
  source_system: 'bank' as const,
  file_name: 'bank.xlsx',
  mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: '2048',
  worksheet_name: 'Transactions',
  header_row: 1,
  transaction_start_row: 2,
  excluded_row_numbers: [5, 6],
  uploaded_at: '2026-06-01T00:00:00Z',
};

const GROUPED_MATCH_ROW = {
  id: 'gm-1',
  disposition: 'Matched' as const,
  confidence: 'High' as const,
  category: 'ExactMatch' as const,
  bank_transaction_ids: ['bt-1'],
  qbo_transaction_ids: ['qt-1'],
  bank_members_json: [{ id: 'bt-1', amount: 100 }],
  qbo_members_json: [{ id: 'qt-1', amount: 100 }],
  total_amount: '100.00',
  date_difference_days: 0,
  score: 1,
  rule_id: 'rule-exact',
  rule_name: 'Exact Match',
  reason: 'Amounts and dates match',
  evidence_json: ['amount match'],
};

const MATCH_RESULT_ROW = {
  id: 'mr-1',
  bank_transaction_id: 'bt-2',
  qbo_transaction_id: 'qt-2',
  disposition: 'Probable' as const,
  confidence: 'Medium' as const,
  rule_id: 'rule-probable',
  rule_name: 'Probable Match',
  reason: 'Similar amounts',
  score: 0.8,
  amount_difference: '2.50',
  date_difference_days: 1,
  evidence_json: ['amount close'],
  likely_matching_reference: 'REF-001',
  exception_category: null,
};

const EXCEPTION_ROW = {
  id: 'ex-1',
  category: 'MissingFromQBO' as const,
  severity: 'High' as const,
  source_system: 'bank' as const,
  spreadsheet_file_name: 'bank.xlsx',
  line_number: 3,
  transaction_date: '2026-05-15',
  amount: '500.00',
  error_message: 'No matching QBO transaction found',
  rule_trace_json: { ruleId: 'rule-1', outcome: 'NoMatch' },
  prior_rule_traces_json: [],
  recommended_next_actions: ['Review manually'],
  likely_matching_reference: null,
  reviewer_notes: null,
  match_confidence: null,
  normalized_comparison_tokens: ['payment'],
  related_transaction_ids: [],
};

const REVIEWER_OBSERVATION_ROW = {
  id: 'obs-1',
  category: 'DataQuality' as const,
  title: 'Duplicate detected',
  message: 'Bank has duplicate entry on line 5',
  severity: 'Medium' as const,
  related_transaction_ids: ['bt-5'],
  created_at: '2026-06-01T00:30:00Z',
};

const REVIEWER_DECISION_ROW = {
  id: 'dec-1',
  target_type: 'exception' as const,
  target_id: 'ex-1',
  outcome: 'Accepted' as const,
  final_category: null,
  notes: 'Reviewed and confirmed',
  reviewer_id: 'user-1',
  reviewer_name: 'Alice',
  created_at: '2026-06-01T01:00:00Z',
  updated_at: '2026-06-01T01:00:00Z',
};

const SUMMARY_ROW = {
  total_records_reviewed: 10,
  bank_records: 5,
  qbo_records: 5,
  exact_matches: 4,
  probable_matches: 1,
  unmatched_items: 2,
  duplicates: 0,
  bank_duplicates: 0,
  qbo_duplicates: 0,
  date_variances: 0,
  timing_differences: 0,
  data_quality_issues: 1,
  amount_mismatches: 0,
  missing_from_bank: 0,
  missing_from_qbo: 2,
  unmatched_bank_net_amount: '150.00',
  unmatched_qbo_net_amount: '200.00',
  clean_matched_amount: '1000.00',
  unresolved_exposure: '350.00',
  counts_by_category_json: { MissingFromQBO: 2 },
  amount_by_category_json: { MissingFromQBO: 200 },
  charts_json: [{ type: 'bar' }],
};

const EXPORT_ROW = {
  file_name: 'recon-output.xlsx',
  generated_at: '2026-06-01T01:00:00Z',
  tab_names_json: ['Summary', 'Exceptions'],
};

const buildRunReportPool = (
  overrides: {
    jobRow?: Partial<typeof JOB_ROW> | null;
    summaryRow?: typeof SUMMARY_ROW | null;
    exportRow?: typeof EXPORT_ROW | null;
  } = {},
) => {
  let job = [JOB_ROW];
  if (overrides.jobRow === null) {
    job = [];
  } else if (overrides.jobRow !== undefined) {
    job = [{ ...JOB_ROW, ...overrides.jobRow }];
  }

  let summaryRows = [SUMMARY_ROW];
  if (overrides.summaryRow === null) {
    summaryRows = [];
  } else if (overrides.summaryRow !== undefined) {
    summaryRows = [overrides.summaryRow];
  }

  let exportRows = [EXPORT_ROW];
  if (overrides.exportRow === null) {
    exportRows = [];
  } else if (overrides.exportRow !== undefined) {
    exportRows = [overrides.exportRow];
  }

  return makePool(
    { rows: job },
    { rows: [SOURCE_FILE_ROW] },
    { rows: [GROUPED_MATCH_ROW] },
    { rows: [MATCH_RESULT_ROW] },
    { rows: [EXCEPTION_ROW] },
    { rows: summaryRows },
    { rows: [REVIEWER_OBSERVATION_ROW] },
    { rows: [REVIEWER_DECISION_ROW] },
    { rows: exportRows },
  );
};

describe('PostgresReconciliationReadModelStore', () => {
  describe('findLatestRunReport', () => {
    it('returns undefined when no completed run exists', async () => {
      const pool = makePool({ rows: [] });
      const store = new PostgresReconciliationReadModelStore(pool);
      expect(await store.findLatestRunReport()).toBeUndefined();
    });

    it('delegates to findRunReportById when a run is found', async () => {
      const pool = makePool(
        { rows: [{ id: 'run-1' }] },
        { rows: [JOB_ROW] },
        { rows: [SOURCE_FILE_ROW] },
        { rows: [GROUPED_MATCH_ROW] },
        { rows: [MATCH_RESULT_ROW] },
        { rows: [EXCEPTION_ROW] },
        { rows: [SUMMARY_ROW] },
        { rows: [REVIEWER_OBSERVATION_ROW] },
        { rows: [REVIEWER_DECISION_ROW] },
        { rows: [EXPORT_ROW] },
      );
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findLatestRunReport();
      expect(report?.id).toBe('run-1');
    });
  });

  describe('findRunReportById', () => {
    it('returns undefined when job not found', async () => {
      const pool = buildRunReportPool({ jobRow: null });
      const store = new PostgresReconciliationReadModelStore(pool);
      expect(await store.findRunReportById('run-1')).toBeUndefined();
    });

    it('maps all fields from a completed run', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');

      expect(report).toMatchObject({
        id: 'run-1',
        correlationId: 'corr-1',
        accountIdentifier: 'ACCT-001',
        periodLabel: 'June 2026',
        reconciliationFrequency: 'Monthly',
        status: 'Completed',
        startedAt: '2026-06-01T00:00:00Z',
        completedAt: '2026-06-01T01:00:00Z',
      });
    });

    it('maps source files via mapSourceFile', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');

      expect(report?.sourceFiles).toHaveLength(1);
      expect(report?.sourceFiles[0]).toMatchObject({
        id: 'sf-1',
        source: 'bank',
        fileName: 'bank.xlsx',
        sizeBytes: 2048,
        worksheetName: 'Transactions',
        headerRow: 1,
        transactionStartRow: 2,
        excludedRowNumbers: [5, 6],
      });
    });

    it('maps grouped match results via mapGroupedMatch', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');

      expect(report?.groupedMatchResults).toHaveLength(1);
      expect(report?.groupedMatchResults[0]).toMatchObject({
        id: 'gm-1',
        disposition: 'Matched',
        totalAmount: 100,
        ruleId: 'rule-exact',
        bankTransactionIds: ['bt-1'],
        evidence: ['amount match'],
      });
    });

    it('maps probable matches via mapMatchResult', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');

      expect(report?.probableMatches).toHaveLength(1);
      expect(report?.probableMatches[0]).toMatchObject({
        id: 'mr-1',
        bankTransactionId: 'bt-2',
        qboTransactionId: 'qt-2',
        amountDifference: 2.5,
        likelyMatchingReference: 'REF-001',
      });
    });

    it('maps exceptions via mapException', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');

      expect(report?.exceptions).toHaveLength(1);
      expect(report?.exceptions[0]).toMatchObject({
        id: 'ex-1',
        runId: 'run-1',
        category: 'MissingFromQBO',
        amount: 500,
        normalizedComparisonTokens: ['payment'],
      });
    });

    it('maps reviewer observations', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');

      expect(report?.reviewerObservations).toHaveLength(1);
      expect(report?.reviewerObservations[0]).toMatchObject({
        id: 'obs-1',
        runId: 'run-1',
        category: 'DataQuality',
        relatedTransactionIds: ['bt-5'],
      });
    });

    it('maps reviewer decisions', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');

      expect(report?.reviewerDecisions).toHaveLength(1);
      expect(report?.reviewerDecisions[0]).toMatchObject({
        id: 'dec-1',
        runId: 'run-1',
        targetType: 'exception',
        outcome: 'Accepted',
        reviewerName: 'Alice',
      });
    });

    it('maps output workbook when present', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');

      expect(report?.outputWorkbook).toMatchObject({
        fileName: 'recon-output.xlsx',
        tabNames: ['Summary', 'Exceptions'],
      });
    });

    it('returns undefined outputWorkbook when no export row', async () => {
      const pool = buildRunReportPool({ exportRow: null });
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');
      expect(report?.outputWorkbook).toBeUndefined();
    });

    it('returns empty summary fallback when no summary row', async () => {
      const pool = buildRunReportPool({ summaryRow: null });
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');

      expect(report?.summary.totalRecordsReviewed).toBe(0);
      expect(report?.summary.exactMatches).toBe(0);
      expect(report?.summary.charts).toEqual([]);
    });

    it('maps summary numeric fields from string columns', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');

      expect(report?.summary).toMatchObject({
        totalRecordsReviewed: 10,
        unmatchedBankNetAmount: 150,
        unmatchedQboNetAmount: 200,
        cleanMatchedAmount: 1000,
        unresolvedExposure: 350,
        countsByCategory: { MissingFromQBO: 2 },
      });
    });

    it('returns status Failed for FAILED state', async () => {
      const pool = buildRunReportPool({
        jobRow: { current_state: 'FAILED', completed_at: undefined },
      });
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');
      expect(report?.status).toBe('Failed');
    });

    it('returns status Running when no completed_at and not FAILED', async () => {
      const pool = buildRunReportPool({
        jobRow: { current_state: 'MATCHING', completed_at: undefined },
      });
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');
      expect(report?.status).toBe('Running');
    });

    it('returns status Completed when completed_at is set', async () => {
      const pool = buildRunReportPool({
        jobRow: { current_state: 'FINALIZED', completed_at: '2026-06-01T01:00:00Z' },
      });
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');
      expect(report?.status).toBe('Completed');
    });

    it('handles null optional fields in source file row', async () => {
      // Override with nulls for optional fields — they use ?? fallbacks
      const pool2 = makePool(
        { rows: [JOB_ROW] },
        {
          rows: [
            {
              ...SOURCE_FILE_ROW,
              worksheet_name: null,
              header_row: null,
              transaction_start_row: null,
              excluded_row_numbers: null,
            },
          ],
        },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      );
      const store2 = new PostgresReconciliationReadModelStore(pool2);
      const report = await store2.findRunReportById('run-1');
      const sf = report?.sourceFiles[0];

      expect(sf?.worksheetName).toBe('Unknown');
      expect(sf?.headerRow).toBe(1);
      expect(sf?.transactionStartRow).toBe(1);
      expect(sf?.excludedRowNumbers).toEqual([]);
    });

    it('handles null optional fields in match result row', async () => {
      const pool = makePool(
        { rows: [JOB_ROW] },
        { rows: [] },
        { rows: [] },
        {
          rows: [
            {
              ...MATCH_RESULT_ROW,
              bank_transaction_id: null,
              qbo_transaction_id: null,
              rule_id: null,
              reason: null,
              likely_matching_reference: null,
              exception_category: null,
            },
          ],
        },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      );
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');
      const mr = report?.probableMatches[0];

      expect(mr?.bankTransactionId).toBeUndefined();
      expect(mr?.qboTransactionId).toBeUndefined();
      expect(mr?.ruleId).toBeUndefined();
      expect(mr?.reason).toBeUndefined();
    });

    it('handles null optional fields in grouped match row', async () => {
      const pool = makePool(
        { rows: [JOB_ROW] },
        { rows: [] },
        {
          rows: [
            {
              ...GROUPED_MATCH_ROW,
              category: null,
              bank_transaction_ids: null,
              qbo_transaction_ids: 'not-an-array',
              bank_members_json: null,
              qbo_members_json: null,
              evidence_json: null,
            },
          ],
        },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      );
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('run-1');
      const gm = report?.groupedMatchResults[0];

      expect(gm?.category).toBeUndefined();
      expect(gm?.bankTransactionIds).toEqual([]);
      expect(gm?.qboTransactionIds).toEqual([]);
      expect(gm?.bankMembers).toEqual([]);
      expect(gm?.evidence).toEqual([]);
    });
  });

  describe('findRunSummaryById', () => {
    it('returns undefined when no summary row', async () => {
      const pool = makePool({ rows: [] });
      const store = new PostgresReconciliationReadModelStore(pool);
      expect(await store.findRunSummaryById('run-1')).toBeUndefined();
    });

    it('returns mapped summary metrics', async () => {
      const pool = makePool({ rows: [SUMMARY_ROW] });
      const store = new PostgresReconciliationReadModelStore(pool);
      const summary = await store.findRunSummaryById('run-1');
      expect(summary?.totalRecordsReviewed).toBe(10);
      expect(summary?.cleanMatchedAmount).toBe(1000);
    });
  });

  describe('listRunExceptions', () => {
    it('returns empty array when no exceptions', async () => {
      const pool = makePool({ rows: [] });
      const store = new PostgresReconciliationReadModelStore(pool);
      expect(await store.listRunExceptions('run-1')).toEqual([]);
    });

    it('maps exception rows including null optional fields', async () => {
      const pool = makePool({ rows: [EXCEPTION_ROW] });
      const store = new PostgresReconciliationReadModelStore(pool);
      const items = await store.listRunExceptions('run-1');

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'ex-1',
        runId: 'run-1',
        transactionDate: '2026-05-15',
        amount: 500,
        priorRuleTraces: [],
        recommendedNextActions: ['Review manually'],
        likelyMatchingReference: undefined,
        reviewerNotes: undefined,
        matchConfidence: undefined,
      });
    });

    it('handles null transaction date and amount', async () => {
      const pool = makePool({
        rows: [{ ...EXCEPTION_ROW, transaction_date: null, amount: null }],
      });
      const store = new PostgresReconciliationReadModelStore(pool);
      const items = await store.listRunExceptions('run-1');
      expect(items[0]?.transactionDate).toBeUndefined();
      expect(items[0]?.amount).toBeNull();
    });

    it('includes non-null optional fields when present', async () => {
      const pool = makePool({
        rows: [
          {
            ...EXCEPTION_ROW,
            likely_matching_reference: 'REF-999',
            reviewer_notes: 'Checked by Alice',
            match_confidence: 'High',
          },
        ],
      });
      const store = new PostgresReconciliationReadModelStore(pool);
      const items = await store.listRunExceptions('run-1');
      expect(items[0]?.likelyMatchingReference).toBe('REF-999');
      expect(items[0]?.reviewerNotes).toBe('Checked by Alice');
      expect(items[0]?.matchConfidence).toBe('High');
    });
  });

  describe('listRunExceptionsPage', () => {
    it('returns paginated result with hasMore true', async () => {
      const pool = makePool({ rows: [EXCEPTION_ROW], rowCount: 1 }, { rows: [{ count: '5' }] });
      const store = new PostgresReconciliationReadModelStore(pool);
      const page = await store.listRunExceptionsPage('run-1', 1, 0);

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(5);
      expect(page.limit).toBe(1);
      expect(page.offset).toBe(0);
      expect(page.hasMore).toBe(true);
    });

    it('returns hasMore false when all items fetched', async () => {
      const pool = makePool({ rows: [EXCEPTION_ROW], rowCount: 1 }, { rows: [{ count: '1' }] });
      const store = new PostgresReconciliationReadModelStore(pool);
      const page = await store.listRunExceptionsPage('run-1', 10, 0);
      expect(page.hasMore).toBe(false);
    });

    it('handles null count gracefully', async () => {
      const pool = makePool({ rows: [] }, { rows: [{ count: null }] });
      const store = new PostgresReconciliationReadModelStore(pool);
      const page = await store.listRunExceptionsPage('run-1', 10, 0);
      expect(page.total).toBe(0);
    });

    it('applies category and severity filters to the items and count queries', async () => {
      const pool = makePool({ rows: [EXCEPTION_ROW], rowCount: 1 }, { rows: [{ count: '1' }] });
      const store = new PostgresReconciliationReadModelStore(pool);
      await store.listRunExceptionsPage('run-1', 10, 0, {
        category: 'AmountMismatch',
        severity: 'High',
      });

      const query = pool.query as unknown as ReturnType<typeof vi.fn>;
      const [itemsSql, itemsParams] = query.mock.calls[0] as [string, unknown[]];
      const [countSql, countParams] = query.mock.calls[1] as [string, unknown[]];

      expect(itemsSql).toContain('category = $2');
      expect(itemsSql).toContain('severity = $3');
      expect(itemsParams).toEqual(['run-1', 'AmountMismatch', 'High', 10, 0]);
      expect(countSql).toContain('category = $2');
      expect(countSql).toContain('severity = $3');
      expect(countParams).toEqual(['run-1', 'AmountMismatch', 'High']);
    });
  });

  describe('listReviewerDecisions', () => {
    it('returns empty array when no decisions', async () => {
      const pool = makePool({ rows: [] });
      const store = new PostgresReconciliationReadModelStore(pool);
      expect(await store.listReviewerDecisions('run-1')).toEqual([]);
    });

    it('maps decision rows with null optional fields', async () => {
      const pool = makePool({
        rows: [
          {
            ...REVIEWER_DECISION_ROW,
            final_category: null,
            notes: null,
            reviewer_id: null,
            reviewer_name: null,
          },
        ],
      });
      const store = new PostgresReconciliationReadModelStore(pool);
      const decisions = await store.listReviewerDecisions('run-1');

      expect(decisions[0]?.finalCategory).toBeUndefined();
      expect(decisions[0]?.notes).toBeUndefined();
      expect(decisions[0]?.reviewerId).toBeUndefined();
      expect(decisions[0]?.reviewerName).toBeUndefined();
    });
  });
});

describe('createPayeeAlias', () => {
  it('creates with all explicit fields', async () => {
    const pool = makePool({ rows: [PAYEE_ROW] });
    const alias = await createPayeeAlias(pool, {
      accountIdentifier: 'ACCT-001',
      bankPattern: 'GOOGLE',
      canonicalPayeeName: 'Google LLC',
      normalizedTokens: ['google'],
      sourceDirection: 'bank_to_qbo',
      matchConfidence: 0.95,
    });
    expect(alias.id).toBe('alias-1');
    expect(alias.canonicalPayeeName).toBe('Google LLC');
    expect(alias.matchConfidence).toBe(0.95);
  });

  it('uses defaults when optional fields are omitted', async () => {
    const pool = makePool({ rows: [PAYEE_ROW] });
    await createPayeeAlias(pool, {
      bankPattern: 'GOOGLE',
      canonicalPayeeName: 'Google LLC',
      normalizedTokens: ['google'],
    });
    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const params = call[1] as unknown[];
    // $1 = accountIdentifier (null), $5 = direction, $6 = confidence
    expect(params[0]).toBeNull();
    expect(params[4]).toBe('bank_to_qbo');
    expect(params[5]).toBe(1);
  });

  it('throws when INSERT returns no row', async () => {
    const pool = makePool({ rows: [] });
    await expect(
      createPayeeAlias(pool, {
        bankPattern: 'GOOGLE',
        canonicalPayeeName: 'Google LLC',
        normalizedTokens: [],
      }),
    ).rejects.toThrow('createPayeeAlias: INSERT returned no row');
  });

  it('maps a payee alias with null account_identifier', async () => {
    const pool = makePool({ rows: [{ ...PAYEE_ROW, account_identifier: null }] });
    const alias = await createPayeeAlias(pool, {
      bankPattern: 'GOOGLE',
      canonicalPayeeName: 'Google LLC',
      normalizedTokens: [],
    });
    expect(alias.accountIdentifier).toBeUndefined();
  });

  it('uses empty array when normalized_tokens is null', async () => {
    const pool = makePool({ rows: [{ ...PAYEE_ROW, normalized_tokens: null }] });
    const alias = await createPayeeAlias(pool, {
      bankPattern: 'GOOGLE',
      canonicalPayeeName: 'Google LLC',
      normalizedTokens: [],
    });
    expect(alias.normalizedTokens).toEqual([]);
  });
});

describe('updatePayeeAlias', () => {
  it('returns undefined immediately when no fields provided', async () => {
    const pool = makePool();
    const result = await updatePayeeAlias(pool, 'alias-1', {});
    expect(result).toBeUndefined();
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('updates a single field (bankPattern)', async () => {
    const pool = makePool({ rows: [PAYEE_ROW] });
    const result = await updatePayeeAlias(pool, 'alias-1', { bankPattern: 'GOOGLE*' });
    expect(result?.id).toBe('alias-1');
    const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sql).toContain('bank_pattern = $1');
    expect(sql).not.toContain('canonical_payee_name = $');
  });

  it('updates all writable fields', async () => {
    const pool = makePool({ rows: [PAYEE_ROW] });
    const result = await updatePayeeAlias(pool, 'alias-1', {
      bankPattern: 'GOOGLE*',
      canonicalPayeeName: 'Google Inc',
      normalizedTokens: ['google', 'inc'],
      sourceDirection: 'bidirectional',
      matchConfidence: 0.8,
    });
    expect(result?.id).toBe('alias-1');
    const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sql).toContain('bank_pattern');
    expect(sql).toContain('canonical_payee_name');
    expect(sql).toContain('normalized_tokens');
    expect(sql).toContain('source_direction');
    expect(sql).toContain('match_confidence');
  });

  it('returns undefined when no row matched the id', async () => {
    const pool = makePool({ rows: [] });
    const result = await updatePayeeAlias(pool, 'missing-id', { bankPattern: 'X' });
    expect(result).toBeUndefined();
  });
});

describe('deactivatePayeeAlias', () => {
  it('returns true when a row was deactivated', async () => {
    const pool = makePool({ rows: [], rowCount: 1 });
    expect(await deactivatePayeeAlias(pool, 'alias-1')).toBe(true);
  });

  it('returns false when no row matched', async () => {
    const pool = makePool({ rows: [], rowCount: 0 });
    expect(await deactivatePayeeAlias(pool, 'missing')).toBe(false);
  });

  it('returns false when rowCount is null', async () => {
    const pool = makePool({ rows: [], rowCount: null });
    expect(await deactivatePayeeAlias(pool, 'alias-1')).toBe(false);
  });
});

describe('loadPayeeAliases', () => {
  it('returns mapped aliases', async () => {
    const pool = makePool({ rows: [PAYEE_ROW] });
    const aliases = await loadPayeeAliases(pool);
    expect(aliases).toHaveLength(1);
    expect(aliases[0]?.bankPattern).toBe('GOOGLE');
  });

  it('passes null when no accountIdentifier given', async () => {
    const pool = makePool({ rows: [] });
    await loadPayeeAliases(pool);
    const params = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as unknown[];
    expect(params[0]).toBeNull();
  });

  it('passes accountIdentifier when provided', async () => {
    const pool = makePool({ rows: [] });
    await loadPayeeAliases(pool, 'ACCT-001');
    const params = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as unknown[];
    expect(params[0]).toBe('ACCT-001');
  });

  it('returns empty array when no active aliases', async () => {
    const pool = makePool({ rows: [] });
    expect(await loadPayeeAliases(pool)).toEqual([]);
  });
});
