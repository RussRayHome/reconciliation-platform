import type { ExceptionItem, MatchResult, NormalizedTransaction } from '@recon/domain';
import { describe, expect, it } from 'vitest';

import { buildSummaryMetrics } from './summary';
import { randomUUID } from 'node:crypto';

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: overrides.id ?? randomUUID(),
  runId: overrides.runId ?? 'summary-run',
  rawRowId: overrides.rawRowId ?? `${overrides.id ?? 'row'}-raw`,
  sourceFileId: overrides.sourceFileId ?? `${overrides.source ?? 'bank'}-file`,
  source: overrides.source ?? 'bank',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'summary.xlsx',
  worksheetName: overrides.worksheetName ?? 'Sheet1',
  lineNumber: overrides.lineNumber ?? 1,
  transactionDate: overrides.transactionDate,
  postingDate: overrides.postingDate,
  transactionType: overrides.transactionType,
  checkNumber: overrides.checkNumber,
  serialNumber: overrides.serialNumber,
  referenceNumber: overrides.referenceNumber,
  description: overrides.description,
  merchantName: overrides.merchantName,
  payeeName: overrides.payeeName,
  amount: overrides.amount ?? 0,
  splitAmount: overrides.splitAmount ?? null,
  debit: overrides.debit ?? null,
  credit: overrides.credit ?? null,
  runningBalance: overrides.runningBalance ?? null,
  normalizedComparisonText: overrides.normalizedComparisonText ?? '',
  normalizedComparisonTokens: overrides.normalizedComparisonTokens ?? [],
  normalizedReferenceTokens: overrides.normalizedReferenceTokens ?? [],
  rawSourceValues: overrides.rawSourceValues ?? {},
  dataQualityIssues: overrides.dataQualityIssues ?? [],
  isExcluded: overrides.isExcluded ?? false,
  exclusionReason: overrides.exclusionReason,
  isZeroAmount: overrides.isZeroAmount ?? false,
  contextFingerprint: overrides.contextFingerprint ?? `${overrides.id ?? 'row'}-fingerprint`,
  accountIdentifier: overrides.accountIdentifier,
  reviewerNotes: overrides.reviewerNotes,
  isCarriedForward: overrides.isCarriedForward,
  carriedFromOpenItemId: overrides.carriedFromOpenItemId,
});

const buildException = (overrides: Partial<ExceptionItem>): ExceptionItem => ({
  id: overrides.id ?? randomUUID(),
  runId: overrides.runId ?? 'summary-run',
  category: overrides.category ?? 'MissingFromGL',
  severity: overrides.severity ?? 'Medium',
  source: overrides.source ?? 'bank',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'summary.xlsx',
  lineNumber: overrides.lineNumber ?? 1,
  transactionDate: overrides.transactionDate,
  amount: overrides.amount ?? 0,
  errorMessage: overrides.errorMessage ?? 'test',
  recommendedNextActions: overrides.recommendedNextActions ?? [],
  likelyMatchingReference: overrides.likelyMatchingReference,
  reviewerNotes: overrides.reviewerNotes,
  matchConfidence: overrides.matchConfidence,
  normalizedComparisonTokens: overrides.normalizedComparisonTokens ?? [],
  relatedTransactionIds: overrides.relatedTransactionIds ?? [],
});

const buildMatchResult = (overrides: Partial<MatchResult> = {}): MatchResult => ({
  id: overrides.id ?? randomUUID(),
  disposition: overrides.disposition ?? 'DateVariance',
  confidence: overrides.confidence ?? 'DateVariance',
  ruleId: overrides.ruleId,
  ruleName: overrides.ruleName ?? 'Amount + Extended Date Window Match',
  // H7 (#276): required on MatchResult so a disposition always records the tolerance
  // that produced it. Defaulted here; assert on it where provenance is the subject.
  appliedAmountTolerance: overrides.appliedAmountTolerance ?? 0.01,
  matchingConfigVersionId: overrides.matchingConfigVersionId,
  reason: overrides.reason,
  score: overrides.score ?? 0.82,
  bankTransactionId: overrides.bankTransactionId,
  glTransactionId: overrides.glTransactionId,
  dateDifferenceDays: overrides.dateDifferenceDays ?? 7,
  amountDifference: overrides.amountDifference ?? 0,
  evidence: overrides.evidence ?? ['Amounts agree within configured tolerance.'],
  likelyMatchingReference: overrides.likelyMatchingReference,
  exceptionCategory: overrides.exceptionCategory ?? 'DateVariance',
  reviewerNotes: overrides.reviewerNotes,
});

