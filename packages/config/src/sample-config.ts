import type { AccountOverrideConfig } from '@recon/domain';

export const sampleAccountOverrides: AccountOverrideConfig[] = [
  {
    accountIdentifier: '5703',
    bank: {
      columnAliases: {
        transactionDate: ['date', 'posted date', 'posting date'],
        description: ['description', 'details', 'memo', 'transaction details'],
        debit: ['debit', 'debits', 'payments and other debits', 'money out'],
        credit: ['credit', 'credits', 'deposits and other credits', 'money in'],
        amount: ['amount', 'transaction amount', 'signed amount'],
        runningBalance: ['balance', 'running balance', 'current balance'],
      },
    },
    qbo: {
      columnAliases: {
        transactionDate: ['date', 'transaction date'],
        referenceNumber: ['num', 'reference', 'ref no'],
        description: ['memo', 'description', 'bank memo'],
        amount: ['amount', 'net amount'],
      },
    },
    matching: {
      dateToleranceDays: 5,
      timingDifferenceDays: 21,
      textSimilarityThreshold: 0.12,
      probableTextSimilarityThreshold: 0.65,
      duplicateDateWindowDays: -1,
      duplicateSimilarityThreshold: 1,
    },
  },
  {
    accountIdentifier: 'OPERATING-001',
    bank: {
      transactionStartRow: 2,
    },
    qbo: {
      transactionStartRow: 2,
      excludeBeginningBalance: true,
      beginningBalancePatterns: ['BEGINNING BALANCE', 'OPENING BALANCE'],
    },
    matching: {
      dateToleranceDays: 5,
      timingDifferenceDays: 21,
      probableTextSimilarityThreshold: 0.5,
    },
  },
  {
    accountIdentifier: 'PAYROLL-002',
    matching: {
      dateToleranceDays: 1,
      timingDifferenceDays: 3,
      duplicateDateWindowDays: 1,
    },
    reporting: {
      severityByCategory: {
        DuplicateInBank: 'Critical',
        DuplicateInQBO: 'Critical',
        AmountMismatch: 'Critical',
      },
    },
  },
];
