import type { ExceptionItem, SummaryMetrics } from '@recon/domain';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildChartSeries } from './chartData';

const buildException = (overrides: Partial<ExceptionItem>): ExceptionItem => ({
  id: overrides.id ?? randomUUID(),
  runId: overrides.runId ?? 'chart-run',
  category: overrides.category ?? 'OutstandingCheck',
  severity: overrides.severity ?? 'Medium',
  source: overrides.source ?? 'gl',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'chart.xlsx',
  lineNumber: overrides.lineNumber ?? 1,
  transactionDate: overrides.transactionDate,
  amount: overrides.amount ?? -100,
  ageInDays: overrides.ageInDays,
  errorMessage: overrides.errorMessage ?? 'test',
  recommendedNextActions: overrides.recommendedNextActions ?? [],
  normalizedComparisonTokens: overrides.normalizedComparisonTokens ?? [],
  relatedTransactionIds: overrides.relatedTransactionIds ?? [],
});

const baseSummary: SummaryMetrics = {
  totalRecordsReviewed: 0,
  bankRecords: 0,
  glRecords: 0,
  exactMatches: 0,
  probableMatches: 0,
  unmatchedItems: 0,
  duplicates: 0,
  bankDuplicates: 0,
  glDuplicates: 0,
  dateVariances: 0,
  timingDifferences: 0,
  dataQualityIssues: 0,
  amountMismatches: 0,
  missingFromBank: 0,
  missingFromGL: 0,
  unmatchedBankNetAmount: 0,
  unmatchedGlNetAmount: 0,
  cleanMatchedAmount: 0,
  unresolvedExposure: 0,
  countsByCategory: {},
  amountByCategory: {},
  charts: [],
};

const agingDataFor = (exceptions: ExceptionItem[]) =>
  buildChartSeries(baseSummary, exceptions).find((chart) => chart.id === 'outstandingCheckAging')
    ?.data;

describe('buildChartSeries — outstandingCheckAging', () => {
  it('always returns all four buckets, in order, even with no matching exceptions', () => {
    expect(agingDataFor([])).toEqual([
      { label: '0-5 days', value: 0 },
      { label: '6-30 days', value: 0 },
      { label: '31-60 days', value: 0 },
      { label: '60+ days', value: 0 },
    ]);
  });

  it('sorts ages at each bucket boundary into the correct (inclusive) bucket', () => {
    const data = agingDataFor([
      buildException({ category: 'OutstandingCheck', ageInDays: 0 }),
      buildException({ category: 'OutstandingCheck', ageInDays: 5 }),
      buildException({ category: 'OutstandingCheck', ageInDays: 6 }),
      buildException({ category: 'OutstandingCheck', ageInDays: 30 }),
      buildException({ category: 'StaleOutstandingCheck', ageInDays: 31 }),
      buildException({ category: 'StaleOutstandingCheck', ageInDays: 60 }),
      buildException({ category: 'StaleOutstandingCheck', ageInDays: 61 }),
      buildException({ category: 'StaleOutstandingCheck', ageInDays: 400 }),
    ]);

    expect(data).toEqual([
      { label: '0-5 days', value: 2 },
      { label: '6-30 days', value: 2 },
      { label: '31-60 days', value: 2 },
      { label: '60+ days', value: 2 },
    ]);
  });

  it('ignores exceptions of other categories and exceptions with no ageInDays', () => {
    const data = agingDataFor([
      buildException({ category: 'MissingFromGL', ageInDays: 10 }),
      buildException({ category: 'OutstandingCheck', ageInDays: undefined }),
      buildException({ category: 'OutstandingCheck', ageInDays: 3 }),
    ]);

    expect(data).toEqual([
      { label: '0-5 days', value: 1 },
      { label: '6-30 days', value: 0 },
      { label: '31-60 days', value: 0 },
      { label: '60+ days', value: 0 },
    ]);
  });
});
