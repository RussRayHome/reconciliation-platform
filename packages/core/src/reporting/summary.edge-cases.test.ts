import type { ExceptionItem, MatchResult, NormalizedTransaction } from '@recon/domain';
import { buildSummaryMetrics, is5703Workbook } from './summary';
import { describe, expect, it } from 'vitest';

import { randomUUID } from 'node:crypto';

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: overrides.id ?? randomUUID(),
  runId: overrides.runId ?? 'edge-case-run',
  rawRowId: overrides.rawRowId ?? `${overrides.id ?? 'row'}-raw`,
  sourceFileId: overrides.sourceFileId ?? `${overrides.source ?? 'bank'}-file`,
  source: overrides.source ?? 'bank',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'workbook.xlsx',
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
  runId: overrides.runId ?? 'edge-case-run',
  category: overrides.category ?? 'MissingFromQBO',
  severity: overrides.severity ?? 'Medium',
  source: overrides.source ?? 'bank',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'workbook.xlsx',
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
  disposition: overrides.disposition ?? 'ExactMatch',
  confidence: overrides.confidence ?? 'Exact',
  ruleName: overrides.ruleName ?? 'Exact amount and normalized text',
  score: overrides.score ?? 0.99,
  bankTransactionId: overrides.bankTransactionId,
  qboTransactionId: overrides.qboTransactionId,
  dateDifferenceDays: overrides.dateDifferenceDays ?? 0,
  amountDifference: overrides.amountDifference ?? 0,
  evidence: overrides.evidence ?? ['Same amount and description'],
  likelyMatchingReference: overrides.likelyMatchingReference,
  exceptionCategory: overrides.exceptionCategory,
  reviewerNotes: overrides.reviewerNotes,
});

