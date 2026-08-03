import { describe, expect, it } from 'vitest';

import type { NormalizedTransaction, PayeeAlias } from '@recon/domain';
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
    const gl = buildTransaction({
      id: 'gl-month-end',
      source: 'gl',
      lineNumber: 94,
      transactionDate: '2025-01-31',
      transactionType: 'Journal Entry',
      description: 'Money Transfers',
      normalizedComparisonTokens: ['money', 'transfers'],
      amount: 250000,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

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
    const gl = buildTransaction({
      id: 'gl-distinctive',
      source: 'gl',
      lineNumber: 71,
      transactionDate: '2025-01-23',
      description: 'Vendor',
      normalizedComparisonTokens: ['vendor'],
      amount: -167967.53,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

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
    const gl = buildTransaction({
      id: 'gl-timing',
      source: 'gl',
      lineNumber: 4,
      transactionDate: '2025-01-10',
      description: '401k Withholding',
      normalizedComparisonTokens: ['401k', 'withholding'],
      amount: -25450.76,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

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
    const gl = buildTransaction({
      id: 'gl-check-var',
      source: 'gl',
      lineNumber: 2,
      transactionDate: '2025-02-10',
      amount: -500,
      normalizedComparisonTokens: ['VENDOR', 'SUPPLIES'],
      normalizedReferenceTokens: ['1002'],
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

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
    const gl = buildTransaction({
      id: 'gl-ref-var',
      source: 'gl',
      lineNumber: 2,
      transactionDate: '2025-02-12',
      amount: -750,
      referenceNumber: 'REF-002',
      normalizedComparisonTokens: ['OFFICE', 'DEPOT'],
      normalizedReferenceTokens: ['REF', '002'],
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

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
    const gl = buildTransaction({
      id: 'gl-desc-var',
      source: 'gl',
      lineNumber: 2,
      transactionDate: '2025-03-06',
      amount: -300,
      normalizedComparisonTokens: ['ACME', 'OFFICE', 'SUPPLY', 'DEPOT'],
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

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
    const gl = buildTransaction({
      id: 'gl-amt-mismatch',
      source: 'gl',
      lineNumber: 2,
      transactionDate: '2025-03-10',
      amount: -150,
      normalizedComparisonTokens: ['OFFICE', 'DEPOT', 'SUPPLIES'],
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('AmountMismatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('AmountMismatch');
  });

  it('flags a bank transaction as AmbiguousReview when two GL candidates score equally well', () => {
    // bank has 1 token; each GL has 2 tokens with 1 shared → textSimilarity = 2/3 ≈ 0.667
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
    const gl1 = buildTransaction({
      id: 'gl-ambig-1',
      source: 'gl',
      lineNumber: 2,
      transactionDate: '2025-01-10',
      amount: -100,
      normalizedComparisonTokens: ['ACME', 'OFFICE'],
    });
    const gl2 = buildTransaction({
      id: 'gl-ambig-2',
      source: 'gl',
      lineNumber: 3,
      transactionDate: '2025-01-10',
      amount: -100,
      normalizedComparisonTokens: ['ACME', 'SUPPLY'],
    });

    const result = reconcileMatches([bank, gl1, gl2], defaultReconciliationConfig.matching);

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
    const gl = buildTransaction({
      id: 'gl-original',
      source: 'gl',
      lineNumber: 1,
      transactionDate: '2025-03-01',
      amount: -200,
      normalizedComparisonTokens: ['VENDOR', 'PAYMENT'],
    });

    const result = reconcileMatches([bank1, bank2, gl], defaultReconciliationConfig.matching);

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
    const gl = buildTransaction({
      id: 'gl-active',
      source: 'gl',
      lineNumber: 1,
      transactionDate: '2025-01-01',
      amount: -100,
      normalizedComparisonTokens: ['ACME'],
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(0);
    expect(result.unmatchedBankTransactionIds.has('bank-excl')).toBe(false);
    expect(result.unmatchedGlTransactionIds.has('gl-active')).toBe(true);
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
    const gl = buildTransaction({
      id: 'gl-clean',
      source: 'gl',
      lineNumber: 1,
      transactionDate: '2025-01-01',
      amount: -100,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(0);
    expect(result.unmatchedGlTransactionIds.has('gl-clean')).toBe(true);
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
    const glAlpha = buildTransaction({
      id: 'gl-grouped-alpha',
      source: 'gl',
      lineNumber: 20,
      transactionDate: '2025-04-01',
      transactionType: 'Deposit',
      description: 'Card receipt alpha',
      amount: 100,
    });
    const glBeta = buildTransaction({
      id: 'gl-grouped-beta',
      source: 'gl',
      lineNumber: 21,
      transactionDate: '2025-04-02',
      transactionType: 'Deposit',
      description: 'Card receipt beta',
      amount: 200,
    });

    const result = reconcileMatches([bank, glAlpha, glBeta], defaultReconciliationConfig.matching);

    expect(result.groupedMatchResults).toHaveLength(1);
    expect(result.groupedMatchResults[0]?.disposition).toBe('GroupedReviewMatch');
    expect(result.groupedMatchResults[0]?.category).toBe('DepositGroupingIssue');
    expect(result.groupedMatchResults[0]?.bankTransactionIds).toEqual(['bank-grouped']);
    expect(result.groupedMatchResults[0]?.glTransactionIds).toEqual([
      'gl-grouped-alpha',
      'gl-grouped-beta',
    ]);
  });

  it('emits CheckNumberMismatch when check numbers match but amounts differ', () => {
    const bank = buildTransaction({
      id: 'bank-check-amt',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-04-10',
      checkNumber: '1234',
      normalizedComparisonTokens: ['ACME', 'SUPPLIES'],
      normalizedReferenceTokens: ['1234'],
      amount: -525,
    });
    const gl = buildTransaction({
      id: 'gl-check-amt',
      source: 'gl',
      lineNumber: 2,
      transactionDate: '2025-04-10',
      checkNumber: '1234',
      normalizedComparisonTokens: ['ACME', 'SUPPLIES'],
      normalizedReferenceTokens: ['1234'],
      amount: -500,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.ruleName).toBe('Check Number Amount Mismatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('CheckNumberMismatch');
    expect(result.matchResults[0]?.disposition).toBe('AmountMismatch');
  });

  it('emits DateVariance with check context when check numbers match but posting dates diverge', () => {
    const bank = buildTransaction({
      id: 'bank-check-date',
      source: 'bank',
      lineNumber: 3,
      transactionDate: '2025-04-01',
      checkNumber: '5678',
      normalizedComparisonTokens: ['VENDOR'],
      normalizedReferenceTokens: ['5678'],
      amount: -750,
    });
    const gl = buildTransaction({
      id: 'gl-check-date',
      source: 'gl',
      lineNumber: 4,
      transactionDate: '2025-04-12',
      checkNumber: '5678',
      normalizedComparisonTokens: ['VENDOR'],
      normalizedReferenceTokens: ['5678'],
      amount: -750,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.ruleName).toBe('Check Number Date Variance');
    expect(result.matchResults[0]?.disposition).toBe('DateVariance');
  });

  it('applies Historical Pattern Match when a payee alias boosts text similarity above threshold', () => {
    const alias: PayeeAlias = {
      id: crypto.randomUUID(),
      bankPattern: 'AMZN MKTP US',
      canonicalPayeeName: 'Amazon',
      normalizedTokens: ['AMZN', 'MKTP'],
      sourceDirection: 'bank_to_gl',
      matchConfidence: 1.0,
      isActive: true,
    };

    const bank = buildTransaction({
      id: 'bank-amazon',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-03-10',
      description: 'AMZN MKTP US*AB12345',
      normalizedComparisonTokens: ['AMZN', 'MKTP', 'AB12345'],
      amount: -49.99,
    });
    const gl = buildTransaction({
      id: 'gl-amazon',
      source: 'gl',
      lineNumber: 2,
      transactionDate: '2025-03-10',
      description: 'Amazon',
      normalizedComparisonTokens: ['AMAZON'],
      amount: -49.99,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching, [alias]);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.ruleName).toBe('Historical Pattern Match');
    expect(result.matchResults[0]?.disposition).toBe('ExactMatch');
    expect(result.unmatchedBankTransactionIds.size).toBe(0);
    expect(result.unmatchedGlTransactionIds.size).toBe(0);
  });

  it('classifies a wire where bank received less than GL recorded as Wire Correspondent Fee Deduction', () => {
    const bank = buildTransaction({
      id: 'bank-wire',
      source: 'bank',
      lineNumber: 5,
      transactionDate: '2025-06-01',
      description: 'WIRE TRANSFER ACB INTERNATIONAL BANK',
      normalizedComparisonTokens: ['WIRE', 'TRANSFER', 'ACB', 'INTERNATIONAL'],
      amount: 9850,
    });
    const gl = buildTransaction({
      id: 'gl-wire',
      source: 'gl',
      lineNumber: 6,
      transactionDate: '2025-06-01',
      description: 'ACB International Invoice Wire',
      normalizedComparisonTokens: ['WIRE', 'ACB', 'INTERNATIONAL', 'INVOICE'],
      amount: 10000,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.ruleName).toBe('Wire Correspondent Fee Deduction');
    expect(result.matchResults[0]?.disposition).toBe('AmountMismatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('AmountMismatch');
  });

  it('classifies a cross-currency transaction where amounts differ by FX rate as FX Rate Variance', () => {
    const bank = buildTransaction({
      id: 'bank-fx',
      source: 'bank',
      lineNumber: 7,
      transactionDate: '2025-06-10',
      description: 'GLOBAL SUPPLIER PAYMENT EUR',
      normalizedComparisonTokens: ['GLOBAL', 'SUPPLIER', 'PAYMENT', 'EUR'],
      amount: -5800,
    });
    const gl = buildTransaction({
      id: 'gl-fx',
      source: 'gl',
      lineNumber: 8,
      transactionDate: '2025-06-10',
      description: 'Global Supplier Invoice EUR',
      normalizedComparisonTokens: ['GLOBAL', 'SUPPLIER', 'INVOICE', 'EUR'],
      amount: -5000,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.ruleName).toBe('FX Rate Variance');
    expect(result.matchResults[0]?.disposition).toBe('AmountMismatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('AmountMismatch');
  });

  it('ignores inactive aliases', () => {
    const alias: PayeeAlias = {
      id: crypto.randomUUID(),
      bankPattern: 'AMZN MKTP US',
      canonicalPayeeName: 'Amazon',
      normalizedTokens: ['AMZN', 'MKTP'],
      sourceDirection: 'bank_to_gl',
      matchConfidence: 1.0,
      isActive: false,
    };

    const bank = buildTransaction({
      id: 'bank-amazon-inactive',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-03-10',
      normalizedComparisonTokens: ['AMZN', 'MKTP', 'AB12345'],
      amount: -49.99,
    });
    const gl = buildTransaction({
      id: 'gl-amazon-inactive',
      source: 'gl',
      lineNumber: 2,
      transactionDate: '2025-03-10',
      normalizedComparisonTokens: ['AMAZON'],
      amount: -49.99,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching, [alias]);

    expect(result.matchResults.some((m) => m.ruleName === 'Historical Pattern Match')).toBe(false);
  });
});
