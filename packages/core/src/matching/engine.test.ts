import { describe, expect, it } from 'vitest';

import type { NormalizedTransaction } from '@recon/domain';
import { defaultReconciliationConfig } from '@recon/config';
import { reconcileMatches } from './engine';

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  runId: overrides.runId ?? 'test-run',
  rawRowId: overrides.rawRowId ?? `${overrides.id ?? 'row'}-raw`,
  sourceFileId: overrides.sourceFileId ?? `${overrides.source ?? 'bank'}-file`,
  source: overrides.source ?? 'bank',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'test.xlsx',
  worksheetName: overrides.worksheetName ?? 'Sheet1',
  lineNumber: overrides.lineNumber ?? 1,
  transactionDate: overrides.transactionDate,
  postingDate: overrides.postingDate,
  transactionType: overrides.transactionType,
  checkNumber: overrides.checkNumber,
  serialNumber: overrides.serialNumber,
  referenceNumber: overrides.referenceNumber,
  description: overrides.description,
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

describe('reconcileMatches', () => {
  it('treats month-end online transfer journal entries as probable matches', () => {
    const bank = buildTransaction({
      id: 'bank-month-end',
      source: 'bank',
      lineNumber: 86,
      transactionDate: '2025-01-28',
      transactionType: 'Deposit',
      description: 'ONLINE FROM ****1061 - TRUIST ONLINE TRANSFER',
      amount: 250000,
    });
    const qbo = buildTransaction({
      id: 'qbo-month-end',
      source: 'qbo',
      lineNumber: 94,
      transactionDate: '2025-01-31',
      transactionType: 'Journal Entry',
      description: 'Money Transfers',
      normalizedComparisonTokens: ['money', 'transfers'],
      amount: 250000,
    });

    const result = reconcileMatches([bank, qbo], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('ProbableMatch');
    expect(result.probableMatches).toHaveLength(1);
  });

  it('upgrades distinctive short-context same-amount pairs to exact matches', () => {
    const bank = buildTransaction({
      id: 'bank-distinctive',
      source: 'bank',
      lineNumber: 63,
      transactionDate: '2025-01-22',
      description: 'WIRE REF# 20250122-00015886 PC NON-REPETITIVE WIRE',
      normalizedComparisonTokens: ['wire', 'ref', '20250122', '15886'],
      amount: -167967.53,
    });
    const qbo = buildTransaction({
      id: 'qbo-distinctive',
      source: 'qbo',
      lineNumber: 71,
      transactionDate: '2025-01-23',
      description: 'Vendor',
      normalizedComparisonTokens: ['vendor'],
      amount: -167967.53,
    });

    const result = reconcileMatches([bank, qbo], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('ExactMatch');
  });

  it('classifies same-amount extended-window pairs as date variances', () => {
    const bank = buildTransaction({
      id: 'bank-timing',
      source: 'bank',
      lineNumber: 2,
      transactionDate: '2025-01-02',
      description: 'RET PLAN ASCENSUS TRUST 0000PREMIER ELECTRIC ACH CORP DEBIT',
      normalizedComparisonTokens: ['ascensus', 'trust'],
      amount: -25450.76,
    });
    const qbo = buildTransaction({
      id: 'qbo-timing',
      source: 'qbo',
      lineNumber: 4,
      transactionDate: '2025-01-10',
      description: '401k Withholding',
      normalizedComparisonTokens: ['401k', 'withholding'],
      amount: -25450.76,
    });

    const result = reconcileMatches([bank, qbo], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('DateVariance');
    expect(result.matchResults[0]?.exceptionCategory).toBe('DateVariance');
  });
});