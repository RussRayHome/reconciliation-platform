import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  PostgresReconciliationReadModelStore,
  createMappingProfile,
  createMappingProfileVersion,
  createMatchingConfigVersionDraft,
  createPayeeAlias,
  deactivatePayeeAlias,
  findMappingProfile,
  getMappingProfileDetail,
  listMappingProfiles,
  listMappingProfileVersions,
  listMatchingConfigVersions,
  loadPayeeAliases,
  publishMatchingConfigVersion,
  recordLoginEvent,
  retireMappingProfile,
  updatePayeeAlias,
} from './readModelStore';

type QueryResult = { rows: unknown[]; rowCount?: number | null };

const makePool = (...responses: QueryResult[]): Pool => {
  const mock = vi.fn();
  for (const r of responses) {
    mock.mockResolvedValueOnce(r);
  }

  // Every store method now goes through runInTenantScope (packages/persistence/src/postgres.ts),
  // which checks out a client and issues BEGIN / SET LOCAL app.current_organization_id / ... /
  // COMMIT rather than calling pool.query directly. Transaction-control and the set_config GUC
  // call are answered here without touching `mock` -- they must not consume a queued response or
  // appear in mock.calls, since every existing assertion below indexes mock.calls by the real
  // query's position.
  const clientQuery = (text: string, params?: unknown[]) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('set_config(')) {
      return Promise.resolve({ rows: [{ set_config: params?.[1] }], rowCount: 1 });
    }
    return mock(text, params);
  };

  return {
    query: mock,
    connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
  } as unknown as Pool;
};

const MAPPING_PROFILE_ROW = {
  id: 'profile-1',
  organization_id: 'org-1',
  name: 'Monthly Bank + GL',
  source_type: 'gl' as const,
  status: 'ACTIVE' as const,
  created_at: '2026-08-01T00:00:00.000Z',
};

const MAPPING_PROFILE_VERSION_ROW = {
  id: 'version-1',
  profile_id: 'profile-1',
  version_number: 1,
  column_mapping: { 'Account Code': 'accountIdentifier' },
  transformation_rules: [],
  status: 'ACTIVE' as const,
  created_by: 'rray',
  created_at: '2026-08-01T00:00:00.000Z',
};

