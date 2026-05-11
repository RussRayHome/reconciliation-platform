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

  it('produces a probable match with CheckNumberMismatch when check numbers differ but amounts and text align', () => {
    const bank = buildTransaction({
      id: 'bank-check-var',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-02-10',
      amount: -500,
      checkNumber: '1001',
      normalizedComparisonTokens: ['VENDOR', 'SUPPLIES'],
      normalizedReferenceTokens: ['1001'],
    });
    const qbo = buildTransaction({
      id: 'qbo-check-var',
      source: 'qbo',
      lineNumber: 2,
      transactionDate: '2025-02-10',
      amount: -500,
      normalizedComparisonTokens: ['VENDOR', 'SUPPLIES'],
      normalizedReferenceTokens: ['1002'],
    });

    const result = reconcileMatches([bank, qbo], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('ProbableMatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('CheckNumberMismatch');
  });

  it('produces a ReferenceNumberMismatch category when reference (not check) numbers differ', () => {
    const bank = buildTransaction({
      id: 'bank-ref-var',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-02-12',
      amount: -750,
      referenceNumber: 'REF-001',
      normalizedComparisonTokens: ['OFFICE', 'DEPOT'],
      normalizedReferenceTokens: ['REF', '001'],
    });
    const qbo = buildTransaction({
      id: 'qbo-ref-var',
      source: 'qbo',
      lineNumber: 2,
      transactionDate: '2025-02-12',
      amount: -750,
      referenceNumber: 'REF-002',
      normalizedComparisonTokens: ['OFFICE', 'DEPOT'],
      normalizedReferenceTokens: ['REF', '002'],
    });

    const result = reconcileMatches([bank, qbo], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('ProbableMatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('ReferenceNumberMismatch');
  });

  it('produces DescriptionMerchantVariance when text similarity falls in the grey zone between thresholds', () => {
    // textSimilarity(['ACME', 'OFFICE'], ['ACME', 'OFFICE', 'SUPPLY', 'DEPOT']) = 2*2/(2+4) = 0.667
    // falls in [reviewSimilarityThreshold(0.4), textSimilarityThreshold(0.7))
    const bank = buildTransaction({
      id: 'bank-desc-var',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-03-05',
      amount: -300,
      normalizedComparisonTokens: ['ACME', 'OFFICE'],
    });
    const qbo = buildTransaction({
      id: 'qbo-desc-var',
      source: 'qbo',
      lineNumber: 2,
      transactionDate: '2025-03-06',
      amount: -300,
      normalizedComparisonTokens: ['ACME', 'OFFICE', 'SUPPLY', 'DEPOT'],
    });

    const result = reconcileMatches([bank, qbo], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('ProbableMatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('DescriptionMerchantVariance');
  });

  it('produces AmountMismatch when description aligns but recorded amounts differ beyond tolerance', () => {
    // textSimilarity(['OFFICE', 'DEPOT'], ['OFFICE', 'DEPOT', 'SUPPLIES']) = 2*2/(2+3) = 0.8 >= 0.65
    const bank = buildTransaction({
      id: 'bank-amt-mismatch',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-03-10',
      amount: -100,
      normalizedComparisonTokens: ['OFFICE', 'DEPOT'],
    });
    const qbo = buildTransaction({
      id: 'qbo-amt-mismatch',
      source: 'qbo',
      lineNumber: 2,
      transactionDate: '2025-03-10',
      amount: -150,
      normalizedComparisonTokens: ['OFFICE', 'DEPOT', 'SUPPLIES'],
    });

    const result = reconcileMatches([bank, qbo], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('AmountMismatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('AmountMismatch');
  });

  it('flags a bank transaction as AmbiguousReview when two QBO candidates score equally well', () => {
    // bank has 1 token; each QBO has 2 tokens with 1 shared → textSimilarity = 2/3 ≈ 0.667
    // 0.667 is in [reviewSimilarityThreshold(0.4), textSimilarityThreshold(0.7)) → Rule 5 fires
    // both candidates score 0.72 (< 0.95), within 0.1 of each other → AmbiguousReview
    const bank = buildTransaction({
      id: 'bank-ambig',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-01-10',
      amount: -100,
      normalizedComparisonTokens: ['ACME'],
    });
    const qbo1 = buildTransaction({
      id: 'qbo-ambig-1',
      source: 'qbo',
      lineNumber: 2,
      transactionDate: '2025-01-10',
      amount: -100,
      normalizedComparisonTokens: ['ACME', 'OFFICE'],
    });
    const qbo2 = buildTransaction({
      id: 'qbo-ambig-2',
      source: 'qbo',
      lineNumber: 3,
      transactionDate: '2025-01-10',
      amount: -100,
      normalizedComparisonTokens: ['ACME', 'SUPPLY'],
    });

    const result = reconcileMatches([bank, qbo1, qbo2], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('AmbiguousReview');
    expect(result.matchResults[0]?.exceptionCategory).toBe('AmbiguousMatchRequiringReview');
    expect(result.probableMatches).toHaveLength(1);
  });

  it('detects duplicate bank transactions and excludes the later-line duplicate from matching', () => {
    const bank1 = buildTransaction({
      id: 'bank-dup-1',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-03-01',
      amount: -200,
      normalizedComparisonTokens: ['VENDOR', 'PAYMENT'],
    });
    const bank2 = buildTransaction({
      id: 'bank-dup-2',
      source: 'bank',
      lineNumber: 2,
      transactionDate: '2025-03-01',
      amount: -200,
      normalizedComparisonTokens: ['VENDOR', 'PAYMENT'],
    });
    const qbo = buildTransaction({
      id: 'qbo-original',
      source: 'qbo',
      lineNumber: 1,
      transactionDate: '2025-03-01',
      amount: -200,
      normalizedComparisonTokens: ['VENDOR', 'PAYMENT'],
    });

    const result = reconcileMatches([bank1, bank2, qbo], defaultReconciliationConfig.matching);

    expect(result.duplicateTransactionIds.size).toBe(1);
    expect(result.duplicateTransactionIds.has('bank-dup-2')).toBe(true);
    expect(result.matchResults.some((r) => r.bankTransactionId === 'bank-dup-1')).toBe(true);
    expect(result.matchResults.some((r) => r.bankTransactionId === 'bank-dup-2')).toBe(false);
  });

  it('detects duplicates via exact reference number match even when descriptions differ', () => {
    const bank1 = buildTransaction({
      id: 'bank-ref-dup-1',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-03-01',
      amount: -500,
      normalizedComparisonTokens: ['ALPHA', 'CORP'],
      normalizedReferenceTokens: ['REF', '999'],
    });
    const bank2 = buildTransaction({
      id: 'bank-ref-dup-2',
      source: 'bank',
      lineNumber: 2,
      transactionDate: '2025-03-02',
      amount: -500,
      normalizedComparisonTokens: ['BETA', 'INC'],
      normalizedReferenceTokens: ['REF', '999'],
    });

    const result = reconcileMatches([bank1, bank2], defaultReconciliationConfig.matching);

    expect(result.duplicateTransactionIds.has('bank-ref-dup-2')).toBe(true);
  });

  it('omits excluded transactions from match results and unmatched sets', () => {
    const bank = buildTransaction({
      id: 'bank-excl',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-01-01',
      amount: -100,
      normalizedComparisonTokens: ['ACME'],
      isExcluded: true,
    });
    const qbo = buildTransaction({
      id: 'qbo-active',
      source: 'qbo',
      lineNumber: 1,
      transactionDate: '2025-01-01',
      amount: -100,
      normalizedComparisonTokens: ['ACME'],
    });

    const result = reconcileMatches([bank, qbo], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(0);
    expect(result.unmatchedBankTransactionIds.has('bank-excl')).toBe(false);
    expect(result.unmatchedQboTransactionIds.has('qbo-active')).toBe(true);
  });

  it('omits transactions with data quality issues from matching candidates', () => {
    const bank = buildTransaction({
      id: 'bank-dq',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-01-01',
      amount: -100,
      dataQualityIssues: ['Amount is missing or malformed.'],
    });
    const qbo = buildTransaction({
      id: 'qbo-clean',
      source: 'qbo',
      lineNumber: 1,
      transactionDate: '2025-01-01',
      amount: -100,
    });

    const result = reconcileMatches([bank, qbo], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(0);
    expect(result.unmatchedQboTransactionIds.has('qbo-clean')).toBe(true);
  });

  it('emits grouped review match results for balanced one-to-many grouped candidates', () => {
    const bank = buildTransaction({
      id: 'bank-grouped',
      source: 'bank',
      lineNumber: 10,
      transactionDate: '2025-04-01',
      transactionType: 'Deposit',
      description: 'CARD SETTLEMENT BATCH',
      amount: 300,
    });
    const qboAlpha = buildTransaction({
      id: 'qbo-grouped-alpha',
      source: 'qbo',
      lineNumber: 20,
      transactionDate: '2025-04-01',
      transactionType: 'Deposit',
      description: 'Card receipt alpha',
      amount: 100,
    });
    const qboBeta = buildTransaction({
      id: 'qbo-grouped-beta',
      source: 'qbo',
      lineNumber: 21,
      transactionDate: '2025-04-02',
      transactionType: 'Deposit',
      description: 'Card receipt beta',
      amount: 200,
    });

    const result = reconcileMatches([bank, qboAlpha, qboBeta], defaultReconciliationConfig.matching);

    expect(result.groupedMatchResults).toHaveLength(1);
    expect(result.groupedMatchResults[0]?.disposition).toBe('GroupedReviewMatch');
    expect(result.groupedMatchResults[0]?.category).toBe('DepositGroupingIssue');
    expect(result.groupedMatchResults[0]?.bankTransactionIds).toEqual(['bank-grouped']);
    expect(result.groupedMatchResults[0]?.qboTransactionIds).toEqual([
      'qbo-grouped-alpha',
      'qbo-grouped-beta',
    ]);
  });
});