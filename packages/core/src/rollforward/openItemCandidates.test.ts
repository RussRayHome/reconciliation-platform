import { describe, expect, it } from 'vitest';

import type { ExceptionItem, NormalizedTransaction } from '@recon/domain';
import { buildOpenItemCandidates } from './openItemCandidates';

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  runId: overrides.runId ?? 'run-1',
  rawRowId: overrides.rawRowId ?? 'row-1',
  sourceFileId: overrides.sourceFileId ?? 'file-1',
  source: overrides.source ?? 'gl',
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
  merchantName: overrides.merchantName,
  payeeName: overrides.payeeName,
  amount: 'amount' in overrides ? (overrides.amount as number | null) : -250,
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
  contextFingerprint: overrides.contextFingerprint ?? 'fingerprint-1',
  accountIdentifier: overrides.accountIdentifier,
  reviewerNotes: overrides.reviewerNotes,
});

const buildException = (overrides: Partial<ExceptionItem>): ExceptionItem => ({
  id: overrides.id ?? crypto.randomUUID(),
  runId: overrides.runId ?? 'run-1',
  category: overrides.category ?? 'OutstandingCheck',
  severity: overrides.severity ?? 'Medium',
  source: overrides.source ?? 'gl',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'test.xlsx',
  lineNumber: overrides.lineNumber ?? 1,
  transactionDate: overrides.transactionDate,
  amount: 'amount' in overrides ? (overrides.amount as number | null) : -250,
  errorMessage: overrides.errorMessage ?? 'test',
  recommendedNextActions: overrides.recommendedNextActions ?? [],
  normalizedComparisonTokens: overrides.normalizedComparisonTokens ?? [],
  relatedTransactionIds: overrides.relatedTransactionIds ?? [],
});

describe('buildOpenItemCandidates', () => {
  it('builds a candidate for a carry-eligible exception with a resolvable transaction', () => {
    const transaction = buildTransaction({
      id: 'txn-1',
      accountIdentifier: '1061',
      checkNumber: '1042',
      transactionDate: '2026-01-05',
      amount: -250,
      description: 'Check 1042',
    });
    const exception = buildException({
      category: 'OutstandingCheck',
      relatedTransactionIds: ['txn-1'],
    });

    const result = buildOpenItemCandidates([exception], [transaction]);

    expect(result.candidates).toEqual([
      {
        accountIdentifier: '1061',
        sourceSystem: 'gl',
        category: 'OutstandingCheck',
        naturalKey: 'check:1061:1042',
        naturalKeyTier: 1,
        originalTransactionDate: '2026-01-05',
        amount: -250,
        checkNumber: '1042',
        referenceNumber: undefined,
        descriptionSnapshot: 'Check 1042',
      },
    ]);
    expect(result.skippedNoTransaction).toBe(0);
    expect(result.skippedNoAccountIdentifier).toBe(0);
    expect(result.skippedMissingRequiredField).toBe(0);
  });

  it('excludes never-carry categories entirely, even with a perfectly resolvable transaction', () => {
    const transaction = buildTransaction({ id: 'txn-1', accountIdentifier: '1061' });
    const exception = buildException({
      category: 'WeakDescriptionMatch',
      relatedTransactionIds: ['txn-1'],
    });

    const result = buildOpenItemCandidates([exception], [transaction]);

    expect(result.candidates).toHaveLength(0);
    expect(result.skippedNoTransaction).toBe(0);
  });

  it('counts a carry-eligible exception whose related transaction id does not resolve', () => {
    const exception = buildException({
      category: 'OutstandingCheck',
      relatedTransactionIds: ['does-not-exist'],
    });

    const result = buildOpenItemCandidates([exception], []);

    expect(result.candidates).toHaveLength(0);
    expect(result.skippedNoTransaction).toBe(1);
  });

  it('counts a carry-eligible exception whose transaction has no accountIdentifier', () => {
    const transaction = buildTransaction({ id: 'txn-1', accountIdentifier: undefined });
    const exception = buildException({
      category: 'OutstandingCheck',
      relatedTransactionIds: ['txn-1'],
    });

    const result = buildOpenItemCandidates([exception], [transaction]);

    expect(result.candidates).toHaveLength(0);
    expect(result.skippedNoAccountIdentifier).toBe(1);
  });

  it('counts a carry-eligible exception whose transaction has neither date nor amount', () => {
    const noDate = buildTransaction({
      id: 'txn-no-date',
      accountIdentifier: '1061',
      transactionDate: undefined,
      postingDate: undefined,
    });
    const noAmount = buildTransaction({
      id: 'txn-no-amount',
      accountIdentifier: '1061',
      transactionDate: '2026-01-05',
      amount: null,
    });
    const exceptions = [
      buildException({ category: 'OutstandingCheck', relatedTransactionIds: ['txn-no-date'] }),
      buildException({ category: 'OutstandingCheck', relatedTransactionIds: ['txn-no-amount'] }),
    ];

    const result = buildOpenItemCandidates(exceptions, [noDate, noAmount]);

    expect(result.candidates).toHaveLength(0);
    expect(result.skippedMissingRequiredField).toBe(2);
  });

  it('falls back to postingDate when transactionDate is absent', () => {
    const transaction = buildTransaction({
      id: 'txn-1',
      accountIdentifier: '1061',
      transactionDate: undefined,
      postingDate: '2026-01-07',
    });
    const exception = buildException({
      category: 'MissingFromGL',
      relatedTransactionIds: ['txn-1'],
    });

    const result = buildOpenItemCandidates([exception], [transaction]);

    expect(result.candidates[0]?.originalTransactionDate).toBe('2026-01-07');
  });

  it('produces the same natural key for the same logical item across two separate calls (two runs)', () => {
    const runOneTransaction = buildTransaction({
      id: 'txn-run-one',
      accountIdentifier: '1061',
      checkNumber: '1042',
    });
    const runTwoTransaction = buildTransaction({
      id: 'txn-run-two',
      accountIdentifier: '1061',
      checkNumber: '1042',
    });
    const runOneResult = buildOpenItemCandidates(
      [buildException({ category: 'OutstandingCheck', relatedTransactionIds: ['txn-run-one'] })],
      [runOneTransaction],
    );
    const runTwoResult = buildOpenItemCandidates(
      [buildException({ category: 'OutstandingCheck', relatedTransactionIds: ['txn-run-two'] })],
      [runTwoTransaction],
    );

    expect(runOneResult.candidates[0]?.naturalKey).toBe(runTwoResult.candidates[0]?.naturalKey);
  });
});
