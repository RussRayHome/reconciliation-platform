import { defaultReconciliationConfig } from '@recon/config';
import { describe, expect, it } from 'vitest';

import { reconcileMatches } from '../matching/engine';
import { validateBankingRows, validateGeneralLedgerRows } from './rowValidators';
import { toNormalizedTransactions } from './toNormalizedTransactions';
import type { RawBankingRow, RawGeneralLedgerRow } from './types';

const bankContext = {
  runId: 'run-1',
  sourceFileId: 'bank-file-1',
  spreadsheetFileName: 'bank.csv',
  config: defaultReconciliationConfig,
};
const glContext = { ...bankContext, sourceFileId: 'gl-file-1', spreadsheetFileName: 'gl.csv' };

describe('toNormalizedTransactions', () => {
  it('maps every field the Matching Engine reads off a Bank NormalizedRecord', () => {
    const bankRow: RawBankingRow = {
      Date: '2026-07-01',
      Description: 'Check 1052 rent',
      'Sequence Number': '42',
      'Check Number': '1052',
      Reference: 'WT-88421',
      Debit: '500.00',
      Balance: '1000.00',
    };
    const { normalized } = validateBankingRows([bankRow]);
    const [transaction] = toNormalizedTransactions(normalized, bankContext);

    expect(transaction).toMatchObject({
      source: 'bank',
      runId: 'run-1',
      sourceFileId: 'bank-file-1',
      spreadsheetFileName: 'bank.csv',
      lineNumber: 1,
      transactionDate: '2026-07-01',
      transactionType: 'debit',
      checkNumber: '1052',
      referenceNumber: 'WT-88421',
      description: 'Check 1052 rent',
      amount: -500,
      debit: 500,
      credit: null,
      runningBalance: 1000,
      isExcluded: false,
      dataQualityIssues: [],
      isZeroAmount: false,
    });
    expect(transaction?.normalizedComparisonTokens.length).toBeGreaterThan(0);
    expect(transaction?.contextFingerprint).toBeTruthy();
  });

  it('maps every field the Matching Engine reads off a GL NormalizedRecord', () => {
    const glRow: RawGeneralLedgerRow = {
      Date: '2026-07-01',
      Type: 'Check',
      Num: '1052',
      Name: 'Landlord LLC',
      Memo: 'Check 1052 rent',
      Amount: '-500.00',
    };
    const { normalized } = validateGeneralLedgerRows([glRow]);
    const [transaction] = toNormalizedTransactions(normalized, glContext);

    expect(transaction).toMatchObject({
      source: 'gl',
      transactionType: 'Check',
      referenceNumber: '1052',
      payeeName: 'Landlord LLC',
      description: 'Check 1052 rent',
      amount: -500,
      debit: 500,
      credit: null,
    });
  });

  it('end-to-end: File Validation output feeds the real, unmodified Matching Engine to a clean match', () => {
    const bankRow: RawBankingRow = {
      Date: '2026-07-01',
      Description: 'Check 1052 rent',
      'Sequence Number': '1',
      'Check Number': '1052',
      Debit: '500.00',
    };
    const glRow: RawGeneralLedgerRow = {
      Date: '2026-07-01',
      Type: 'Check',
      Num: '1052',
      Name: 'Landlord LLC',
      Memo: 'Check 1052 rent',
      Amount: '-500.00',
    };

    const bankNormalized = validateBankingRows([bankRow]).normalized;
    const glNormalized = validateGeneralLedgerRows([glRow]).normalized;

    const transactions = [
      ...toNormalizedTransactions(bankNormalized, bankContext),
      ...toNormalizedTransactions(glNormalized, glContext),
    ];

    const result = reconcileMatches(transactions, defaultReconciliationConfig.matching);

    expect(result.unmatchedBankTransactionIds.size).toBe(0);
    expect(result.unmatchedGlTransactionIds.size).toBe(0);
    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]).toMatchObject({
      disposition: 'ExactMatch',
      bankTransactionId: transactions[0]?.id,
      glTransactionId: transactions[1]?.id,
    });
  });
});