const PAYEE_ROW = {
  id: 'alias-1',
  account_identifier: 'ACCT-001',
  bank_pattern: 'GOOGLE',
  canonical_payee_name: 'Google LLC',
  normalized_tokens: ['google'],
  source_direction: 'bank_to_gl' as const,
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
  gl_transaction_ids: ['qt-1'],
  bank_members_json: [{ id: 'bt-1', amount: 100 }],
  gl_members_json: [{ id: 'qt-1', amount: 100 }],
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
  gl_transaction_id: 'qt-2',
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
  category: 'MissingFromGL' as const,
  severity: 'High' as const,
  source_system: 'bank' as const,
  spreadsheet_file_name: 'bank.xlsx',
  line_number: 3,
  transaction_date: '2026-05-15',
  amount: '500.00',
  error_message: 'No matching GL transaction found',
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
  gl_records: 5,
  exact_matches: 4,
  probable_matches: 1,
  unmatched_items: 2,
  duplicates: 0,
  bank_duplicates: 0,
  gl_duplicates: 0,
  date_variances: 0,
  timing_differences: 0,
  data_quality_issues: 1,
  amount_mismatches: 0,
  missing_from_bank: 0,
  missing_from_gl: 2,
  unmatched_bank_net_amount: '150.00',
  unmatched_gl_net_amount: '200.00',
  clean_matched_amount: '1000.00',
  unresolved_exposure: '350.00',
  counts_by_category_json: { MissingFromGL: 2 },
  amount_by_category_json: { MissingFromGL: 200 },
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
      expect(await store.findLatestRunReport('org-1')).toBeUndefined();
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
      const report = await store.findLatestRunReport('org-1');
      expect(report?.id).toBe('run-1');
    });
  });

  describe('findRunReportById', () => {
    it('returns undefined when job not found', async () => {
      const pool = buildRunReportPool({ jobRow: null });
      const store = new PostgresReconciliationReadModelStore(pool);
      expect(await store.findRunReportById('org-1', 'run-1')).toBeUndefined();
    });

    it('maps all fields from a completed run', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('org-1', 'run-1');

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
      const report = await store.findRunReportById('org-1', 'run-1');

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
      const report = await store.findRunReportById('org-1', 'run-1');

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
      const report = await store.findRunReportById('org-1', 'run-1');

      expect(report?.probableMatches).toHaveLength(1);
      expect(report?.probableMatches[0]).toMatchObject({
        id: 'mr-1',
        bankTransactionId: 'bt-2',
        glTransactionId: 'qt-2',
        amountDifference: 2.5,
        likelyMatchingReference: 'REF-001',
      });
    });

    it('maps exceptions via mapException', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('org-1', 'run-1');

      expect(report?.exceptions).toHaveLength(1);
      expect(report?.exceptions[0]).toMatchObject({
        id: 'ex-1',
        runId: 'run-1',
        category: 'MissingFromGL',
        amount: 500,
        normalizedComparisonTokens: ['payment'],
      });
    });

    it('maps reviewer observations', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('org-1', 'run-1');

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
      const report = await store.findRunReportById('org-1', 'run-1');

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
      const report = await store.findRunReportById('org-1', 'run-1');

      expect(report?.outputWorkbook).toMatchObject({
        fileName: 'recon-output.xlsx',
        tabNames: ['Summary', 'Exceptions'],
      });
    });

    it('returns undefined outputWorkbook when no export row', async () => {
      const pool = buildRunReportPool({ exportRow: null });
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('org-1', 'run-1');
      expect(report?.outputWorkbook).toBeUndefined();
    });

    it('returns empty summary fallback when no summary row', async () => {
      const pool = buildRunReportPool({ summaryRow: null });
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('org-1', 'run-1');

      expect(report?.summary.totalRecordsReviewed).toBe(0);
      expect(report?.summary.exactMatches).toBe(0);
      expect(report?.summary.charts).toEqual([]);
    });

    it('maps summary numeric fields from string columns', async () => {
      const pool = buildRunReportPool();
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('org-1', 'run-1');

      expect(report?.summary).toMatchObject({
        totalRecordsReviewed: 10,
        unmatchedBankNetAmount: 150,
        unmatchedGlNetAmount: 200,
        cleanMatchedAmount: 1000,
        unresolvedExposure: 350,
        countsByCategory: { MissingFromGL: 2 },
      });
    });

    it('returns status Failed for FAILED state', async () => {
      const pool = buildRunReportPool({
        jobRow: { current_state: 'FAILED', completed_at: undefined },
      });
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('org-1', 'run-1');
      expect(report?.status).toBe('Failed');
    });

    it('returns status Running when no completed_at and not FAILED', async () => {
      const pool = buildRunReportPool({
        jobRow: { current_state: 'MATCHING', completed_at: undefined },
      });
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('org-1', 'run-1');
      expect(report?.status).toBe('Running');
    });

    it('returns status Completed when completed_at is set', async () => {
      const pool = buildRunReportPool({
        jobRow: { current_state: 'FINALIZED', completed_at: '2026-06-01T01:00:00Z' },
      });
      const store = new PostgresReconciliationReadModelStore(pool);
      const report = await store.findRunReportById('org-1', 'run-1');
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
      const report = await store2.findRunReportById('org-1', 'run-1');
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
              gl_transaction_id: null,
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
      const report = await store.findRunReportById('org-1', 'run-1');
      const mr = report?.probableMatches[0];

      expect(mr?.bankTransactionId).toBeUndefined();
      expect(mr?.glTransactionId).toBeUndefined();
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
              gl_transaction_ids: 'not-an-array',
              bank_members_json: null,
              gl_members_json: null,
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
      const report = await store.findRunReportById('org-1', 'run-1');
      const gm = report?.groupedMatchResults[0];

      expect(gm?.category).toBeUndefined();
      expect(gm?.bankTransactionIds).toEqual([]);
      expect(gm?.glTransactionIds).toEqual([]);
      expect(gm?.bankMembers).toEqual([]);
      expect(gm?.evidence).toEqual([]);
    });
  });

  describe('findRunSummaryById', () => {
    it('returns undefined when no summary row', async () => {
      const pool = makePool({ rows: [] });
      const store = new PostgresReconciliationReadModelStore(pool);
      expect(await store.findRunSummaryById('org-1', 'run-1')).toBeUndefined();
    });

    it('returns mapped summary metrics', async () => {
      const pool = makePool({ rows: [SUMMARY_ROW] });
      const store = new PostgresReconciliationReadModelStore(pool);
      const summary = await store.findRunSummaryById('org-1', 'run-1');
      expect(summary?.totalRecordsReviewed).toBe(10);
      expect(summary?.cleanMatchedAmount).toBe(1000);
    });
  });

  describe('listRunExceptions', () => {
    it('returns empty array when no exceptions', async () => {
      const pool = makePool({ rows: [] });
      const store = new PostgresReconciliationReadModelStore(pool);
      expect(await store.listRunExceptions('org-1', 'run-1')).toEqual([]);
    });

    it('maps exception rows including null optional fields', async () => {
      const pool = makePool({ rows: [EXCEPTION_ROW] });
      const store = new PostgresReconciliationReadModelStore(pool);
      const items = await store.listRunExceptions('org-1', 'run-1');

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
      const items = await store.listRunExceptions('org-1', 'run-1');
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
      const items = await store.listRunExceptions('org-1', 'run-1');
      expect(items[0]?.likelyMatchingReference).toBe('REF-999');
      expect(items[0]?.reviewerNotes).toBe('Checked by Alice');
      expect(items[0]?.matchConfidence).toBe('High');
    });
  });

  describe('listRunExceptionsPage', () => {
    it('returns paginated result with hasMore true', async () => {
      const pool = makePool({ rows: [EXCEPTION_ROW], rowCount: 1 }, { rows: [{ count: '5' }] });
      const store = new PostgresReconciliationReadModelStore(pool);
      const page = await store.listRunExceptionsPage('org-1', 'run-1', 1, 0);

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(5);
      expect(page.limit).toBe(1);
      expect(page.offset).toBe(0);
      expect(page.hasMore).toBe(true);
    });

    it('returns hasMore false when all items fetched', async () => {
      const pool = makePool({ rows: [EXCEPTION_ROW], rowCount: 1 }, { rows: [{ count: '1' }] });
      const store = new PostgresReconciliationReadModelStore(pool);
      const page = await store.listRunExceptionsPage('org-1', 'run-1', 10, 0);
      expect(page.hasMore).toBe(false);
    });

    it('handles null count gracefully', async () => {
      const pool = makePool({ rows: [] }, { rows: [{ count: null }] });
      const store = new PostgresReconciliationReadModelStore(pool);
      const page = await store.listRunExceptionsPage('org-1', 'run-1', 10, 0);
      expect(page.total).toBe(0);
    });

    it('applies category and severity filters to the items and count queries', async () => {
      const pool = makePool({ rows: [EXCEPTION_ROW], rowCount: 1 }, { rows: [{ count: '1' }] });
      const store = new PostgresReconciliationReadModelStore(pool);
      await store.listRunExceptionsPage('org-1', 'run-1', 10, 0, {
        category: 'AmountMismatch',
        severity: 'High',
      });

      const [itemsSql, itemsParams] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        unknown[],
      ];
      const [countSql, countParams] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[1] as [
        string,
        unknown[],
      ];

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
      expect(await store.listReviewerDecisions('org-1', 'run-1')).toEqual([]);
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
      const decisions = await store.listReviewerDecisions('org-1', 'run-1');

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
      organizationId: 'org-1',
      accountIdentifier: 'ACCT-001',
      bankPattern: 'GOOGLE',
      canonicalPayeeName: 'Google LLC',
      normalizedTokens: ['google'],
      sourceDirection: 'bank_to_gl',
      matchConfidence: 0.95,
    });
    expect(alias.id).toBe('alias-1');
    expect(alias.canonicalPayeeName).toBe('Google LLC');
    expect(alias.matchConfidence).toBe(0.95);
  });

  it('uses defaults when optional fields are omitted', async () => {
    const pool = makePool({ rows: [PAYEE_ROW] });
    await createPayeeAlias(pool, {
      organizationId: 'org-1',
      bankPattern: 'GOOGLE',
      canonicalPayeeName: 'Google LLC',
      normalizedTokens: ['google'],
    });
    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const params = call[1] as unknown[];
    // $1 = organizationId, $2 = accountIdentifier (null), $6 = direction, $7 = confidence
    expect(params[0]).toBe('org-1');
    expect(params[1]).toBeNull();
    expect(params[5]).toBe('bank_to_gl');
    expect(params[6]).toBe(1);
  });

  it('throws when INSERT returns no row', async () => {
    const pool = makePool({ rows: [] });
    await expect(
      createPayeeAlias(pool, {
        organizationId: 'org-1',
        bankPattern: 'GOOGLE',
        canonicalPayeeName: 'Google LLC',
        normalizedTokens: [],
      }),
    ).rejects.toThrow('createPayeeAlias: INSERT returned no row');
  });

  it('maps a payee alias with null account_identifier', async () => {
    const pool = makePool({ rows: [{ ...PAYEE_ROW, account_identifier: null }] });
    const alias = await createPayeeAlias(pool, {
      organizationId: 'org-1',
      bankPattern: 'GOOGLE',
      canonicalPayeeName: 'Google LLC',
      normalizedTokens: [],
    });
    expect(alias.accountIdentifier).toBeUndefined();
  });

  it('uses empty array when normalized_tokens is null', async () => {
    const pool = makePool({ rows: [{ ...PAYEE_ROW, normalized_tokens: null }] });
    const alias = await createPayeeAlias(pool, {
      organizationId: 'org-1',
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
    const result = await updatePayeeAlias(pool, 'org-1', 'alias-1', {});
    expect(result).toBeUndefined();
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('updates a single field (bankPattern)', async () => {
    const pool = makePool({ rows: [PAYEE_ROW] });
    const result = await updatePayeeAlias(pool, 'org-1', 'alias-1', { bankPattern: 'GOOGLE*' });
    expect(result?.id).toBe('alias-1');
    const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sql).toContain('bank_pattern = $1');
    expect(sql).not.toContain('canonical_payee_name = $');
  });

  it('updates all writable fields', async () => {
    const pool = makePool({ rows: [PAYEE_ROW] });
    const result = await updatePayeeAlias(pool, 'org-1', 'alias-1', {
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
    const result = await updatePayeeAlias(pool, 'org-1', 'missing-id', { bankPattern: 'X' });
    expect(result).toBeUndefined();
  });
});

describe('deactivatePayeeAlias', () => {
  it('returns true when a row was deactivated', async () => {
    const pool = makePool({ rows: [], rowCount: 1 });
    expect(await deactivatePayeeAlias(pool, 'org-1', 'alias-1')).toBe(true);
  });

  it('returns false when no row matched', async () => {
    const pool = makePool({ rows: [], rowCount: 0 });
    expect(await deactivatePayeeAlias(pool, 'org-1', 'missing')).toBe(false);
  });

  it('returns false when rowCount is null', async () => {
    const pool = makePool({ rows: [], rowCount: null });
    expect(await deactivatePayeeAlias(pool, 'org-1', 'alias-1')).toBe(false);
  });
});

describe('loadPayeeAliases', () => {
  it('returns mapped aliases', async () => {
    const pool = makePool({ rows: [PAYEE_ROW] });
    const aliases = await loadPayeeAliases(pool, 'org-1');
    expect(aliases).toHaveLength(1);
    expect(aliases[0]?.bankPattern).toBe('GOOGLE');
  });

  it('passes null when no accountIdentifier given', async () => {
    const pool = makePool({ rows: [] });
    await loadPayeeAliases(pool, 'org-1');
    const params = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as unknown[];
    expect(params[0]).toBeNull();
  });

  it('passes accountIdentifier when provided', async () => {
    const pool = makePool({ rows: [] });
    await loadPayeeAliases(pool, 'org-1', 'ACCT-001');
    const params = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as unknown[];
    expect(params[0]).toBe('ACCT-001');
  });

  it('returns empty array when no active aliases', async () => {
    const pool = makePool({ rows: [] });
    expect(await loadPayeeAliases(pool, 'org-1')).toEqual([]);
  });
});

describe('findMappingProfile', () => {
  it('maps an existing profile row', async () => {
    const pool = makePool({ rows: [MAPPING_PROFILE_ROW] });
    const profile = await findMappingProfile(pool, 'org-1', 'Monthly Bank + GL', 'gl');
    expect(profile).toMatchObject({ id: 'profile-1', sourceType: 'gl', name: 'Monthly Bank + GL' });
  });

  it('returns null when no profile exists for that name and side', async () => {
    const pool = makePool({ rows: [] });
    const profile = await findMappingProfile(pool, 'org-1', 'Nonexistent', 'bank');
    expect(profile).toBeNull();
  });
});

describe('createMappingProfile', () => {
  it('creates and maps a new profile', async () => {
    const pool = makePool({ rows: [MAPPING_PROFILE_ROW] });
    const profile = await createMappingProfile(pool, {
      id: 'profile-1',
      organizationId: 'org-1',
      name: 'Monthly Bank + GL',
      sourceType: 'gl',
    });
    expect(profile.id).toBe('profile-1');
    expect(profile.status).toBe('ACTIVE');
  });

  it('throws when INSERT returns no row', async () => {
    const pool = makePool({ rows: [] });
    await expect(
      createMappingProfile(pool, {
        id: 'profile-1',
        organizationId: 'org-1',
        name: 'Monthly Bank + GL',
        sourceType: 'gl',
      }),
    ).rejects.toThrow('createMappingProfile: INSERT returned no row');
  });
});

describe('listMappingProfiles', () => {
  it('returns distinct profile names, deduped across the gl/bank row pairing', async () => {
    const pool = makePool({ rows: [{ name: 'Amex Corporate' }, { name: 'Chase Operating' }] });
    const names = await listMappingProfiles(pool, 'org-1');
    expect(names).toEqual(['Amex Corporate', 'Chase Operating']);
  });

  it('returns an empty array for an organization with no saved profiles yet', async () => {
    const pool = makePool({ rows: [] });
    expect(await listMappingProfiles(pool, 'org-1')).toEqual([]);
  });
});

describe('getMappingProfileDetail', () => {
  it('returns both sides with their version histories when both exist', async () => {
    const glRow = MAPPING_PROFILE_ROW;
    const bankRow = { ...MAPPING_PROFILE_ROW, id: 'profile-2', source_type: 'bank' as const };
    const pool = makePool(
      { rows: [glRow, bankRow] },
      { rows: [MAPPING_PROFILE_VERSION_ROW] },
      { rows: [{ ...MAPPING_PROFILE_VERSION_ROW, id: 'version-2', profile_id: 'profile-2' }] },
    );

    const detail = await getMappingProfileDetail(pool, 'org-1', 'Monthly Bank + GL', 'rray');

    expect(detail?.name).toBe('Monthly Bank + GL');
    expect(detail?.gl?.profile.id).toBe('profile-1');
    expect(detail?.gl?.versions).toHaveLength(1);
    expect(detail?.bank?.profile.id).toBe('profile-2');
    expect(detail?.bank?.versions).toHaveLength(1);
  });

  it('leaves a side null when only one side was ever saved', async () => {
    const pool = makePool({ rows: [MAPPING_PROFILE_ROW] }, { rows: [MAPPING_PROFILE_VERSION_ROW] });

    const detail = await getMappingProfileDetail(pool, 'org-1', 'Monthly Bank + GL', 'rray');

    expect(detail?.gl).not.toBeNull();
    expect(detail?.bank).toBeNull();
  });

  it('returns null when the name does not exist (or belongs to another tenant)', async () => {
    const pool = makePool({ rows: [] });
    expect(await getMappingProfileDetail(pool, 'org-1', 'Nonexistent', 'rray')).toBeNull();
  });
});

describe('retireMappingProfile', () => {
  it('flips both sides to DEPRECATED and returns the updated rows', async () => {
    const pool = makePool({
      rows: [
        { ...MAPPING_PROFILE_ROW, status: 'DEPRECATED' as const },
        { ...MAPPING_PROFILE_ROW, id: 'profile-2', source_type: 'bank' as const, status: 'DEPRECATED' as const },
      ],
    });

    const retired = await retireMappingProfile(pool, 'org-1', 'Monthly Bank + GL', 'rray');

    expect(retired).toHaveLength(2);
    expect(retired.every((row) => row.status === 'DEPRECATED')).toBe(true);
  });

  it('returns an empty array when nothing ACTIVE matched the name', async () => {
    const pool = makePool({ rows: [] });
    expect(await retireMappingProfile(pool, 'org-1', 'Nonexistent', 'rray')).toEqual([]);
  });
});

describe('listMappingProfileVersions', () => {
  it('maps every version row', async () => {
    const pool = makePool({
      rows: [
        MAPPING_PROFILE_VERSION_ROW,
        { ...MAPPING_PROFILE_VERSION_ROW, id: 'version-2', version_number: 2 },
      ],
    });
    const versions = await listMappingProfileVersions(pool, 'org-1', 'profile-1');
    expect(versions).toHaveLength(2);
    expect(versions[0]?.versionNumber).toBe(1);
    expect(versions[1]?.versionNumber).toBe(2);
  });

  it('returns an empty array for a profile with no versions yet', async () => {
    const pool = makePool({ rows: [] });
    expect(await listMappingProfileVersions(pool, 'org-1', 'profile-1')).toEqual([]);
  });
});

describe('createMappingProfileVersion', () => {
  it('creates and maps a new version', async () => {
    const pool = makePool({ rows: [MAPPING_PROFILE_VERSION_ROW] });
    const version = await createMappingProfileVersion(pool, 'org-1', {
      id: 'version-1',
      profileId: 'profile-1',
      versionNumber: 1,
      columnMapping: { 'Account Code': 'accountIdentifier' },
      transformationRules: [],
      createdBy: 'rray',
    });
    expect(version.id).toBe('version-1');
    expect(version.columnMapping).toEqual({ 'Account Code': 'accountIdentifier' });
  });

  it('throws when INSERT returns no row', async () => {
    const pool = makePool({ rows: [] });
    await expect(
      createMappingProfileVersion(pool, 'org-1', {
        id: 'version-1',
        profileId: 'profile-1',
        versionNumber: 1,
        columnMapping: {},
        transformationRules: [],
        createdBy: 'rray',
      }),
    ).rejects.toThrow('createMappingProfileVersion: INSERT returned no row');
  });
});

const MATCHING_CONFIG_VERSION_ROW = {
  id: 'mcv-1',
  organization_id: 'org-1',
  version_number: 1,
  status: 'DRAFT' as const,
  variance_overrides: { wireFeeTolerance: 750 },
  created_by: 'rray',
  created_at: '2026-08-01T00:00:00.000Z',
  published_by: null,
  published_at: null,
  effective_at: null,
  pending_approval_owner: 'mortega',
};

describe('createMatchingConfigVersionDraft', () => {
  it('creates and maps a new draft version', async () => {
    const pool = makePool({ rows: [MATCHING_CONFIG_VERSION_ROW] });
    const version = await createMatchingConfigVersionDraft(pool, {
      id: 'mcv-1',
      organizationId: 'org-1',
      varianceOverrides: { wireFeeTolerance: 750 },
      createdBy: 'rray',
      draftReason: 'Widen wire fee tolerance after the Q3 bank fee change',
      pendingApprovalOwner: 'mortega',
    });
    expect(version.id).toBe('mcv-1');
    expect(version.status).toBe('DRAFT');
    expect(version.varianceOverrides).toEqual({ wireFeeTolerance: 750 });
    expect(version.pendingApprovalOwner).toBe('mortega');
    expect(version.publishedBy).toBeNull();
  });

  it('throws when INSERT returns no row', async () => {
    const pool = makePool({ rows: [] });
    await expect(
      createMatchingConfigVersionDraft(pool, {
        id: 'mcv-1',
        organizationId: 'org-1',
        varianceOverrides: {},
        createdBy: 'rray',
        draftReason: 'reason',
      }),
    ).rejects.toThrow('createMatchingConfigVersionDraft: INSERT returned no row');
  });
});

describe('publishMatchingConfigVersion', () => {
  it('activates the draft and returns it, superseding the previous active version in the same call', async () => {
    const activatedRow = {
      ...MATCHING_CONFIG_VERSION_ROW,
      status: 'ACTIVE' as const,
      published_by: 'mortega',
      published_at: '2026-08-04T00:00:00.000Z',
      effective_at: '2026-08-01T00:00:00.000Z',
      pending_approval_owner: null,
    };
    // Supersede-old-active runs first (see publishMatchingConfigVersion's comment on why), so
    // its response is queued first; the activate-draft response follows.
    const pool = makePool({ rows: [], rowCount: 1 }, { rows: [activatedRow] });

    const version = await publishMatchingConfigVersion(pool, 'org-1', 'mcv-1', {
      publishedBy: 'mortega',
      effectiveAt: '2026-08-01T00:00:00.000Z',
    });

    expect(version.status).toBe('ACTIVE');
    expect(version.publishedBy).toBe('mortega');
    expect(version.pendingApprovalOwner).toBeNull();
  });

  it('throws when there is no matching DRAFT version to publish', async () => {
    const pool = makePool({ rows: [], rowCount: 0 }, { rows: [] });
    await expect(
      publishMatchingConfigVersion(pool, 'org-1', 'mcv-missing', { publishedBy: 'mortega' }),
    ).rejects.toThrow('publishMatchingConfigVersion: no matching DRAFT version to publish');
  });
});

describe('listMatchingConfigVersions', () => {
  it('maps every version row, newest first', async () => {
    const pool = makePool({
      rows: [
        { ...MATCHING_CONFIG_VERSION_ROW, id: 'mcv-2', version_number: 2 },
        { ...MATCHING_CONFIG_VERSION_ROW, id: 'mcv-1', version_number: 1 },
      ],
    });
    const versions = await listMatchingConfigVersions(pool, 'org-1');
    expect(versions).toHaveLength(2);
    expect(versions[0]?.versionNumber).toBe(2);
    expect(versions[1]?.versionNumber).toBe(1);
  });

  it('returns an empty array for an organization with no versions yet', async () => {
    const pool = makePool({ rows: [] });
    expect(await listMatchingConfigVersions(pool, 'org-1')).toEqual([]);
  });
});

describe('recordLoginEvent', () => {
  // Plain pool.query, not runInTenantScope -- reconciliation_login_event is deliberately not
  // RLS-protected (see its changeset), so makePool's transaction-aware fake isn't the right fit.
  const makePlainPool = (row: Record<string, unknown>): Pool =>
    ({ query: vi.fn().mockResolvedValue({ rows: [row] }) }) as unknown as Pool;

  it('records a LOGIN_SUCCESS event with an organization', async () => {
    const pool = makePlainPool({
      id: 'login-1',
      organization_id: 'org-1',
      username: 'rray',
      event_type: 'LOGIN_SUCCESS',
      failure_reason: null,
      ip_address: '127.0.0.1',
      created_at: '2026-08-08T00:00:00.000Z',
    });

    const event = await recordLoginEvent(pool, {
      id: 'login-1',
      organizationId: 'org-1',
      username: 'rray',
      eventType: 'LOGIN_SUCCESS',
      ipAddress: '127.0.0.1',
    });

    expect(event.organizationId).toBe('org-1');
    expect(event.eventType).toBe('LOGIN_SUCCESS');
    expect(event.failureReason).toBeNull();
  });

  it('records a LOGIN_FAILURE event with a null organization and a failure reason', async () => {
    const pool = makePlainPool({
      id: 'login-2',
      organization_id: null,
      username: 'nonexistent-user',
      event_type: 'LOGIN_FAILURE',
      failure_reason: 'unknown_username',
      ip_address: null,
      created_at: '2026-08-08T00:00:00.000Z',
    });

    const event = await recordLoginEvent(pool, {
      id: 'login-2',
      organizationId: null,
      username: 'nonexistent-user',
      eventType: 'LOGIN_FAILURE',
      failureReason: 'unknown_username',
    });

    expect(event.organizationId).toBeNull();
    expect(event.failureReason).toBe('unknown_username');
  });

  it('throws when INSERT returns no row', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
    await expect(
      recordLoginEvent(pool, {
        id: 'login-3',
        organizationId: 'org-1',
        username: 'rray',
        eventType: 'LOGOUT',
      }),
    ).rejects.toThrow('recordLoginEvent: INSERT returned no row');
  });
});
