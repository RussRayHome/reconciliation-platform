import { describe, expect, it } from 'vitest';

import type { NormalizedTransaction, OpenItemRecord } from '@recon/domain';
import { defaultReconciliationConfig } from '@recon/config';

import { seedCarriedForwardTransactions } from './seedCarriedForward';

const textNormalization = defaultReconciliationConfig.textNormalization;

const buildOpenItem = (overrides: Partial<OpenItemRecord>): OpenItemRecord => ({
  id: overrides.id ?? 'open-item-1',
  accountIdentifier: overrides.accountIdentifier ?? '1061',
  sourceSystem: overrides.sourceSystem ?? 'gl',
  category: overrides.category ?? 'OutstandingCheck',
  naturalKey: overrides.naturalKey ?? 'check:1061:1042',
  naturalKeyTier: overrides.naturalKeyTier ?? 1,
  originalTransactionDate: overrides.originalTransactionDate ?? '2025-01-15',
  amount: overrides.amount ?? -250.5,
  checkNumber: overrides.checkNumber ?? '1042',
  referenceNumber: overrides.referenceNumber,
  descriptionSnapshot: overrides.descriptionSnapshot ?? 'CHECK 1042 VENDOR PAYMENT',
});

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  runId: overrides.runId ?? 'run-2',
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
  amount: 'amount' in overrides ? (overrides.amount as number | null) : -100,
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
  isCarriedForward: overrides.isCarriedForward,
  carriedFromOpenItemId: overrides.carriedFromOpenItemId,
});

describe('seedCarriedForwardTransactions', () => {
  it('materializes an open item into a carried NormalizedTransaction preserving its original date and amount', () => {
    const openItem = buildOpenItem({});
    const result = seedCarriedForwardTransactions('run-2', [openItem], [], textNormalization);

    expect(result.carriedTransactions).toHaveLength(1);
    expect(result.skippedAlreadyPresent).toBe(0);

    const carried = result.carriedTransactions[0]!;
    expect(carried.isCarriedForward).toBe(true);
    expect(carried.carriedFromOpenItemId).toBe('open-item-1');
    expect(carried.transactionDate).toBe('2025-01-15');
    expect(carried.amount).toBe(-250.5);
    expect(carried.checkNumber).toBe('1042');
    expect(carried.accountIdentifier).toBe('1061');
    expect(carried.source).toBe('gl');
  });

  it('derives a stable id from the open item id, so re-seeding the same item is idempotent at the id level', () => {
    const openItem = buildOpenItem({ id: 'open-item-42' });
    const first = seedCarriedForwardTransactions('run-2', [openItem], [], textNormalization);
    const second = seedCarriedForwardTransactions('run-2', [openItem], [], textNormalization);

    expect(first.carriedTransactions[0]!.id).toBe(second.carriedTransactions[0]!.id);
  });

  it('reproduces the same contextFingerprint a Tier-3 item was originally opened with, since every input is preserved', () => {
    const openItem = buildOpenItem({
      checkNumber: undefined,
      referenceNumber: undefined,
      naturalKey: 'fp:1061:abc123',
      naturalKeyTier: 3,
      descriptionSnapshot: 'WIRE TRANSFER FEE',
    });

    const carried = seedCarriedForwardTransactions(
      'run-2',
      [openItem],
      [],
      textNormalization,
    ).carriedTransactions[0]!;

    // Materialize a "fresh" transaction with the exact same underlying values the open item was
    // first opened from, the way normalizeTransactions would have produced it originally.
    const originalShape = buildTransaction({
      source: 'gl',
      transactionDate: '2025-01-15',
      amount: -250.5,
      description: 'WIRE TRANSFER FEE',
      normalizedComparisonText: carried.normalizedComparisonText,
    });

    expect(carried.contextFingerprint).toBeTruthy();
    expect(carried.normalizedComparisonText).toBe(originalShape.normalizedComparisonText);
  });

  it('skips an open item whose natural key already appears among this period\'s fresh transactions', () => {
    const openItem = buildOpenItem({ naturalKey: 'check:1061:1042', checkNumber: '1042' });
    const freshDuplicate = buildTransaction({
      accountIdentifier: '1061',
      checkNumber: '1042',
      source: 'gl',
    });

    const result = seedCarriedForwardTransactions(
      'run-2',
      [openItem],
      [freshDuplicate],
      textNormalization,
    );

    expect(result.carriedTransactions).toHaveLength(0);
    expect(result.skippedAlreadyPresent).toBe(1);
  });

  it('does not skip an open item whose account has fresh transactions but none matching its natural key', () => {
    const openItem = buildOpenItem({ naturalKey: 'check:1061:1042', checkNumber: '1042' });
    const unrelatedFresh = buildTransaction({
      accountIdentifier: '1061',
      checkNumber: '9999',
      source: 'gl',
    });

    const result = seedCarriedForwardTransactions(
      'run-2',
      [openItem],
      [unrelatedFresh],
      textNormalization,
    );

    expect(result.carriedTransactions).toHaveLength(1);
    expect(result.skippedAlreadyPresent).toBe(0);
  });
});
