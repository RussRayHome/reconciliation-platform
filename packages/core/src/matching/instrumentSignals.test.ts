import { describe, expect, it } from 'vitest';

import type { NormalizedTransaction } from '@recon/domain';
import { isCardLikeTransaction, isWireLikeTransaction } from './instrumentSignals';

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: 'tx-1',
  runId: 'test-run',
  rawRowId: 'row-1',
  sourceFileId: 'bank-file',
  source: 'bank',
  spreadsheetFileName: 'test.xlsx',
  worksheetName: 'Sheet1',
  lineNumber: 1,
  amount: 0,
  splitAmount: null,
  debit: null,
  credit: null,
  runningBalance: null,
  normalizedComparisonText: '',
  normalizedComparisonTokens: [],
  normalizedReferenceTokens: [],
  rawSourceValues: {},
  dataQualityIssues: [],
  isExcluded: false,
  isZeroAmount: false,
  contextFingerprint: 'tx-1-fingerprint',
  ...overrides,
});

describe('isWireLikeTransaction', () => {
  it('does not false-positive on words that merely contain "wire" as a substring', () => {
    expect(isWireLikeTransaction(buildTransaction({ description: 'WIRELESS SERVICE FEE' }))).toBe(
      false,
    );
    expect(
      isWireLikeTransaction(buildTransaction({ description: 'HARDWIRE INSTALLATION' })),
    ).toBe(false);
    expect(isWireLikeTransaction(buildTransaction({ description: 'FUNDS REWIRED TODAY' }))).toBe(
      false,
    );
  });

  it('matches real wire-transfer bank descriptions from the January 2025 fixtures', () => {
    expect(
      isWireLikeTransaction(
        buildTransaction({
          description: 'PC NON-REPETITIVE WIRE WIRE REF# 20250122-00015886',
        }),
      ),
    ).toBe(true);
  });

  it('matches on transaction type alone', () => {
    expect(isWireLikeTransaction(buildTransaction({ transactionType: 'Wire Transfer' }))).toBe(
      true,
    );
  });
});

describe('isCardLikeTransaction', () => {
  it('matches real card-payment bank descriptions from the January 2025 fixtures', () => {
    expect(
      isCardLikeTransaction(
        buildTransaction({
          description: 'TRUIST ONLINE CREDIT CARD PMT CLIENT ASSISTED TO ****2030',
        }),
      ),
    ).toBe(true);
    expect(
      isCardLikeTransaction(
        buildTransaction({
          description: 'INTERNET PAYMENT CREDITCARD BARCLAYCARD US 1214198303',
        }),
      ),
    ).toBe(true);
  });

  it('matches the real GL Credit Card Payment transaction type', () => {
    expect(isCardLikeTransaction(buildTransaction({ transactionType: 'Credit Card Payment' }))).toBe(
      true,
    );
  });

  it('does not match an unrelated description or type', () => {
    expect(
      isCardLikeTransaction(
        buildTransaction({ transactionType: 'Expense', description: 'OFFICE SUPPLIES' }),
      ),
    ).toBe(false);
  });
});
