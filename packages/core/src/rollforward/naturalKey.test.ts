import { describe, expect, it } from 'vitest';

import type { NormalizedTransaction } from '@recon/domain';
import { deriveNaturalKey } from './naturalKey';

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
});

const ACCOUNT_ID = 'account-uuid-1';

describe('deriveNaturalKey', () => {
  it('Tier 1: uses the check number when present, regardless of other fields', () => {
    const transaction = buildTransaction({
      checkNumber: '1042',
      referenceNumber: 'REF-999',
      amount: -250.5,
      contextFingerprint: 'irrelevant',
    });

    expect(deriveNaturalKey(transaction, ACCOUNT_ID)).toEqual({
      key: `check:${ACCOUNT_ID}:1042`,
      tier: 1,
    });
  });

  it('Tier 1: is stable across two runs of the same check, even if description text changed', () => {
    const runOne = buildTransaction({
      checkNumber: '1042',
      description: 'CHECK 1042',
      contextFingerprint: 'fp-run-one',
    });
    const runTwo = buildTransaction({
      checkNumber: '1042',
      description: 'CHECK #1042 - VENDOR PAYMENT',
      contextFingerprint: 'fp-run-two',
    });

    expect(deriveNaturalKey(runOne, ACCOUNT_ID)).toEqual(deriveNaturalKey(runTwo, ACCOUNT_ID));
  });

  it('Tier 2: falls back to reference number + amount when no check number is present', () => {
    const transaction = buildTransaction({
      checkNumber: undefined,
      referenceNumber: 'ach-2025-01-1234',
      amount: -75.25,
    });

    expect(deriveNaturalKey(transaction, ACCOUNT_ID)).toEqual({
      key: `ref:${ACCOUNT_ID}:ACH-2025-01-1234:-75.25`,
      tier: 2,
    });
  });

  it('Tier 2: normalizes reference number case/whitespace so equivalent references produce the same key', () => {
    const runOne = buildTransaction({ referenceNumber: '  ach-2025-01-1234  ', amount: -75.25 });
    const runTwo = buildTransaction({ referenceNumber: 'ACH-2025-01-1234', amount: -75.25 });

    expect(deriveNaturalKey(runOne, ACCOUNT_ID)).toEqual(deriveNaturalKey(runTwo, ACCOUNT_ID));
  });

  it('Tier 2: does not fire when amount is null, even with a reference number present', () => {
    const transaction = buildTransaction({ referenceNumber: 'REF-1', amount: null });

    expect(deriveNaturalKey(transaction, ACCOUNT_ID).tier).toBe(3);
  });

  it('Tier 3: falls back to the context fingerprint when neither a check nor reference number is present', () => {
    const transaction = buildTransaction({
      checkNumber: undefined,
      referenceNumber: undefined,
      contextFingerprint: 'abc123',
    });

    expect(deriveNaturalKey(transaction, ACCOUNT_ID)).toEqual({
      key: `fp:${ACCOUNT_ID}:abc123`,
      tier: 3,
    });
  });

  it('Tier 3: is stable across two runs when the underlying transaction is identical, since contextFingerprint is deterministic', () => {
    // Same date/amount/description -- buildContextFingerprint (normalization/text.ts) hashes only
    // source/date/signedAmount/checkNumber/referenceNumber/normalizedComparisonText, none of
    // which are run- or job-specific, so two separate runs of the same logical row hash the same.
    const sharedFingerprint = 'deterministic-fingerprint';
    const runOne = buildTransaction({ contextFingerprint: sharedFingerprint });
    const runTwo = buildTransaction({ contextFingerprint: sharedFingerprint, id: 'different-row-id' });

    expect(deriveNaturalKey(runOne, ACCOUNT_ID)).toEqual(deriveNaturalKey(runTwo, ACCOUNT_ID));
  });

  it('keys are scoped per account -- the same check number on two different accounts never collides', () => {
    const transaction = buildTransaction({ checkNumber: '1042' });

    expect(deriveNaturalKey(transaction, 'account-a').key).not.toBe(
      deriveNaturalKey(transaction, 'account-b').key,
    );
  });
});
