import { randomUUID } from 'node:crypto';

import { defaultReconciliationConfig } from '@recon/config';
import type { RawTransactionRow } from '@recon/domain';
import { describe, expect, it } from 'vitest';

import { normalizeTransactions } from './transactions';

const buildRow = (overrides: Partial<RawTransactionRow> = {}): RawTransactionRow => ({
  id: overrides.id ?? randomUUID(),
  sourceFileId: overrides.sourceFileId ?? 'source-1',
  source: overrides.source ?? 'bank',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'bank.xlsx',
  worksheetName: overrides.worksheetName ?? 'Transactions',
  lineNumber: overrides.lineNumber ?? 2,
  rawValues: overrides.rawValues ?? {},
  transactionDateRaw: overrides.transactionDateRaw,
  postingDateRaw: overrides.postingDateRaw,
  transactionTypeRaw: overrides.transactionTypeRaw,
  checkNumberRaw: overrides.checkNumberRaw,
  serialNumberRaw: overrides.serialNumberRaw,
  referenceNumberRaw: overrides.referenceNumberRaw,
  descriptionRaw: overrides.descriptionRaw,
  merchantNameRaw: overrides.merchantNameRaw,
  payeeNameRaw: overrides.payeeNameRaw,
  amountRaw: overrides.amountRaw,
  debitRaw: overrides.debitRaw,
  creditRaw: overrides.creditRaw,
  runningBalanceRaw: overrides.runningBalanceRaw,
  excluded: overrides.excluded ?? false,
  exclusionReason: overrides.exclusionReason,
  parsingIssues: overrides.parsingIssues ?? [],
});

describe('normalizeTransactions edge cases', () => {
  it('parses Excel serial dates and falls back to posting date when needed', () => {
    const normalized = normalizeTransactions(
      'run-edge-dates',
      [
        buildRow({
          id: 'serial-date',
          source: 'qbo',
          transactionDateRaw: '45315',
          amountRaw: '125.00',
        }),
        buildRow({
          id: 'posting-fallback',
          transactionDateRaw: 'not-a-date',
          postingDateRaw: '2025-01-16',
          amountRaw: '10.00',
        }),
      ],
      defaultReconciliationConfig,
    );

    const serialDate = normalized.find((item) => item.rawRowId === 'serial-date');
    const postingFallback = normalized.find((item) => item.rawRowId === 'posting-fallback');

    expect(serialDate?.transactionDate).toBe('2024-01-24');
    expect(postingFallback?.transactionDate).toBe('2025-01-16');
  });

  it('handles accounting negatives, trailing minus values, and DR/CR markers', () => {
    const normalized = normalizeTransactions(
      'run-edge-amounts',
      [
        buildRow({ id: 'paren-negative', source: 'qbo', amountRaw: '(1000.00)' }),
        buildRow({ id: 'trailing-minus', source: 'qbo', amountRaw: '250-' }),
        buildRow({ id: 'dr-marker', source: 'qbo', amountRaw: '900 DR' }),
        buildRow({ id: 'cr-marker', source: 'qbo', amountRaw: '900 CR' }),
      ],
      defaultReconciliationConfig,
    );

    expect(normalized.find((item) => item.rawRowId === 'paren-negative')?.amount).toBe(-1000);
    expect(normalized.find((item) => item.rawRowId === 'trailing-minus')?.amount).toBe(-250);
    expect(normalized.find((item) => item.rawRowId === 'dr-marker')?.amount).toBe(-900);
    expect(normalized.find((item) => item.rawRowId === 'cr-marker')?.amount).toBe(900);
  });

  it('flags malformed critical fields and zero-amount rows for review', () => {
    const normalized = normalizeTransactions(
      'run-edge-quality',
      [
        buildRow({
          id: 'missing-amount',
          source: 'qbo',
          transactionDateRaw: '2025-01-15',
          amountRaw: undefined,
        }),
        buildRow({
          id: 'missing-date',
          source: 'qbo',
          transactionDateRaw: 'not-a-date',
          postingDateRaw: undefined,
          amountRaw: '50.00',
        }),
        buildRow({
          id: 'zero-amount',
          source: 'qbo',
          transactionDateRaw: '2025-01-15',
          amountRaw: '0',
        }),
      ],
      defaultReconciliationConfig,
    );

    expect(normalized.find((item) => item.rawRowId === 'missing-amount')?.dataQualityIssues).toContain(
      'Amount is missing or malformed.',
    );
    expect(normalized.find((item) => item.rawRowId === 'missing-date')?.dataQualityIssues).toContain(
      'Transaction date is missing or malformed.',
    );
    expect(normalized.find((item) => item.rawRowId === 'zero-amount')?.dataQualityIssues).toContain(
      'Zero amount transaction requires review.',
    );
  });

  it('builds normalized comparison and reference tokens from source text', () => {
    const normalized = normalizeTransactions(
      'run-edge-tokens',
      [
        buildRow({
          id: 'token-row',
          transactionDateRaw: '2025-01-15',
          debitRaw: '45.00',
          descriptionRaw: 'PAY: DOE, JOHN - INVOICE #INV-2025-001',
          merchantNameRaw: 'McDonald\'s',
          payeeNameRaw: 'AT&T',
          checkNumberRaw: 'CHK-123456',
          referenceNumberRaw: '123-456-789',
        }),
      ],
      defaultReconciliationConfig,
    );

    const [first] = normalized;
    expect(first?.normalizedComparisonTokens).toEqual(
      expect.arrayContaining(['DOE', 'JOHN', 'INVOICE', 'INV', '2025', '001', 'MCDONALD', 'AT', 'T']),
    );
    expect(first?.normalizedReferenceTokens).toEqual(
      expect.arrayContaining(['CHK', '123456', '123', '456', '789']),
    );
  });

  it('preserves exclusion metadata and source parsing issues', () => {
    const normalized = normalizeTransactions(
      'run-edge-exclusions',
      [
        buildRow({
          id: 'excluded-row',
          transactionDateRaw: '2025-01-15',
          debitRaw: '20.00',
          excluded: true,
          exclusionReason: 'Beginning balance',
          parsingIssues: ['Unexpected merged cell'],
        }),
      ],
      defaultReconciliationConfig,
    );

    const [first] = normalized;
    expect(first?.isExcluded).toBe(true);
    expect(first?.exclusionReason).toBe('Beginning balance');
    expect(first?.dataQualityIssues).toContain('Unexpected merged cell');
  });
});