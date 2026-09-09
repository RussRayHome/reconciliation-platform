import { defaultReconciliationConfig } from '@recon/config';
import { describe, expect, it } from 'vitest';

import { reconcileMatches } from '../matching/engine';
import { validateBankingRows, validateBillingRows, validateGeneralLedgerRows } from './rowValidators';
import {
  toNormalizedTransactions,
  toRawTransactionRows,
  UnreconcilableSourceSystemError,
} from './toNormalizedTransactions';
import type { RawApBillingRow, RawBankingRow, RawGeneralLedgerRow } from './types';

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

  it('maps a row with an ERROR-severity issue into dataQualityIssues instead of dropping it', () => {
    // Blank Memo -- GL_DESCRIPTION_REQUIRED -- no longer excludes the row from `normalized`.
    const glRow: RawGeneralLedgerRow = {
      Date: '2026-07-01',
      Type: 'Check',
      Num: '1052',
      Name: 'Landlord LLC',
      Memo: '',
      Amount: '-500.00',
    };
    const { normalized } = validateGeneralLedgerRows([glRow]);
    expect(normalized).toHaveLength(1);

    const [transaction] = toNormalizedTransactions(normalized, glContext);

    expect(transaction?.dataQualityIssues).toEqual(['GL_DESCRIPTION_REQUIRED: Memo is required']);
  });

  it('does not add a WARNING-severity issue to dataQualityIssues -- the row stays fully eligible for matching', () => {
    const glRow: RawGeneralLedgerRow = {
      Date: '2026-07-01',
      Type: 'Journal Entry',
      Num: '1160',
      Name: '',
      Memo: 'Zero-dollar filler line',
      Amount: '0.00',
    };
    const { normalized } = validateGeneralLedgerRows([glRow]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.issues).toEqual([
      expect.objectContaining({ code: 'GL_AMOUNT_ZERO', severity: 'WARNING' }),
    ]);

    const [transaction] = toNormalizedTransactions(normalized, glContext);

    expect(transaction?.dataQualityIssues).toEqual([]);
  });

  // Issue #381. The old mapping was `sourceSystem === 'BANK' ? 'bank' : 'gl'`, so a BILLING record
  // came out of here labelled `'gl'` -- indistinguishable downstream from a real general-ledger
  // row, in the matching engine, the exception output and `reconciliation_open_item.source_system`
  // alike. Nothing routes billing records through this adapter yet, so these tests are the guard
  // that keeps it that way until Track E decides what an AP side actually means.
  describe('a source system with no reconciliation side (Issue #381)', () => {
    const billingRecord = () => {
      const billingRow: RawApBillingRow = {
        'Entity Id': 'E100',
        'Vendor Id': 'V001',
        'Vendor Name': 'Acme Supplies',
        'Doc Type': 'Bill',
        'Doc No': 'B-1001',
        'Doc Date': '2026-07-01',
        Amount: '500.00',
      };
      const { normalized } = validateBillingRows([billingRow]);
      expect(normalized).toHaveLength(1);
      expect(normalized[0]?.sourceSystem).toBe('BILLING');
      return normalized;
    };

    it('rejects a BILLING record instead of silently labelling it gl', () => {
      const normalized = billingRecord();

      expect(() => toNormalizedTransactions(normalized, glContext)).toThrow(
        UnreconcilableSourceSystemError,
      );
      // The specific guarantee the old code broke: whatever happens, it must never come back 'gl'.
      expect(() => toNormalizedTransactions(normalized, glContext)).toThrow(/BILLING/);
    });

    it('rejects a BILLING record in toRawTransactionRows too -- both entry points map the side', () => {
      expect(() => toRawTransactionRows(billingRecord(), glContext)).toThrow(
        UnreconcilableSourceSystemError,
      );
    });

    it('still maps the two sides that do have a reconciliation meaning', () => {
      const bankRow: RawBankingRow = {
        Date: '2026-07-01',
        Description: 'Deposit',
        'Sequence Number': '1',
        Debit: '',
        Credit: '100.00',
      };
      const glRow: RawGeneralLedgerRow = {
        Date: '2026-07-01',
        Type: 'Deposit',
        Num: '1',
        Name: 'Acme',
        Memo: 'Deposit',
        Amount: '100.00',
      };

      expect(
        toNormalizedTransactions(validateBankingRows([bankRow]).normalized, bankContext)[0]?.source,
      ).toBe('bank');
      expect(
        toNormalizedTransactions(validateGeneralLedgerRows([glRow]).normalized, glContext)[0]
          ?.source,
      ).toBe('gl');
    });
  });
});
