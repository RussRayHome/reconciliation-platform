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
  likelyMatchingReference: overrides.likelyMatchingReference,
  reviewerNotes: overrides.reviewerNotes,
  matchConfidence: overrides.matchConfidence,
  normalizedComparisonTokens: overrides.normalizedComparisonTokens ?? [],
  relatedTransactionIds: overrides.relatedTransactionIds ?? [],
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
    expect(summary.qboRecords).toBe(1);
    expect(summary.dataQualityIssues).toBe(1);
    expect(summary.unmatchedItems).toBe(3);
    expect(summary.missingFromQBO).toBe(1);
    expect(summary.missingFromBank).toBe(1);
  });
});