describe('buildSummaryMetrics', () => {
  it('counts only bank-side data quality issues and folds them into unmatched totals', () => {
    const transactions: NormalizedTransaction[] = [
      buildTransaction({ id: 'bank-valid', source: 'bank', amount: 10 }),
      buildTransaction({
        id: 'bank-dq',
        source: 'bank',
        amount: 0,
        dataQualityIssues: ['Zero amount transaction requires review.'],
      }),
      buildTransaction({ id: 'gl-valid', source: 'gl', amount: 10 }),
      buildTransaction({
        id: 'gl-dq',
        source: 'gl',
        amount: 0,
        dataQualityIssues: ['Amount is missing or malformed.'],
      }),
    ];
    const matchResults: MatchResult[] = [];
    const exceptions: ExceptionItem[] = [
      buildException({ category: 'InvalidOrMissingData', source: 'bank', amount: 0 }),
      buildException({ category: 'InvalidOrMissingData', source: 'gl', amount: 0, lineNumber: 2 }),
      buildException({ category: 'MissingFromGL', source: 'bank', amount: 10, lineNumber: 3 }),
      buildException({ category: 'MissingFromBank', source: 'gl', amount: 10, lineNumber: 4 }),
    ];

    const summary = buildSummaryMetrics(transactions, matchResults, exceptions);

    expect(summary.bankRecords).toBe(2);
    expect(summary.glRecords).toBe(2);
    expect(summary.dataQualityIssues).toBe(2);
    expect(summary.unmatchedItems).toBe(4);
    expect(summary.missingFromGL).toBe(1);
    expect(summary.missingFromBank).toBe(1);
  });

  it('derives date variance and timing difference counts from final classified exceptions', () => {
    const transactions: NormalizedTransaction[] = [
      buildTransaction({ id: 'bank-1', source: 'bank', amount: -500, lineNumber: 5 }),
      buildTransaction({ id: 'gl-1', source: 'gl', amount: -500, lineNumber: 8 }),
      buildTransaction({ id: 'bank-2', source: 'bank', amount: -300, lineNumber: 10 }),
      buildTransaction({ id: 'gl-2', source: 'gl', amount: -300, lineNumber: 12 }),
    ];
    const matchResults: MatchResult[] = [
      buildMatchResult({
        bankTransactionId: 'bank-1',
        glTransactionId: 'gl-1',
        disposition: 'DateVariance',
        exceptionCategory: 'DateVariance',
      }),
      buildMatchResult({
        id: 'timing-result',
        bankTransactionId: 'bank-2',
        glTransactionId: 'gl-2',
        disposition: 'TimingDifference',
        confidence: 'TimingDifference',
        exceptionCategory: 'TimingDifference',
      }),
    ];
    const exceptions: ExceptionItem[] = [
      buildException({
        id: 'miscoding-bank',
        category: 'LikelyMiscoding',
        source: 'bank',
        amount: -500,
        lineNumber: 5,
        relatedTransactionIds: ['bank-1', 'gl-1'],
      }),
      buildException({
        id: 'miscoding-gl',
        category: 'LikelyMiscoding',
        source: 'gl',
        amount: -500,
        lineNumber: 8,
        relatedTransactionIds: ['bank-1', 'gl-1'],
      }),
      buildException({
        id: 'timing-bank',
        category: 'TimingDifference',
        source: 'bank',
        amount: -300,
        lineNumber: 10,
        relatedTransactionIds: ['bank-2', 'gl-2'],
      }),
      buildException({
        id: 'timing-gl',
        category: 'TimingDifference',
        source: 'gl',
        amount: -300,
        lineNumber: 12,
        relatedTransactionIds: ['bank-2', 'gl-2'],
      }),
    ];

    const summary = buildSummaryMetrics(transactions, matchResults, exceptions);

    expect(summary.dateVariances).toBe(0);
    expect(summary.timingDifferences).toBe(1);
    expect(summary.countsByCategory.LikelyMiscoding).toBe(2);
  });

  it('includes all present exception categories in summary chart data', () => {
    const transactions: NormalizedTransaction[] = [
      buildTransaction({ id: 'bank-1', source: 'bank', amount: -250, lineNumber: 3 }),
      buildTransaction({ id: 'gl-1', source: 'gl', amount: 410, lineNumber: 7 }),
    ];
    const exceptions: ExceptionItem[] = [
      buildException({
        category: 'LikelySplitCombineIssue',
        source: 'bank',
        amount: -250,
        lineNumber: 3,
      }),
      buildException({
        category: 'DepositGroupingIssue',
        source: 'gl',
        amount: 410,
        lineNumber: 7,
      }),
    ];

    const summary = buildSummaryMetrics(transactions, [], exceptions);
    const countChart = summary.charts.find((chart) => chart.id === 'countByCategory');
    const exposureChart = summary.charts.find((chart) => chart.id === 'exposureByCategory');

    expect(countChart?.data).toEqual(
      expect.arrayContaining([
        { label: 'Likely Split/Combine Issue', value: 1 },
        { label: 'Deposit Grouping Issue', value: 1 },
      ]),
    );
    expect(exposureChart?.data).toEqual(
      expect.arrayContaining([
        { label: 'Likely Split/Combine Issue', value: 250 },
        { label: 'Deposit Grouping Issue', value: 410 },
      ]),
    );
  });

  describe('rollForward (Unreconciled Item Roll-Forward PR D.4)', () => {
    it('computes opening/new/cleared/closing from carried-forward transactions and this run\'s own exceptions', () => {
      const transactions: NormalizedTransaction[] = [
        // Stays open all period -- never matched.
        buildTransaction({
          id: 'gl-carried-open',
          source: 'gl',
          amount: -500,
          isCarriedForward: true,
          carriedFromOpenItemId: 'open-item-1',
        }),
        // Clears this period against bank-clear below.
        buildTransaction({
          id: 'gl-carried-clear',
          source: 'gl',
          amount: -200,
          isCarriedForward: true,
          carriedFromOpenItemId: 'open-item-2',
        }),
        buildTransaction({ id: 'bank-clear', source: 'bank', amount: -200 }),
        // Fresh, unmatched -- this period's own genuinely new carry-eligible exception.
        buildTransaction({ id: 'bank-new', source: 'bank', amount: -75 }),
      ];
      const matchResults: MatchResult[] = [
        buildMatchResult({
          bankTransactionId: 'bank-clear',
          glTransactionId: 'gl-carried-clear',
          disposition: 'ExactMatch',
          confidence: 'Exact',
        }),
      ];
      const exceptions: ExceptionItem[] = [
        buildException({
          category: 'MissingFromGL',
          source: 'bank',
          amount: -75,
          relatedTransactionIds: ['bank-new'],
        }),
      ];

      const summary = buildSummaryMetrics(transactions, matchResults, exceptions);

      expect(summary.rollForward).toEqual({
        openingCount: 2,
        openingAmount: 700,
        newCount: 1,
        newAmount: 75,
        clearedCount: 1,
        clearedAmount: 200,
        writtenOffCount: 0,
        writtenOffAmount: 0,
        closingCount: 2,
        closingAmount: 575,
      });
      // Carried-forward transactions are seeded from a prior period, not this period's own
      // upload -- they must not inflate totalRecordsReviewed/bankRecords/glRecords.
      expect(summary.glRecords).toBe(0);
      expect(summary.bankRecords).toBe(2);
      expect(summary.totalRecordsReviewed).toBe(2);
    });

    it('is all-zero for a run with no carried-forward transactions', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({ id: 'bank-1', source: 'bank', amount: 10 }),
        buildTransaction({ id: 'gl-1', source: 'gl', amount: 10 }),
      ];

      const summary = buildSummaryMetrics(transactions, [], []);

      expect(summary.rollForward).toEqual({
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
      });
    });
  });
});
