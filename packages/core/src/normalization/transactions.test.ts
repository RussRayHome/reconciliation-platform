import { describe, expect, it } from 'vitest';

import type { RawTransactionRow } from '@recon/domain';
import { defaultReconciliationConfig } from '@recon/config';
import { normalizeTransactions } from './transactions';

const baseRow: RawTransactionRow = {
  id: 'row-1',
  sourceFileId: 'source-1',
  source: 'bank',
  spreadsheetFileName: 'bank.xlsx',
  worksheetName: 'Transactions',
  lineNumber: 2,
  rawValues: {},
  transactionDateRaw: '2025-01-03',
  postingDateRaw: '2025-01-04',
  transactionTypeRaw: 'Card',
  checkNumberRaw: '',
  serialNumberRaw: '',
  referenceNumberRaw: 'REF-7788',
  descriptionRaw: 'Acme Office Supply #4432',
  merchantNameRaw: 'Acme Office Supply',
  payeeNameRaw: 'Acme Office Supply',
  amountRaw: '',
  debitRaw: '125.50',
  creditRaw: '',
  runningBalanceRaw: '1000.00',
  excluded: false,
  parsingIssues: [],
};

describe('normalizeTransactions', () => {
  it('normalizes signed amounts, dates, and comparison tokens', () => {
    const normalized = normalizeTransactions('run-1', [baseRow], defaultReconciliationConfig);
    const [first] = normalized;

    expect(normalized).toHaveLength(1);
    expect(first).toBeDefined();
    if (!first) {
      return;
    }

    expect(first.transactionDate).toBe('2025-01-03');
    expect(first.amount).toBe(-125.5);
    expect(first.normalizedComparisonTokens).toContain('ACME');
    expect(first.normalizedReferenceTokens).toContain('REF');
    expect(first.dataQualityIssues).toEqual([]);
  });

  it('flags zero-amount and malformed rows as data quality issues', () => {
    const normalized = normalizeTransactions(
      'run-2',
      [
        {
          ...baseRow,
          id: 'row-2',
          amountRaw: '0',
          debitRaw: '',
          descriptionRaw: '',
          merchantNameRaw: '',
          payeeNameRaw: '',
        },
      ],
      {
        ...defaultReconciliationConfig,
        bank: {
          ...defaultReconciliationConfig.bank,
          amountSignConvention: 'signedAmount',
        },
      },
    );
    const [first] = normalized;

    expect(first).toBeDefined();
    if (!first) {
      return;
    }

    expect(first.isZeroAmount).toBe(true);
    expect(first.dataQualityIssues).toEqual(expect.arrayContaining(['Zero amount transaction requires review.']));
  });

  it('parses accounting amount formats like parentheses and DR/CR markers', () => {
    const normalized = normalizeTransactions(
      'run-3',
      [
        {
          ...baseRow,
          id: 'row-paren',
          source: 'gl',
          transactionDateRaw: '2025-01-04',
          amountRaw: '(1,250.40)',
          debitRaw: '',
          creditRaw: '',
        },
        {
          ...baseRow,
          id: 'row-dr',
          source: 'gl',
          transactionDateRaw: '2025-01-05',
          amountRaw: '900 DR',
          debitRaw: '',
          creditRaw: '',
        },
        {
          ...baseRow,
          id: 'row-cr',
          source: 'gl',
          transactionDateRaw: '2025-01-06',
          amountRaw: '900 CR',
          debitRaw: '',
          creditRaw: '',
        },
      ],
      defaultReconciliationConfig,
    );

    const paren = normalized.find((item) => item.rawRowId === 'row-paren');
    const dr = normalized.find((item) => item.rawRowId === 'row-dr');
    const cr = normalized.find((item) => item.rawRowId === 'row-cr');

    expect(paren?.amount).toBe(-1250.4);
    expect(dr?.amount).toBe(-900);
    expect(cr?.amount).toBe(900);
  });

  it('does not mark rows invalid only because narrative fields are sparse', () => {
    const normalized = normalizeTransactions(
      'run-4',
      [
        {
          ...baseRow,
          id: 'row-sparse',
          transactionDateRaw: '2025-02-10',
          descriptionRaw: '',
          merchantNameRaw: '',
          payeeNameRaw: '',
          debitRaw: '45.00',
          creditRaw: '',
        },
      ],
      defaultReconciliationConfig,
    );

    const [first] = normalized;
    expect(first?.dataQualityIssues).toEqual([]);
  });
});
