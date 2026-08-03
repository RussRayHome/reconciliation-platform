import { describe, expect, it } from 'vitest';

import type { NormalizedTransaction } from '@recon/domain';

import {
  areGroupedTransactionsCompatible,
  areTimingKindsCompatible,
  buildAmountFrequency,
  calculateGroupedDateDifference,
  formatKinds,
  generateTransactionCombinations,
  inferTransactionKind,
  isCheckLikeGlTransaction,
  mergeComparisonTokens,
  mergeReferenceTokens,
  parseIsoDate,
  sumTransactionAmounts,
} from './exceptionClassifierUtils';

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  runId: 'test-run',
  rawRowId: overrides.rawRowId ?? 'raw',
  sourceFileId: 'file',
  source: overrides.source ?? 'bank',
  spreadsheetFileName: 'test.xlsx',
  worksheetName: 'Sheet1',
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
  runningBalance: null,
  normalizedComparisonText: '',
  normalizedComparisonTokens: overrides.normalizedComparisonTokens ?? [],
  normalizedReferenceTokens: overrides.normalizedReferenceTokens ?? [],
  rawSourceValues: {},
  dataQualityIssues: overrides.dataQualityIssues ?? [],
  isExcluded: overrides.isExcluded ?? false,
  exclusionReason: overrides.exclusionReason,
  isZeroAmount: overrides.isZeroAmount ?? false,
  contextFingerprint: 'fp',
  accountIdentifier: overrides.accountIdentifier,
});

