import { describe, expect, it } from 'vitest';

import type { NormalizedTransaction } from '@recon/domain';
import { defaultReconciliationConfig } from '@recon/config';
import { reserveGroupedTransactionIds } from './groupedReservations';

const matching = defaultReconciliationConfig.matching;

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  runId: overrides.runId ?? 'grouped-category-test-run',
  rawRowId: overrides.rawRowId ?? `${overrides.id ?? 'row'}-raw`,
  sourceFileId: overrides.sourceFileId ?? `${overrides.source ?? 'bank'}-file`,
  source: overrides.source ?? 'bank',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'grouped-category-test.xlsx',
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
});

const categoriesOf = (bank: NormalizedTransaction[], gl: NormalizedTransaction[]): string[] =>
  reserveGroupedTransactionIds(bank, gl, matching).selectedCandidates.map(
    (candidate) => candidate.category,
  );

/**
 * Covers the four grouped-reservation categories that had no direct tests: grouped deposits,
 * split/combine, fee netting, and partial payments. Each builder gates on amount tolerance, sign
 * agreement, a timing window, and (for fee netting and partial payments) a description keyword —
 * a false positive here silently reserves transactions away from one-to-one matching, so the
 * rejection paths matter as much as the happy ones.
 */
describe('grouped reservation categories', () => {
  describe('DepositGroupingIssue', () => {
    const bankDeposit = buildTransaction({
      id: 'bank-deposit',
      source: 'bank',
      transactionDate: '2025-10-01',
      transactionType: 'Deposit',
      amount: 500,
    });
    const glCredits = [
      buildTransaction({
        id: 'gl-credit-a',
        source: 'gl',
        transactionDate: '2025-10-01',
        transactionType: 'Deposit',
        amount: 200,
      }),
      buildTransaction({
        id: 'gl-credit-b',
        source: 'gl',
        transactionDate: '2025-10-02',
        transactionType: 'Deposit',
        amount: 300,
      }),
    ];

    it('reserves one bank deposit against the GL credits that sum to it', () => {
      const result = reserveGroupedTransactionIds([bankDeposit], glCredits, matching);

      expect(result.selectedCandidates).toHaveLength(1);
      expect(result.selectedCandidates[0]).toMatchObject({
        category: 'DepositGroupingIssue',
        ruleId: 'grouped-deposit-reserved',
        ruleName: 'Grouped Deposit Candidate',
      });
    });

    it('reserves every participating transaction id on both sides', () => {
      const result = reserveGroupedTransactionIds([bankDeposit], glCredits, matching);

      expect([...result.reservedBankTransactionIds]).toEqual(['bank-deposit']);
      expect([...result.reservedGlTransactionIds].sort()).toEqual(['gl-credit-a', 'gl-credit-b']);
    });

    it('reports the maximum cross-source date difference', () => {
      const result = reserveGroupedTransactionIds([bankDeposit], glCredits, matching);

      expect(result.selectedCandidates[0]?.dateDifferenceDays).toBe(1);
    });

    it('rejects a group whose totals differ by more than the amount tolerance', () => {
      const mismatched = [
        glCredits[0]!,
        buildTransaction({ ...glCredits[1]!, id: 'gl-credit-off', amount: 300.5 }),
      ];

      expect(categoriesOf([bankDeposit], mismatched)).toEqual([]);
    });

    it('accepts a group whose totals differ by less than the amount tolerance', () => {
      const withinTolerance = [
        glCredits[0]!,
        buildTransaction({ ...glCredits[1]!, id: 'gl-credit-near', amount: 300.005 }),
      ];

      expect(categoriesOf([bankDeposit], withinTolerance)).toEqual(['DepositGroupingIssue']);
    });

    it('rejects a group whose date spread exceeds the timing window', () => {
      const farApart = [
        glCredits[0]!,
        buildTransaction({ ...glCredits[1]!, id: 'gl-credit-late', transactionDate: '2025-12-01' }),
      ];

      expect(categoriesOf([bankDeposit], farApart)).toEqual([]);
    });

    it('rejects a one-to-one pairing, which is the flat matcher’s job', () => {
      const single = buildTransaction({
        id: 'gl-single',
        source: 'gl',
        transactionDate: '2025-10-01',
        transactionType: 'Deposit',
        amount: 500,
      });

      expect(categoriesOf([bankDeposit], [single])).toEqual([]);
    });

    it('rejects a group with no counterpart on one side', () => {
      expect(categoriesOf([bankDeposit], [])).toEqual([]);
      expect(categoriesOf([], glCredits)).toEqual([]);
    });

    it('falls back to the posting date when no transaction date is present', () => {
      const bankByPostingDate = buildTransaction({
        id: 'bank-posting',
        source: 'bank',
        postingDate: '2025-10-01',
        transactionType: 'Deposit',
        amount: 500,
      });

      expect(categoriesOf([bankByPostingDate], glCredits)).toEqual(['DepositGroupingIssue']);
    });

    it('rejects a group when neither date field is populated', () => {
      const undated = buildTransaction({
        id: 'bank-undated',
        source: 'bank',
        transactionType: 'Deposit',
        amount: 500,
      });

      expect(categoriesOf([undated], glCredits)).toEqual([]);
    });
  });

  describe('LikelySplitCombineIssue', () => {
    it('classifies a balanced negative grouping as split/combine rather than a deposit', () => {
      const bankDebit = buildTransaction({
        id: 'bank-debit',
        source: 'bank',
        transactionDate: '2025-10-01',
        transactionType: 'Expense',
        amount: -450,
      });
      const glDebits = [
        buildTransaction({
          id: 'gl-debit-a',
          source: 'gl',
          transactionDate: '2025-10-01',
          transactionType: 'Expense',
          amount: -200,
        }),
        buildTransaction({
          id: 'gl-debit-b',
          source: 'gl',
          transactionDate: '2025-10-01',
          transactionType: 'Expense',
          amount: -250,
        }),
      ];

      const result = reserveGroupedTransactionIds([bankDebit], glDebits, matching);

      expect(result.selectedCandidates[0]).toMatchObject({
        category: 'LikelySplitCombineIssue',
        ruleId: 'grouped-split-combine-reserved',
        ruleName: 'Grouped Split/Combine Candidate',
      });
    });

    it('rejects a grouping whose sides carry opposite signs', () => {
      const bankCredit = buildTransaction({
        id: 'bank-credit',
        source: 'bank',
        transactionDate: '2025-10-01',
        transactionType: 'Deposit',
        amount: 100,
      });
      const glMixed = [
        buildTransaction({
          id: 'gl-pos',
          source: 'gl',
          transactionDate: '2025-10-01',
          transactionType: 'Deposit',
          amount: 300,
        }),
        buildTransaction({
          id: 'gl-neg',
          source: 'gl',
          transactionDate: '2025-10-01',
          transactionType: 'Deposit',
          amount: -200,
        }),
      ];

      // Totals agree (100 === 300 - 200) but the GL side mixes signs, so this is not a
      // balanced grouping — it is the fee-netting shape, which needs its own keyword gate.
      expect(categoriesOf([bankCredit], glMixed)).not.toContain('LikelySplitCombineIssue');
    });
  });

  describe('FeeNettingMatch', () => {
    const bankCredit = buildTransaction({
      id: 'bank-net',
      source: 'bank',
      transactionDate: '2025-10-05',
      transactionType: 'Deposit',
      amount: 970,
    });
    const glRevenue = buildTransaction({
      id: 'gl-revenue',
      source: 'gl',
      transactionDate: '2025-10-05',
      transactionType: 'Deposit',
      description: 'Card settlement revenue',
      amount: 1000,
    });
    const glFee = buildTransaction({
      id: 'gl-fee',
      source: 'gl',
      transactionDate: '2025-10-05',
      transactionType: 'Expense',
      description: 'Merchant fee for October settlement',
      amount: -30,
    });

    it('matches a bank credit against GL revenue net of a fee', () => {
      const result = reserveGroupedTransactionIds([bankCredit], [glRevenue, glFee], matching);

      expect(result.selectedCandidates[0]).toMatchObject({
        category: 'FeeNettingMatch',
        ruleId: 'fee-netting-reserved',
        ruleName: 'Fee Netting Candidate',
      });
    });

    it('reserves the revenue and the fee together with the bank credit', () => {
      const result = reserveGroupedTransactionIds([bankCredit], [glRevenue, glFee], matching);

      expect(result.selectedCandidates[0]?.glTransactionIds).toEqual(['gl-revenue', 'gl-fee']);
      expect(result.selectedCandidates[0]?.bankTransactionIds).toEqual(['bank-net']);
    });

    it.each(['processing fee', 'gateway fee', 'interchange fee', 'transaction fee', 'card fee'])(
      'recognizes %s as a fee signal',
      (keyword) => {
        const fee = buildTransaction({
          ...glFee,
          id: 'gl-fee-kw',
          description: `Monthly ${keyword}`,
        });

        expect(categoriesOf([bankCredit], [glRevenue, fee])).toContain('FeeNettingMatch');
      },
    );

    it('reads the fee signal from the payee name when the description has none', () => {
      const fee = buildTransaction({
        ...glFee,
        id: 'gl-fee-payee',
        description: undefined,
        payeeName: 'Acme Merchant Service Fee',
      });

      expect(categoriesOf([bankCredit], [glRevenue, fee])).toContain('FeeNettingMatch');
    });

    it('rejects a netting shape whose fee line has no fee-like description', () => {
      const unlabelledFee = buildTransaction({
        ...glFee,
        id: 'gl-fee-plain',
        description: 'Miscellaneous adjustment',
        payeeName: undefined,
        merchantName: undefined,
      });

      expect(categoriesOf([bankCredit], [glRevenue, unlabelledFee])).not.toContain(
        'FeeNettingMatch',
      );
    });

    it('rejects a netting shape whose net amount does not match the bank credit', () => {
      const wrongFee = buildTransaction({ ...glFee, id: 'gl-fee-wrong', amount: -45 });

      expect(categoriesOf([bankCredit], [glRevenue, wrongFee])).not.toContain('FeeNettingMatch');
    });

    it('rejects a netting shape outside the timing window', () => {
      const lateFee = buildTransaction({
        ...glFee,
        id: 'gl-fee-late',
        transactionDate: '2025-12-20',
      });

      expect(categoriesOf([bankCredit], [glRevenue, lateFee])).not.toContain('FeeNettingMatch');
    });
  });

  describe('PartialPaymentMatch', () => {
    const glDebit = buildTransaction({
      id: 'gl-invoice',
      source: 'gl',
      transactionDate: '2025-10-01',
      transactionType: 'Expense',
      amount: -900,
    });
    // Dated beyond timingDifferenceDays (21) but inside partialPaymentWindowDays (90) on purpose.
    // Inside the narrower window this same 2-bank-to-1-GL shape is also a valid generic grouping,
    // and that candidate scores higher, so it wins the greedy reservation and this builder never
    // gets to prove itself. The wider window is the only place PartialPaymentMatch is observable.
    const bankInstallments = [
      buildTransaction({
        id: 'bank-inst-1',
        source: 'bank',
        transactionDate: '2025-11-05',
        transactionType: 'Payment',
        description: 'Installment 1 of 2',
        // The builder also requires ≥0.5 average pairwise payee-token similarity across the
        // installments, so shared tokens are part of the fixture, not decoration.
        normalizedComparisonTokens: ['ACME', 'SUPPLY', 'INSTALLMENT'],
        amount: -400,
      }),
      buildTransaction({
        id: 'bank-inst-2',
        source: 'bank',
        transactionDate: '2025-11-20',
        transactionType: 'Payment',
        description: 'Installment 2 of 2',
        normalizedComparisonTokens: ['ACME', 'SUPPLY', 'INSTALLMENT'],
        amount: -500,
      }),
    ];

    it('matches a GL debit against the bank installments that sum to it', () => {
      const result = reserveGroupedTransactionIds(bankInstallments, [glDebit], matching);

      expect(result.selectedCandidates[0]).toMatchObject({
        category: 'PartialPaymentMatch',
        ruleId: 'partial-payment-reserved',
        ruleName: 'Partial Payment Candidate',
      });
    });

    it('reserves both installments against the single GL debit', () => {
      const result = reserveGroupedTransactionIds(bankInstallments, [glDebit], matching);

      expect([...result.reservedBankTransactionIds].sort()).toEqual(['bank-inst-1', 'bank-inst-2']);
      expect([...result.reservedGlTransactionIds]).toEqual(['gl-invoice']);
    });

    it.each(['partial payment', 'payment plan', 'split payment'])(
      'recognizes %s as an installment signal',
      (keyword) => {
        const installments = bankInstallments.map((transaction, index) =>
          buildTransaction({
            ...transaction,
            id: `bank-kw-${index}`,
            description: `${keyword} ${index + 1}`,
          }),
        );

        expect(categoriesOf(installments, [glDebit])).toContain('PartialPaymentMatch');
      },
    );

    it('rejects bank debits with no installment-style description', () => {
      const unlabelled = bankInstallments.map((transaction, index) =>
        buildTransaction({
          ...transaction,
          id: `bank-plain-${index}`,
          description: 'Card purchase',
        }),
      );

      expect(categoriesOf(unlabelled, [glDebit])).not.toContain('PartialPaymentMatch');
    });

    it('rejects installments that do not sum to the GL debit', () => {
      const short = [
        bankInstallments[0]!,
        buildTransaction({ ...bankInstallments[1]!, id: 'bank-inst-short', amount: -450 }),
      ];

      expect(categoriesOf(short, [glDebit])).not.toContain('PartialPaymentMatch');
    });

    it('rejects installments falling outside the partial-payment window', () => {
      const stale = [
        bankInstallments[0]!,
        buildTransaction({
          ...bankInstallments[1]!,
          id: 'bank-inst-stale',
          transactionDate: '2026-06-01',
        }),
      ];

      expect(categoriesOf(stale, [glDebit])).not.toContain('PartialPaymentMatch');
    });

    it('rejects installments whose payee context is not similar enough', () => {
      const unrelated = [
        buildTransaction({
          ...bankInstallments[0]!,
          id: 'bank-unrelated-1',
          normalizedComparisonTokens: ['ACME', 'SUPPLY'],
        }),
        buildTransaction({
          ...bankInstallments[1]!,
          id: 'bank-unrelated-2',
          normalizedComparisonTokens: ['ZENITH', 'FREIGHT'],
        }),
      ];

      expect(categoriesOf(unrelated, [glDebit])).not.toContain('PartialPaymentMatch');
    });

    it('rejects a single bank debit, since a partial payment needs at least two', () => {
      const soleInstallment = buildTransaction({
        ...bankInstallments[0]!,
        id: 'bank-inst-only',
        amount: -900,
      });

      expect(categoriesOf([soleInstallment], [glDebit])).not.toContain('PartialPaymentMatch');
    });
  });

  describe('candidate selection across categories', () => {
    it('returns empty sets when neither side has any transactions', () => {
      const result = reserveGroupedTransactionIds([], [], matching);

      expect(result.selectedCandidates).toEqual([]);
      expect(result.reservedBankTransactionIds.size).toBe(0);
      expect(result.reservedGlTransactionIds.size).toBe(0);
    });

    it('never reserves the same transaction id in two candidates', () => {
      const bank = [
        buildTransaction({
          id: 'bank-shared',
          source: 'bank',
          transactionDate: '2025-10-01',
          transactionType: 'Deposit',
          amount: 500,
        }),
      ];
      const gl = [
        buildTransaction({
          id: 'gl-1',
          source: 'gl',
          transactionDate: '2025-10-01',
          transactionType: 'Deposit',
          amount: 200,
        }),
        buildTransaction({
          id: 'gl-2',
          source: 'gl',
          transactionDate: '2025-10-01',
          transactionType: 'Deposit',
          amount: 300,
        }),
        buildTransaction({
          id: 'gl-3',
          source: 'gl',
          transactionDate: '2025-10-01',
          transactionType: 'Deposit',
          amount: 250,
        }),
        buildTransaction({
          id: 'gl-4',
          source: 'gl',
          transactionDate: '2025-10-01',
          transactionType: 'Deposit',
          amount: 250,
        }),
      ];

      const result = reserveGroupedTransactionIds(bank, gl, matching);
      const reservedGl = result.selectedCandidates.flatMap((c) => c.glTransactionIds);

      expect(new Set(reservedGl).size).toBe(reservedGl.length);
      expect(result.selectedCandidates).toHaveLength(1);
    });
  });
});
