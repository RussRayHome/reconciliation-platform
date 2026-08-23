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

  it('does not classify a same-day, same-amount pair as DateVariance just because text similarity is low', () => {
    // Regression test: the "Amount + Extended Date Window Match" branch previously checked only
    // dateDifference <= timingDifferenceDays, with no lower bound requiring the date to actually
    // be outside the primary tolerance. A same-day pair whose text similarity falls below even
    // reviewSimilarityThreshold (real example: bank ACH remittance text vs. a terse GL memo like
    // "RENT OR LEASE") fell through every text-gated branch above on text grounds, not date
    // grounds, and landed here — mislabeled DateVariance despite a 0-day difference. Confirmed
    // directly against real production data (Jan 2025 Premier Electrical Staffing dataset,
    // 864 transactions): before this fix, 208/208 of that dataset's "DateVariance" exceptions
    // had a 0-day counterpart date; after, 0/1. A decoy same-amount GL transaction is included
    // below so this reduced 2-vs-3-transaction case isn't instead absorbed by the separate
    // "distinctive short-context" exact-match bypass (isDistinctiveShortContextExactMatch),
    // which requires the amount to occur at most once per side — not the behavior under test.
    const bank = buildTransaction({
      id: 'bank-same-day-low-similarity',
      source: 'bank',
      lineNumber: 13,
      transactionDate: '2025-01-02',
      description: 'ACH CORP DEBIT SIGONFILE BKMCAPITAL-927DE Premier Electrical StaCUSTOMER ID 5V32QH',
      normalizedComparisonTokens: ['ach', 'corp', 'debit', 'sigonfile', 'bkmcapital', '927de'],
      amount: -1675,
    });
    const gl = buildTransaction({
      id: 'gl-same-day-low-similarity',
      source: 'gl',
      lineNumber: 4,
      transactionDate: '2025-01-02',
      description: 'RENT OR LEASE',
      normalizedComparisonTokens: ['rent', 'lease'],
      amount: -1675,
    });
    const glDecoy = buildTransaction({
      id: 'gl-same-amount-decoy',
      source: 'gl',
      lineNumber: 400,
      transactionDate: '2025-01-30',
      description: 'RENT OR LEASE',
      normalizedComparisonTokens: ['rent', 'lease'],
      amount: -1675,
    });

    const result = reconcileMatches([bank, gl, glDecoy], defaultReconciliationConfig.matching);

    expect(result.matchResults.some((match) => match.exceptionCategory === 'DateVariance')).toBe(
      false,
    );
    expect(result.unmatchedBankTransactionIds.has('bank-same-day-low-similarity')).toBe(true);
    expect(result.unmatchedGlTransactionIds.has('gl-same-day-low-similarity')).toBe(true);
  });

  it('links a same-day, same-amount pair via the fuzzy second pass when description text shares almost no vocabulary (EDD real-data case)', () => {
    // Real production case (Jan 2025 Premier Electrical Staffing dataset): a $99.56 GL entry for
    // California's EDD and a same-day, same-amount bank ACH debit share only the token "edd" --
    // every other token differs ("CALIFORNIA"/"STATE"/"TAX"/"PAY" vs "CORP"/"DEBIT"/"EFTPMT"/
    // "EMPLOYMENT"/"DEVEL"...). Before this fix both sides fell through independently into
    // MissingFromGL/MissingFromBank, completely disconnected. The amount is distinctive on both
    // sides (each appears exactly once), so the new fuzzy pass should link them.
    const bank = buildTransaction({
      id: 'bank-edd',
      source: 'bank',
      lineNumber: 176,
      transactionDate: '2025-01-13',
      description: 'ACH CORP DEBIT EDD EFTPMT EMPLOYMENT DEVEL PREMIER ELECTRICAL STACUSTOMER ID 1994514272',
      normalizedComparisonTokens: [
        'ach', 'corp', 'debit', 'edd', 'eftpmt', 'employment', 'devel', 'premier', 'electrical',
        'stacustomer', 'id', '1994514272',
      ],
      amount: -99.56,
    });
    const gl = buildTransaction({
      id: 'gl-edd',
      source: 'gl',
      lineNumber: 185,
      transactionDate: '2025-01-13',
      description: 'CAlifornia-EDD STATE TAX PAY-CA',
      normalizedComparisonTokens: ['california', 'edd', 'state', 'tax', 'pay', 'ca'],
      amount: -99.56,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('ProbableMatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('WeakDescriptionMatch');
    // reconcileMatches's own unmatchedBankTransactionIds/unmatchedGlTransactionIds only exclude
    // EXACT matches by design (Probable matches, from either pass, stay in those sets) -- whether
    // a Probable/WeakDescriptionMatch result survives into the final exception report instead of
    // being reclassified back to MissingFromGL/MissingFromBank is exceptionClassifier.ts's
    // responsibility (advisoryReviewCategoriesExcludedFromResidualStages), tested separately in
    // exceptionClassifier.test.ts, not here.
  });

  it('links a same-day, same-amount pair via the fuzzy second pass (Georgia DOR real-data case)', () => {
    // Second real production case, same dataset: GL says "GEORGIA DEPT OF REVENUE"; the bank's
    // own ACH descriptor for the same agency says "GEORGIA ITS TAX" -- Georgia's own tax system
    // has a different name in each source. Only "georgia" overlaps.
    const bank = buildTransaction({
      id: 'bank-ga-dor',
      source: 'bank',
      lineNumber: 178,
      transactionDate: '2025-01-13',
      description: 'ACH CORP DEBIT GA TX PYMT GEORGIA ITS TAX PREMIER ELECTRICAL STACUSTOMER ID 1434650704',
      normalizedComparisonTokens: [
        'ach', 'corp', 'debit', 'ga', 'tx', 'pymt', 'georgia', 'its', 'tax', 'premier',
        'electrical', 'stacustomer', 'id', '1434650704',
      ],
      amount: -2516.43,
    });
    const gl = buildTransaction({
      id: 'gl-ga-dor',
      source: 'gl',
      lineNumber: 183,
      transactionDate: '2025-01-13',
      description: 'GEORGIA DEPT OF REVENUE STATE TAX PAY-GA',
      normalizedComparisonTokens: ['georgia', 'dept', 'of', 'revenue', 'state', 'tax', 'pay', 'ga'],
      amount: -2516.43,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.disposition).toBe('ProbableMatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('WeakDescriptionMatch');
  });

  it('does not force-match a coincidental same-amount pair when the amount is not distinctive (guardrail)', () => {
    // Two GL transactions share the same amount as one bank transaction, all with zero text
    // overlap. The amount is not distinctive on the GL side (occurs twice), so the fuzzy pass
    // must refuse to guess which one is the real counterpart, rather than force-matching either.
    const bank = buildTransaction({
      id: 'bank-ambiguous-amount',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-01-13',
      description: 'ACH CORP DEBIT SOME VENDOR REF 88221',
      normalizedComparisonTokens: ['ach', 'corp', 'debit', 'some', 'vendor', 'ref', '88221'],
      amount: -500,
    });
    const glOne = buildTransaction({
      id: 'gl-ambiguous-one',
      source: 'gl',
      lineNumber: 10,
      transactionDate: '2025-01-13',
      description: 'OFFICE SUPPLIES',
      normalizedComparisonTokens: ['office', 'supplies'],
      amount: -500,
    });
    const glTwo = buildTransaction({
      id: 'gl-ambiguous-two',
      source: 'gl',
      lineNumber: 11,
      transactionDate: '2025-01-14',
      description: 'CONSULTING FEES',
      normalizedComparisonTokens: ['consulting', 'fees'],
      amount: -500,
    });

    const result = reconcileMatches([bank, glOne, glTwo], defaultReconciliationConfig.matching);

    expect(result.matchResults.some((match) => match.exceptionCategory === 'WeakDescriptionMatch')).toBe(
      false,
    );
    expect(result.unmatchedBankTransactionIds.has('bank-ambiguous-amount')).toBe(true);
  });

  it('does not fire across a 1-day gap even with a distinctive amount and weak text (deliberately same-day only)', () => {
    // Confirms the fuzzy pass is deliberately narrower than the primary date-tolerance window: a
    // >0-day gap must be left for the primary pass's own rules (e.g. Amount + Extended Date Window
    // Match, or the classifier's LikelyMiscoding residual stage) to handle, not silently absorbed
    // here. See the inline comment on rankFuzzyCandidates's date check for why -- a real fixture
    // ('likely-miscoding' in packages/test-fixtures) depends on exactly this boundary.
    const bank = buildTransaction({
      id: 'bank-weak-1day',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-01-14',
      description: 'ACH CORP DEBIT SOME UNRELATED PROCESSOR TEXT REF 55112',
      normalizedComparisonTokens: ['ach', 'corp', 'debit', 'some', 'unrelated', 'processor', 'text', 'ref', '55112'],
      amount: -7777.12,
    });
    const gl = buildTransaction({
      id: 'gl-weak-1day',
      source: 'gl',
      lineNumber: 1,
      transactionDate: '2025-01-13',
      description: 'GENERIC VENDOR CATEGORY',
      normalizedComparisonTokens: ['generic', 'vendor', 'category'],
      amount: -7777.12,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(
      result.matchResults.some((match) => match.exceptionCategory === 'WeakDescriptionMatch'),
    ).toBe(false);
  });

  it('does not re-match a transaction the primary pass already resolved (pass-2 scoping)', () => {
    // bank-exact/gl-exact cleanly exact-match in pass 1 via strong text similarity. A second bank
    // transaction (bank-extra) happens to share bank-exact's amount but has weak text similarity
    // against whatever GL remains. Pass 2 must never reconsider bank-exact/gl-exact (already
    // consumed), and since gl-exact was pass 1's only same-amount GL row, bank-extra correctly has
    // nothing left to fuzzy-match against.
    const bankExact = buildTransaction({
      id: 'bank-exact',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-01-10',
      description: 'ACME CORP PAYMENT',
      normalizedComparisonTokens: ['acme', 'corp', 'payment'],
      amount: -3000,
    });
    const glExact = buildTransaction({
      id: 'gl-exact',
      source: 'gl',
      lineNumber: 1,
      transactionDate: '2025-01-10',
      description: 'ACME CORP PAYMENT',
      normalizedComparisonTokens: ['acme', 'corp', 'payment'],
      amount: -3000,
    });
    const bankExtra = buildTransaction({
      id: 'bank-extra',
      source: 'bank',
      lineNumber: 2,
      transactionDate: '2025-01-11',
      description: 'UNRELATED PROCESSOR TEXT',
      normalizedComparisonTokens: ['unrelated', 'processor', 'text'],
      amount: -3000,
    });

    const result = reconcileMatches(
      [bankExact, glExact, bankExtra],
      defaultReconciliationConfig.matching,
    );

    const bankExactMatches = result.matchResults.filter(
      (match) => match.bankTransactionId === 'bank-exact',
    );
    expect(bankExactMatches).toHaveLength(1);
    expect(bankExactMatches[0]?.disposition).toBe('ExactMatch');
    expect(result.matchResults.some((match) => match.bankTransactionId === 'bank-extra')).toBe(
      false,
    );
    expect(result.unmatchedBankTransactionIds.has('bank-extra')).toBe(true);
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

  it('classifies a card settlement where the bank amount is 2% lower than GL as Credit Card Service Fee Deduction', () => {
    // Amounts large enough that the dollar difference ($1,000) exceeds Wire Correspondent Fee
    // Deduction's own flat-$ tolerance (wireFeeTolerance, $500 default) -- otherwise Wire's block,
    // which runs first, would preempt this rule before the percentage check is ever reached.
    const bank = buildTransaction({
      id: 'bank-cc',
      source: 'bank',
      lineNumber: 9,
      transactionDate: '2025-06-15',
      description: 'MERCHANT SERVICES DEPOSIT ACME RETAIL',
      normalizedComparisonTokens: ['MERCHANT', 'SERVICES', 'DEPOSIT', 'ACME', 'RETAIL'],
      amount: 49000,
    });
    const gl = buildTransaction({
      id: 'gl-cc',
      source: 'gl',
      lineNumber: 10,
      transactionDate: '2025-06-15',
      description: 'Acme Retail Merchant Services Batch',
      normalizedComparisonTokens: ['ACME', 'RETAIL', 'MERCHANT', 'SERVICES', 'BATCH'],
      amount: 50000,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.ruleName).toBe('Credit Card Service Fee Deduction');
    expect(result.matchResults[0]?.disposition).toBe('AmountMismatch');
    expect(result.matchResults[0]?.exceptionCategory).toBe('AmountMismatch');
  });

  it('does not classify a 10% variance as Credit Card Service Fee Deduction (exceeds tolerance; falls through to FX Rate Variance instead)', () => {
    const bank = buildTransaction({
      id: 'bank-cc-over',
      source: 'bank',
      lineNumber: 11,
      transactionDate: '2025-06-20',
      description: 'MERCHANT SERVICES DEPOSIT BETA RETAIL',
      normalizedComparisonTokens: ['MERCHANT', 'SERVICES', 'DEPOSIT', 'BETA', 'RETAIL'],
      amount: 9000,
    });
    const gl = buildTransaction({
      id: 'gl-cc-over',
      source: 'gl',
      lineNumber: 12,
      transactionDate: '2025-06-20',
      description: 'Beta Retail Merchant Services Batch',
      normalizedComparisonTokens: ['BETA', 'RETAIL', 'MERCHANT', 'SERVICES', 'BATCH'],
      amount: 10000,
    });

    const result = reconcileMatches([bank, gl], defaultReconciliationConfig.matching);

    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.ruleName).not.toBe('Credit Card Service Fee Deduction');
    expect(result.matchResults[0]?.ruleName).toBe('FX Rate Variance');
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