describe('parseIsoDate', () => {
  it('returns undefined for undefined input', () => {
    expect(parseIsoDate(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseIsoDate('')).toBeUndefined();
  });

  it('parses a valid ISO date string to a Date', () => {
    const result = parseIsoDate('2025-01-15');
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toContain('2025-01-15');
  });

  it('returns undefined for an invalid date string', () => {
    expect(parseIsoDate('not-a-date')).toBeUndefined();
  });
});

describe('isCheckLikeGlTransaction', () => {
  it('returns true when checkNumber is set', () => {
    expect(isCheckLikeGlTransaction(buildTransaction({ checkNumber: '1001' }))).toBe(true);
  });

  it('returns true when serialNumber is set', () => {
    expect(isCheckLikeGlTransaction(buildTransaction({ serialNumber: '5555' }))).toBe(true);
  });

  it('returns true when transactionType contains "check"', () => {
    expect(isCheckLikeGlTransaction(buildTransaction({ transactionType: 'Check' }))).toBe(true);
  });

  it('returns false when no check-like fields are present', () => {
    expect(isCheckLikeGlTransaction(buildTransaction({ transactionType: 'Deposit' }))).toBe(false);
  });
});

describe('inferTransactionKind', () => {
  it('returns check when checkNumber is set', () => {
    expect(inferTransactionKind(buildTransaction({ checkNumber: '1001', amount: -200 }))).toBe(
      'check',
    );
  });

  it('returns check when serialNumber is set', () => {
    expect(inferTransactionKind(buildTransaction({ serialNumber: '999' }))).toBe('check');
  });

  it('returns check when transactionType includes "check"', () => {
    expect(inferTransactionKind(buildTransaction({ transactionType: 'Bill Check Payment' }))).toBe(
      'check',
    );
  });

  it('returns journal when transactionType includes "journal"', () => {
    expect(inferTransactionKind(buildTransaction({ transactionType: 'Journal Entry' }))).toBe(
      'journal',
    );
  });

  it('returns transfer when transactionType includes "transfer"', () => {
    expect(inferTransactionKind(buildTransaction({ transactionType: 'Transfer' }))).toBe(
      'transfer',
    );
  });

  it('returns transfer when description includes "online from"', () => {
    expect(inferTransactionKind(buildTransaction({ description: 'ONLINE FROM ****1061' }))).toBe(
      'transfer',
    );
  });

  it('returns deposit when amount is positive with no other indicators', () => {
    expect(inferTransactionKind(buildTransaction({ amount: 500 }))).toBe('deposit');
  });

  it('returns deposit when transactionType includes "deposit"', () => {
    expect(inferTransactionKind(buildTransaction({ transactionType: 'Deposit', amount: 0 }))).toBe(
      'deposit',
    );
  });

  it('returns withdrawal when amount is negative', () => {
    expect(inferTransactionKind(buildTransaction({ amount: -300 }))).toBe('withdrawal');
  });

  it('returns withdrawal when transactionType includes "payment"', () => {
    expect(
      inferTransactionKind(buildTransaction({ transactionType: 'Bill Payment', amount: 0 })),
    ).toBe('withdrawal');
  });

  it('returns unknown when amount is zero with no other indicators', () => {
    expect(inferTransactionKind(buildTransaction({ amount: 0 }))).toBe('unknown');
  });
});

describe('areTimingKindsCompatible', () => {
  it('returns true when both kinds are the same', () => {
    const deposit = buildTransaction({ amount: 100 });
    expect(areTimingKindsCompatible(deposit, deposit)).toBe(true);
  });

  it('returns true for transfer + journal (a known compatible cross-kind pair)', () => {
    const transfer = buildTransaction({ transactionType: 'Transfer' });
    const journal = buildTransaction({ transactionType: 'Journal Entry' });
    expect(areTimingKindsCompatible(transfer, journal)).toBe(true);
  });

  it('returns true for deposit + transfer', () => {
    const deposit = buildTransaction({ amount: 100 });
    const transfer = buildTransaction({ transactionType: 'Transfer' });
    expect(areTimingKindsCompatible(deposit, transfer)).toBe(true);
  });

  it('returns false for journal + transfer (order matters)', () => {
    const journal = buildTransaction({ transactionType: 'Journal Entry' });
    const transfer = buildTransaction({ transactionType: 'Transfer' });
    expect(areTimingKindsCompatible(journal, transfer)).toBe(false);
  });

  it('returns false for check + deposit', () => {
    const check = buildTransaction({ checkNumber: '1001' });
    const deposit = buildTransaction({ amount: 100 });
    expect(areTimingKindsCompatible(check, deposit)).toBe(false);
  });

  it('returns true when either side has unknown kind', () => {
    const unknown = buildTransaction({ amount: 0 });
    const deposit = buildTransaction({ amount: 100 });
    expect(areTimingKindsCompatible(unknown, deposit)).toBe(true);
    expect(areTimingKindsCompatible(deposit, unknown)).toBe(true);
  });
});

describe('areGroupedTransactionsCompatible', () => {
  it('returns true when all pairs are compatible', () => {
    const bank = [buildTransaction({ transactionType: 'Transfer' })];
    const gl = [buildTransaction({ transactionType: 'Journal Entry' })];
    expect(areGroupedTransactionsCompatible(bank, gl)).toBe(true);
  });

  it('returns false when any pair is incompatible', () => {
    const bank = [buildTransaction({ transactionType: 'Transfer' })];
    const gl = [
      buildTransaction({ transactionType: 'Journal Entry' }),
      buildTransaction({ checkNumber: '999' }),
    ];
    expect(areGroupedTransactionsCompatible(bank, gl)).toBe(false);
  });
});

describe('calculateGroupedDateDifference', () => {
  it('returns the maximum date difference across all bank × gl pairs', () => {
    const bank = [
      buildTransaction({ transactionDate: '2025-01-01' }),
      buildTransaction({ transactionDate: '2025-01-05' }),
    ];
    const gl = [buildTransaction({ transactionDate: '2025-01-03' })];
    // differences: |3-1|=2, |3-5|=2 → max = 2
    expect(calculateGroupedDateDifference(bank, gl)).toBe(2);
  });

  it('returns null when any transaction is missing a date', () => {
    const bank = [buildTransaction({ transactionDate: undefined, postingDate: undefined })];
    const gl = [buildTransaction({ transactionDate: '2025-01-03' })];
    expect(calculateGroupedDateDifference(bank, gl)).toBeNull();
  });
});

describe('generateTransactionCombinations', () => {
  const items = ['a', 'b', 'c', 'd'];

  it('produces the correct number of combinations for given size bounds', () => {
    // C(4,2) + C(4,3) = 6 + 4 = 10
    expect(generateTransactionCombinations(items, 2, 3)).toHaveLength(10);
  });

  it('returns an empty array for an empty input', () => {
    expect(generateTransactionCombinations([], 1, 2)).toEqual([]);
  });

  it('returns an empty array when minimumSize exceeds the number of items', () => {
    expect(generateTransactionCombinations(['a', 'b'], 3, 4)).toEqual([]);
  });

  it('produces combinations where each has the correct length', () => {
    const combos = generateTransactionCombinations(items, 2, 2);
    expect(combos.every((combo) => combo.length === 2)).toBe(true);
  });

  it('produces combinations with no repeated items', () => {
    const combos = generateTransactionCombinations(items, 2, 3);
    for (const combo of combos) {
      expect(new Set(combo).size).toBe(combo.length);
    }
  });
});

describe('buildAmountFrequency', () => {
  it('returns an empty map for an empty input array', () => {
    expect(buildAmountFrequency([])).toEqual(new Map());
  });

  it('skips transactions with null amount', () => {
    const tx = { ...buildTransaction({}), amount: null } as unknown as NormalizedTransaction;
    expect(buildAmountFrequency([tx]).size).toBe(0);
  });

  it('counts each amount occurrence correctly', () => {
    const txs = [
      buildTransaction({ amount: -100 }),
      buildTransaction({ amount: -100 }),
      buildTransaction({ amount: -200 }),
    ];
    const freq = buildAmountFrequency(txs);
    expect(freq.get(-100)).toBe(2);
    expect(freq.get(-200)).toBe(1);
  });
});

describe('sumTransactionAmounts', () => {
  it('returns 0 for an empty array', () => {
    expect(sumTransactionAmounts([])).toBe(0);
  });

  it('sums amounts correctly across multiple transactions', () => {
    const txs = [
      buildTransaction({ amount: 100 }) as NormalizedTransaction & { amount: number },
      buildTransaction({ amount: 200 }) as NormalizedTransaction & { amount: number },
      buildTransaction({ amount: -50 }) as NormalizedTransaction & { amount: number },
    ];
    expect(sumTransactionAmounts(txs)).toBe(250);
  });
});

describe('mergeComparisonTokens', () => {
  it('flattens comparison tokens from all transactions', () => {
    const txs = [
      buildTransaction({ normalizedComparisonTokens: ['ACME', 'CORP'] }),
      buildTransaction({ normalizedComparisonTokens: ['OFFICE', 'DEPOT'] }),
    ];
    expect(mergeComparisonTokens(txs)).toEqual(['ACME', 'CORP', 'OFFICE', 'DEPOT']);
  });

  it('returns an empty array when all token lists are empty', () => {
    expect(mergeComparisonTokens([buildTransaction({})])).toEqual([]);
  });
});

describe('mergeReferenceTokens', () => {
  it('flattens reference tokens from all transactions', () => {
    const txs = [
      buildTransaction({ normalizedReferenceTokens: ['REF', '001'] }),
      buildTransaction({ normalizedReferenceTokens: ['REF', '002'] }),
    ];
    expect(mergeReferenceTokens(txs)).toEqual(['REF', '001', 'REF', '002']);
  });
});

describe('formatKinds', () => {
  it('returns "unknown" when all transactions have unknown kind', () => {
    expect(formatKinds([buildTransaction({ amount: 0 })])).toBe('unknown');
  });

  it('returns a comma-separated list of deduplicated non-unknown kinds', () => {
    const txs = [
      buildTransaction({ amount: 100 }),
      buildTransaction({ amount: 200 }),
      buildTransaction({ transactionType: 'Transfer' }),
    ];
    expect(formatKinds(txs)).toBe('deposit, transfer');
  });
});
