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
});

const buildException = (overrides: Partial<ExceptionItem>): ExceptionItem => ({
  id: overrides.id ?? randomUUID(),
  runId: overrides.runId ?? 'summary-run',
  category: overrides.category ?? 'MissingFromQBO',
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
  reason: overrides.reason,
  score: overrides.score ?? 0.82,
  bankTransactionId: overrides.bankTransactionId,
  qboTransactionId: overrides.qboTransactionId,
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
      buildTransaction({ id: 'bank-dq', source: 'bank', amount: 0, dataQualityIssues: ['Zero amount transaction requires review.'] }),
      buildTransaction({ id: 'qbo-valid', source: 'qbo', amount: 10 }),
      buildTransaction({ id: 'qbo-dq', source: 'qbo', amount: 0, dataQualityIssues: ['Amount is missing or malformed.'] }),
    ];
    const matchResults: MatchResult[] = [];
    const exceptions: ExceptionItem[] = [
      buildException({ category: 'InvalidOrMissingData', source: 'bank', amount: 0 }),
      buildException({ category: 'InvalidOrMissingData', source: 'qbo', amount: 0, lineNumber: 2 }),
      buildException({ category: 'MissingFromQBO', source: 'bank', amount: 10, lineNumber: 3 }),
      buildException({ category: 'MissingFromBank', source: 'qbo', amount: 10, lineNumber: 4 }),
    ];

    const summary = buildSummaryMetrics(transactions, matchResults, exceptions);

    expect(summary.bankRecords).toBe(2);
    expect(summary.qboRecords).toBe(2);
    expect(summary.dataQualityIssues).toBe(2);
    expect(summary.unmatchedItems).toBe(4);
    expect(summary.missingFromQBO).toBe(1);
    expect(summary.missingFromBank).toBe(1);
  });

  it('derives date variance and timing difference counts from final classified exceptions', () => {
    const transactions: NormalizedTransaction[] = [
      buildTransaction({ id: 'bank-1', source: 'bank', amount: -500, lineNumber: 5 }),
      buildTransaction({ id: 'qbo-1', source: 'qbo', amount: -500, lineNumber: 8 }),
      buildTransaction({ id: 'bank-2', source: 'bank', amount: -300, lineNumber: 10 }),
      buildTransaction({ id: 'qbo-2', source: 'qbo', amount: -300, lineNumber: 12 }),
    ];
    const matchResults: MatchResult[] = [
      buildMatchResult({
        bankTransactionId: 'bank-1',
        qboTransactionId: 'qbo-1',
        disposition: 'DateVariance',
        exceptionCategory: 'DateVariance',
      }),
      buildMatchResult({
        id: 'timing-result',
        bankTransactionId: 'bank-2',
        qboTransactionId: 'qbo-2',
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
        relatedTransactionIds: ['bank-1', 'qbo-1'],
      }),
      buildException({
        id: 'miscoding-qbo',
        category: 'LikelyMiscoding',
        source: 'qbo',
        amount: -500,
        lineNumber: 8,
        relatedTransactionIds: ['bank-1', 'qbo-1'],
      }),
      buildException({
        id: 'timing-bank',
        category: 'TimingDifference',
        source: 'bank',
        amount: -300,
        lineNumber: 10,
        relatedTransactionIds: ['bank-2', 'qbo-2'],
      }),
      buildException({
        id: 'timing-qbo',
        category: 'TimingDifference',
        source: 'qbo',
        amount: -300,
        lineNumber: 12,
        relatedTransactionIds: ['bank-2', 'qbo-2'],
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
      buildTransaction({ id: 'qbo-1', source: 'qbo', amount: 410, lineNumber: 7 }),
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
        source: 'qbo',
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
});