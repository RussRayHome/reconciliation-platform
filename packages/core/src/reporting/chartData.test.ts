import type { ExceptionItem, ReconciliationFrequency, SummaryMetrics } from '@recon/domain';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildAgingBuckets, buildChartSeries } from './chartData';

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
  rollForward: {
    openingCount: 0,
    openingAmount: 0,
    newCount: 0,
    newAmount: 0,
    clearedCount: 0,
    clearedAmount: 0,
    writtenOffCount: 0,
    writtenOffAmount: 0,
    closingCount: 0,
    closingAmount: 0,
  },
};

const agingDataFor = (
  exceptions: ExceptionItem[],
  staleOutstandingCheckDays = 45,
  reconciliationFrequency: ReconciliationFrequency = 'Monthly',
) =>
  buildChartSeries(baseSummary, exceptions, staleOutstandingCheckDays, reconciliationFrequency).find(
    (chart) => chart.id === 'outstandingCheckAging',
  )?.data;

describe('buildAgingBuckets', () => {
  it('derives 0-5 / 6-30 / 31-44 / 45+ from the default 45-day Monthly stale threshold', () => {
    expect(buildAgingBuckets(45, 'Monthly').map((bucket) => bucket.label)).toEqual([
      '0-5 days',
      '6-30 days',
      '31-44 days',
      '45+ days',
    ]);
  });

  it('derives 0-30 / 31-90 / 91-119 / 120+ for an Annual account with a 120-day threshold', () => {
    expect(buildAgingBuckets(120, 'Annual').map((bucket) => bucket.label)).toEqual([
      '0-30 days',
      '31-90 days',
      '91-119 days',
      '120+ days',
    ]);
  });

  it('collapses to a single open bucket at a 0-day stale threshold, never an empty or inverted band set', () => {
    expect(buildAgingBuckets(0, 'Monthly').map((bucket) => bucket.label)).toEqual(['0+ days']);
  });

  it('collapses to two gap-free buckets at a small stale threshold (<= 6 days)', () => {
    expect(buildAgingBuckets(5, 'Monthly').map((bucket) => bucket.label)).toEqual([
      '0-4 days',
      '5+ days',
    ]);
    expect(buildAgingBuckets(6, 'Monthly').map((bucket) => bucket.label)).toEqual([
      '0-5 days',
      '6+ days',
    ]);
  });

  it('produces non-overlapping, gap-free bounds up to the METRIC_RANGES max of 120 days', () => {
    const buckets = buildAgingBuckets(120, 'Monthly');
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      '0-5 days',
      '6-30 days',
      '31-119 days',
      '120+ days',
    ]);
    // Every non-open bound strictly increases and the final bucket is unbounded.
    const closed = buckets.slice(0, -1);
    for (let i = 1; i < closed.length; i += 1) {
      expect(closed[i]!.maxDays).toBeGreaterThan(closed[i - 1]!.maxDays);
    }
    expect(buckets.at(-1)?.maxDays).toBe(Infinity);
  });
});

describe('buildChartSeries — outstandingCheckAging', () => {
  it('always returns every bucket, in order, even with no matching exceptions', () => {
    expect(agingDataFor([])).toEqual([
      { label: '0-5 days', value: 0 },
      { label: '6-30 days', value: 0 },
      { label: '31-44 days', value: 0 },
      { label: '45+ days', value: 0 },
    ]);
  });

  it('sorts ages at each bucket boundary into the correct (inclusive) bucket, including the 44/45 boundary the stale threshold now sits on', () => {
    const data = agingDataFor([
      buildException({ category: 'OutstandingCheck', ageInDays: 0 }),
      buildException({ category: 'OutstandingCheck', ageInDays: 5 }),
      buildException({ category: 'OutstandingCheck', ageInDays: 6 }),
      buildException({ category: 'OutstandingCheck', ageInDays: 30 }),
      buildException({ category: 'StaleOutstandingCheck', ageInDays: 31 }),
      buildException({ category: 'StaleOutstandingCheck', ageInDays: 44 }),
      buildException({ category: 'StaleOutstandingCheck', ageInDays: 45 }),
      buildException({ category: 'StaleOutstandingCheck', ageInDays: 400 }),
    ]);

    expect(data).toEqual([
      { label: '0-5 days', value: 2 },
      { label: '6-30 days', value: 2 },
      { label: '31-44 days', value: 2 },
      { label: '45+ days', value: 2 },
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
      { label: '31-44 days', value: 0 },
      { label: '45+ days', value: 0 },
    ]);
  });

  it('derives Annual bands (0-30 / 31-90 / 91-.../.../+) instead of the Monthly bands', () => {
    const data = agingDataFor(
      [
        buildException({ category: 'OutstandingCheck', ageInDays: 30 }),
        buildException({ category: 'StaleOutstandingCheck', ageInDays: 91 }),
        buildException({ category: 'StaleOutstandingCheck', ageInDays: 120 }),
      ],
      120,
      'Annual',
    );

    expect(data).toEqual([
      { label: '0-30 days', value: 1 },
      { label: '31-90 days', value: 0 },
      { label: '91-119 days', value: 1 },
      { label: '120+ days', value: 1 },
    ]);
  });
});
