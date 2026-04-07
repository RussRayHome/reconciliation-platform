import { describe, expect, it } from 'vitest';

import type { NormalizedTransaction } from '@recon/domain';
import { defaultReconciliationConfig } from '@recon/config';
import { reserveGroupedTransactionIds } from './groupedReservations';

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  runId: overrides.runId ?? 'grouped-reservation-test-run',
  rawRowId: overrides.rawRowId ?? `${overrides.id ?? 'row'}-raw`,
  sourceFileId: overrides.sourceFileId ?? `${overrides.source ?? 'bank'}-file`,
  source: overrides.source ?? 'bank',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'grouped-test.xlsx',
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

describe('reserveGroupedTransactionIds', () => {
  it('prefers the higher-scoring overlapping grouped candidate when one qbo batch could satisfy multiple bank anchors', () => {
    const bankTransactions = [
      buildTransaction({
        id: 'bank-preferred',
        source: 'bank',
        transactionDate: '2025-10-01',
        transactionType: 'Deposit',
        description: 'CARD SETTLEMENT BATCH A',
        amount: 300,
      }),
      buildTransaction({
        id: 'bank-overlap-loser',
        source: 'bank',
        transactionDate: '2025-10-03',
        transactionType: 'Deposit',
        description: 'CARD SETTLEMENT BATCH B',
        amount: 300,
      }),
    ];
    const qboTransactions = [
      buildTransaction({
        id: 'qbo-batch-1',
        source: 'qbo',
        transactionDate: '2025-10-01',
        transactionType: 'Deposit',
        description: 'Card receipt alpha',
        amount: 100,
      }),
      buildTransaction({
        id: 'qbo-batch-2',
        source: 'qbo',
        transactionDate: '2025-10-02',
        transactionType: 'Deposit',
        description: 'Card receipt beta',
        amount: 200,
      }),
    ];

    const result = reserveGroupedTransactionIds(
      bankTransactions,
      qboTransactions,
      defaultReconciliationConfig.matching,
    );

    expect([...result.reservedBankTransactionIds]).toEqual(['bank-preferred']);
    expect([...result.reservedQboTransactionIds].sort()).toEqual(['qbo-batch-1', 'qbo-batch-2']);
    expect(result.reservedBankTransactionIds.has('bank-overlap-loser')).toBe(false);
  });

  it('keeps separate grouped batches when they do not overlap and each side has a clear best counterpart set', () => {
    const bankTransactions = [
      buildTransaction({
        id: 'bank-batch-1',
        source: 'bank',
        transactionDate: '2025-11-01',
        transactionType: 'Deposit',
        description: 'DAILY CARD BATCH 1',
        amount: 300,
      }),
      buildTransaction({
        id: 'bank-batch-2',
        source: 'bank',
        transactionDate: '2025-11-05',
        transactionType: 'Deposit',
        description: 'DAILY CARD BATCH 2',
        amount: 180,
      }),
    ];
    const qboTransactions = [
      buildTransaction({
        id: 'qbo-batch-1a',
        source: 'qbo',
        transactionDate: '2025-11-01',
        transactionType: 'Deposit',
        description: 'Batch 1 alpha',
        amount: 120,
      }),
      buildTransaction({
        id: 'qbo-batch-1b',
        source: 'qbo',
        transactionDate: '2025-11-02',
        transactionType: 'Deposit',
        description: 'Batch 1 beta',
        amount: 180,
      }),
      buildTransaction({
        id: 'qbo-batch-2a',
        source: 'qbo',
        transactionDate: '2025-11-05',
        transactionType: 'Deposit',
        description: 'Batch 2 alpha',
        amount: 70,
      }),
      buildTransaction({
        id: 'qbo-batch-2b',
        source: 'qbo',
        transactionDate: '2025-11-06',
        transactionType: 'Deposit',
        description: 'Batch 2 beta',
        amount: 110,
      }),
    ];

    const result = reserveGroupedTransactionIds(
      bankTransactions,
      qboTransactions,
      defaultReconciliationConfig.matching,
    );

    expect([...result.reservedBankTransactionIds].sort()).toEqual(['bank-batch-1', 'bank-batch-2']);
    expect([...result.reservedQboTransactionIds].sort()).toEqual([
      'qbo-batch-1a',
      'qbo-batch-1b',
      'qbo-batch-2a',
      'qbo-batch-2b',
    ]);
  });
});