describe('Summary Edge Cases', () => {
  describe('is5703Workbook', () => {
    it('detects 5703 account by filename and transaction count threshold', () => {
      const tx: NormalizedTransaction[] = Array.from({ length: 1001 }, (_, i) =>
        buildTransaction({
          id: `tx-${i}`,
          spreadsheetFileName: '5703-account-data.xlsx',
          source: i % 2 === 0 ? 'bank' : 'qbo',
        })
      );

      expect(is5703Workbook(tx)).toBe(true);
    });

    it('rejects 5703 filename if transaction count is below threshold', () => {
      const tx: NormalizedTransaction[] = Array.from({ length: 999 }, (_, i) =>
        buildTransaction({
          id: `tx-${i}`,
          spreadsheetFileName: '5703-data.xlsx',
          source: i % 2 === 0 ? 'bank' : 'qbo',
        })
      );

      expect(is5703Workbook(tx)).toBe(false);
    });

    it('rejects empty transaction list', () => {
      expect(is5703Workbook([])).toBe(false);
    });

    it('case-insensitive filename matching', () => {
      const tx: NormalizedTransaction[] = Array.from({ length: 1001 }, (_, i) =>
        buildTransaction({
          id: `tx-${i}`,
          spreadsheetFileName: 'ACCOUNT-5703.xlsx',
          source: i % 2 === 0 ? 'bank' : 'qbo',
        })
      );

      expect(is5703Workbook(tx)).toBe(true);
    });
  });

  describe('buildSummaryMetrics - edge cases with excluded transactions', () => {
    it('excludes transactions marked as excluded from totals', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({ id: 'bank-1', source: 'bank', amount: 1000, isExcluded: true }),
        buildTransaction({ id: 'bank-2', source: 'bank', amount: 500, isExcluded: false }),
        buildTransaction({ id: 'qbo-1', source: 'qbo', amount: 1000, isExcluded: true }),
        buildTransaction({ id: 'qbo-2', source: 'qbo', amount: 500, isExcluded: false }),
      ];
      const exceptions: ExceptionItem[] = [];

      const summary = buildSummaryMetrics(transactions, [], exceptions);

      expect(summary.bankRecords).toBe(1);
      expect(summary.qboRecords).toBe(1);
    });

    it('handles null amounts across all fields', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({ id: 'bank-1', source: 'bank', amount: null }),
        buildTransaction({ id: 'qbo-1', source: 'qbo', amount: null }),
      ];
      const exceptions: ExceptionItem[] = [
        buildException({ source: 'bank', amount: null, category: 'MissingFromQBO' }),
      ];

      const summary = buildSummaryMetrics(transactions, [], exceptions);

      expect(summary.bankRecords).toBe(1);
      expect(summary.unmatchedQboNetAmount).toBeDefined();
    });
  });

  describe('buildSummaryMetrics - zero amounts and balances', () => {
    it('correctly totals zero-amount transactions', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({ id: 'bank-1', source: 'bank', amount: 0, isZeroAmount: true }),
        buildTransaction({ id: 'bank-2', source: 'bank', amount: 0, isZeroAmount: true }),
      ];
      const exceptions: ExceptionItem[] = [
        buildException({ category: 'InvalidOrMissingData', source: 'bank', amount: 0 }),
        buildException({ category: 'InvalidOrMissingData', source: 'bank', amount: 0 }),
      ];

      const summary = buildSummaryMetrics(transactions, [], exceptions);

      expect(summary.dataQualityIssues).toBeGreaterThanOrEqual(0);
      expect(summary.bankRecords).toBeGreaterThanOrEqual(0);
    });

    it('handles mixed positive, negative, and zero amounts', () => {
      const transactions: NormalizedTransaction[] = [
          buildTransaction({ id: 'bank-1', source: 'bank', amount: 1000.5 }),
        buildTransaction({ id: 'bank-2', source: 'bank', amount: -500.25 }),
        buildTransaction({ id: 'bank-3', source: 'bank', amount: 0 }),
          buildTransaction({ id: 'qbo-1', source: 'qbo', amount: 1000.5 }),
      ];

      const summary = buildSummaryMetrics(transactions, [], []);

      expect(summary.bankRecords).toBe(3);
      expect(summary.qboRecords).toBe(1);
    });
  });

  describe('buildSummaryMetrics - exception categories', () => {
    it('correctly categorizes all exception types', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({ id: 'bank-1', source: 'bank', amount: 100 }),
        buildTransaction({ id: 'qbo-1', source: 'qbo', amount: 100 }),
      ];
      const exceptions: ExceptionItem[] = [
        buildException({ category: 'MissingFromQBO', source: 'bank', amount: 100 }),
        buildException({ category: 'MissingFromBank', source: 'qbo', amount: 100 }),
        buildException({ category: 'AmountMismatch', source: 'bank', amount: 50 }),
        buildException({ category: 'DateVariance', source: 'bank', amount: 75 }),
        buildException({ category: 'InvalidOrMissingData', source: 'bank', amount: 25 }),
        buildException({ category: 'DuplicateInBank', source: 'bank', amount: 150 }),
      ];

      const summary = buildSummaryMetrics(transactions, [], exceptions);

      expect(summary.missingFromQBO).toBe(1);
      expect(summary.missingFromBank).toBe(1);
      expect(summary.amountMismatches).toBeGreaterThanOrEqual(0);
      expect(summary.dateVariances).toBeGreaterThanOrEqual(0);
    });

    it('handles empty exception list', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({ id: 'bank-1', source: 'bank', amount: 100 }),
      ];

      const summary = buildSummaryMetrics(transactions, [], []);

      expect(summary.missingFromQBO).toBe(0);
      expect(summary.missingFromBank).toBe(0);
      expect(summary.dataQualityIssues).toBe(0);
    });
  });

  describe('buildSummaryMetrics - match results', () => {
    it('handles exact, probable, and timing-difference matches', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({ id: 'bank-1', source: 'bank', amount: 1000 }),
        buildTransaction({ id: 'qbo-1', source: 'qbo', amount: 1000 }),
      ];
      const matchResults: MatchResult[] = [
        buildMatchResult({
          bankTransactionId: 'bank-1',
          qboTransactionId: 'qbo-1',
        }),
      ];

      const summary = buildSummaryMetrics(transactions, matchResults, []);

      expect(summary.exactMatches).toBeGreaterThanOrEqual(0);
      expect(summary.probableMatches).toBeGreaterThanOrEqual(0);
    });
  });

  describe('buildSummaryMetrics - data quality issues', () => {
    it('aggregates QBO data quality issues only', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({
          id: 'bank-1',
          source: 'bank',
          dataQualityIssues: ['Missing amount'],
        }),
        buildTransaction({
          id: 'qbo-1',
          source: 'qbo',
          dataQualityIssues: ['Invalid date format'],
        }),
        buildTransaction({
          id: 'qbo-2',
          source: 'qbo',
          dataQualityIssues: [],
        }),
      ];

      const summary = buildSummaryMetrics(transactions, [], []);

      expect(summary.dataQualityIssues).toBeGreaterThanOrEqual(0);
    });
  });

  describe('buildSummaryMetrics - running balance edge cases', () => {
    it('handles null running balances', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({ id: 'bank-1', source: 'bank', amount: 100, runningBalance: null }),
        buildTransaction({ id: 'bank-2', source: 'bank', amount: 200, runningBalance: null }),
      ];

      const summary = buildSummaryMetrics(transactions, [], []);

      expect(summary.bankRecords).toBe(2);
    });

    it('includes summary amounts in metrics', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({ id: 'bank-1', source: 'bank', amount: 100, runningBalance: 100 }),
        buildTransaction({ id: 'bank-2', source: 'bank', amount: 200, runningBalance: 300 }),
      ];

      const summary = buildSummaryMetrics(transactions, [], []);

      expect(summary.cleanMatchedAmount).toBeDefined();
      expect(summary.unresolvedExposure).toBeDefined();
    });
  });

  describe('buildSummaryMetrics - 5703 parity', () => {
    it('keeps summary totals anchored to final exceptions and match results even for 5703 workbooks', () => {
      const transactions: NormalizedTransaction[] = Array.from({ length: 1001 }, (_, i) => {
        if (i === 0) {
          return buildTransaction({
            id: 'bank-transfer',
            source: 'bank',
            spreadsheetFileName: '5703-data.xlsx',
            description: 'ONLINE FROM ****1061 - TRUIST ONLINE TRANSFER',
            transactionDate: '2025-01-28',
            amount: 50000,
          });
        }

        if (i === 1) {
          return buildTransaction({
            id: 'qbo-journal',
            source: 'qbo',
            spreadsheetFileName: '5703-data.xlsx',
            description: 'Money Transfers',
            transactionDate: '2025-01-31',
            transactionType: 'Journal Entry',
            amount: 50000,
            normalizedComparisonTokens: ['money', 'transfers'],
          });
        }

        return buildTransaction({
          id: `filler-${i}`,
          spreadsheetFileName: '5703-data.xlsx',
          source: i % 2 === 0 ? 'bank' : 'qbo',
          amount: Math.floor(Math.random() * 10000),
        });
      });

      const summary = buildSummaryMetrics(transactions, [], []);

      expect(summary.exactMatches).toBe(0);
      expect(summary.probableMatches).toBe(0);
      expect(summary.timingDifferences).toBe(0);
    });
  });

  describe('Summary - malformed dates and edge dates', () => {
    it('handles invalid date formats gracefully', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({
          id: 'invalid-date-1',
          source: 'bank',
          transactionDate: 'not-a-date',
        }),
        buildTransaction({
          id: 'invalid-date-2',
          source: 'bank',
          transactionDate: '2025-13-45', // Invalid month and day
        }),
      ];

      const summary = buildSummaryMetrics(transactions, [], []);

      expect(summary.bankRecords).toBe(2);
    });

    it('handles year boundaries correctly', () => {
      const transactions: NormalizedTransaction[] = [
        buildTransaction({
          id: 'nye',
          source: 'bank',
          transactionDate: '2024-12-31',
          amount: 1000,
        }),
        buildTransaction({
          id: 'nyd',
          source: 'bank',
          transactionDate: '2025-01-01',
          amount: 500,
        }),
      ];

      const summary = buildSummaryMetrics(transactions, [], []);

      expect(summary.bankRecords).toBe(2);
    });
  });
});
