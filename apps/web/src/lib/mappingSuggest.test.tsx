import { describe, expect, it } from 'vitest';

import type { BusinessField, ColumnAliasMap } from '@recon/domain';

import { suggestMapping } from './mappingSuggest';

const FIELDS: BusinessField[] = ['transactionDate', 'description', 'amount', 'accountIdentifier'];

const ALIASES: ColumnAliasMap = {
  transactionDate: [
    'date',
    'transaction date',
    'trans date',
    'posted date',
    'posting date',
    'effective date',
  ],
  postingDate: ['posting date', 'post date'],
  transactionType: ['type'],
  checkNumber: ['check'],
  serialNumber: ['serial'],
  referenceNumber: ['reference'],
  description: ['description', 'memo', 'details', 'narrative'],
  merchantName: ['merchant'],
  payeeName: ['payee'],
  amount: ['amount', 'signed amount', 'transaction amount'],
  splitAmount: ['split amount'],
  debit: ['debit'],
  credit: ['credit'],
  runningBalance: ['balance'],
  accountIdentifier: ['account', 'account number', 'account id'],
};

describe('suggestMapping', () => {
  it('matches a column to a field via an exact alias', () => {
    const result = suggestMapping(['Memo'], ALIASES, FIELDS);
    expect(result).toEqual({ Memo: 'description' });
  });

  it('matches case- and punctuation-insensitively', () => {
    const result = suggestMapping(['TRANSACTION-DATE'], ALIASES, FIELDS);
    expect(result).toEqual({ 'TRANSACTION-DATE': 'transactionDate' });
  });

  it('falls back to a close fuzzy match when there is no exact alias', () => {
    const result = suggestMapping(['Ammount'], ALIASES, FIELDS);
    expect(result).toEqual({ Ammount: 'amount' });
  });

  it('leaves a column unmapped when nothing is close enough', () => {
    const result = suggestMapping(['Zebra Migration Code'], ALIASES, FIELDS);
    expect(result).toEqual({});
  });

  it('never assigns the same canonical field to two different columns', () => {
    const result = suggestMapping(['Amount', 'Amt'], ALIASES, FIELDS);
    expect(Object.values(result).filter((field) => field === 'amount')).toHaveLength(1);
  });

  it('only suggests fields present in availableFields, even when a better alias exists outside it', () => {
    // 'checkNumber' has an exact alias for 'Check Number' in ALIASES but is excluded from FIELDS,
    // so it must never appear as a suggested value, even as a fuzzy fallback.
    const result = suggestMapping(['Check Number'], ALIASES, FIELDS);
    expect(Object.values(result)).not.toContain('checkNumber');
  });
});
