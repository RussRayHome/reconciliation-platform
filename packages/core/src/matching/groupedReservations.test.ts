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

  it('reserves a payroll batch when bank debit has a payroll keyword and QBO debits sum to it within date tolerance', () => {
    const bankPayroll = buildTransaction({
      id: 'bank-payroll',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-05-15',
      description: 'ADP PAYROLL ACH BATCH 20250515',
      amount: -12500,
    });
    const qboPayroll1 = buildTransaction({
      id: 'qbo-payroll-1',
      source: 'qbo',
      lineNumber: 10,
      transactionDate: '2025-05-15',
      description: 'Salaries - Alice',
      amount: -5000,
    });
    const qboPayroll2 = buildTransaction({
      id: 'qbo-payroll-2',
      source: 'qbo',
      lineNumber: 11,
      transactionDate: '2025-05-15',
      description: 'Salaries - Bob',
      amount: -4500,
    });
    const qboPayroll3 = buildTransaction({
      id: 'qbo-payroll-3',
      source: 'qbo',
      lineNumber: 12,
      transactionDate: '2025-05-15',
      description: 'Salaries - Carol',
      amount: -3000,
    });

    const result = reserveGroupedTransactionIds(
      [bankPayroll],
      [qboPayroll1, qboPayroll2, qboPayroll3],
      defaultReconciliationConfig.matching,
    );

    expect(result.selectedCandidates).toHaveLength(1);
    expect(result.selectedCandidates[0]?.category).toBe('PayrollBatchMatch');
    expect(result.selectedCandidates[0]?.ruleId).toBe('payroll-batch-reserved');
    expect(result.reservedBankTransactionIds.has('bank-payroll')).toBe(true);
    expect(result.reservedQboTransactionIds.has('qbo-payroll-1')).toBe(true);
    expect(result.reservedQboTransactionIds.has('qbo-payroll-2')).toBe(true);
    expect(result.reservedQboTransactionIds.has('qbo-payroll-3')).toBe(true);
  });

  it('reserves a bank service charge when bank debit has a service charge keyword and QBO debits sum to it', () => {
    const bankCharge = buildTransaction({
      id: 'bank-svc-charge',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-07-31',
      description: 'MONTHLY SERVICE CHARGE',
      amount: -45,
    });
    const qboFee1 = buildTransaction({
      id: 'qbo-fee-1',
      source: 'qbo',
      lineNumber: 20,
      transactionDate: '2025-07-31',
      description: 'Bank Fees - Maintenance',
      amount: -25,
    });
    const qboFee2 = buildTransaction({
      id: 'qbo-fee-2',
      source: 'qbo',
      lineNumber: 21,
      transactionDate: '2025-07-31',
      description: 'Bank Fees - Transaction',
      amount: -20,
    });

    const result = reserveGroupedTransactionIds(
      [bankCharge],
      [qboFee1, qboFee2],
      defaultReconciliationConfig.matching,
    );

    expect(result.selectedCandidates).toHaveLength(1);
    expect(result.selectedCandidates[0]?.category).toBe('BankServiceChargeAmortization');
    expect(result.selectedCandidates[0]?.ruleId).toBe('bank-service-charge-reserved');
    expect(result.reservedBankTransactionIds.has('bank-svc-charge')).toBe(true);
    expect(result.reservedQboTransactionIds.has('qbo-fee-1')).toBe(true);
    expect(result.reservedQboTransactionIds.has('qbo-fee-2')).toBe(true);
  });

  it('does not reserve a bank service charge when the bank description has no service charge signal', () => {
    const bankGeneric = buildTransaction({
      id: 'bank-generic-debit',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-07-31',
      description: 'VENDOR PAYMENT ACH',
      amount: -45,
    });
    const qboDebit1 = buildTransaction({
      id: 'qbo-debit-1',
      source: 'qbo',
      lineNumber: 20,
      transactionDate: '2025-07-31',
      amount: -25,
    });
    const qboDebit2 = buildTransaction({
      id: 'qbo-debit-2',
      source: 'qbo',
      lineNumber: 21,
      transactionDate: '2025-07-31',
      amount: -20,
    });

    const result = reserveGroupedTransactionIds(
      [bankGeneric],
      [qboDebit1, qboDebit2],
      defaultReconciliationConfig.matching,
    );

    const serviceChargeCandidates = result.selectedCandidates.filter(
      (c) => c.category === 'BankServiceChargeAmortization',
    );
    expect(serviceChargeCandidates).toHaveLength(0);
  });

  it('does not emit a payroll batch when the bank description has no payroll signal', () => {
    const bankGeneric = buildTransaction({
      id: 'bank-generic',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-05-15',
      description: 'ACH DEBIT VENDOR PAYMENT',
      amount: -12500,
    });
    const qboLine1 = buildTransaction({
      id: 'qbo-line-1',
      source: 'qbo',
      lineNumber: 10,
      transactionDate: '2025-05-15',
      amount: -5000,
    });
    const qboLine2 = buildTransaction({
      id: 'qbo-line-2',
      source: 'qbo',
      lineNumber: 11,
      transactionDate: '2025-05-15',
      amount: -7500,
    });

    const result = reserveGroupedTransactionIds(
      [bankGeneric],
      [qboLine1, qboLine2],
      defaultReconciliationConfig.matching,
    );

    const payrollCandidates = result.selectedCandidates.filter((c) => c.category === 'PayrollBatchMatch');
    expect(payrollCandidates).toHaveLength(0);
  });

  it('does not reserve a bank service charge when QBO pool total does not match bank debit amount', () => {
    const bankDebit = buildTransaction({
      id: 'bank-svc-mismatch',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-06-15',
      description: 'MONTHLY SERVICE CHARGE FEE',
      amount: -100,
    });
    const qbo1 = buildTransaction({
      id: 'qbo-fee-m1',
      source: 'qbo',
      lineNumber: 10,
      transactionDate: '2025-06-15',
      amount: -40,
    });
    const qbo2 = buildTransaction({
      id: 'qbo-fee-m2',
      source: 'qbo',
      lineNumber: 11,
      transactionDate: '2025-06-15',
      amount: -40,
    });

    const result = reserveGroupedTransactionIds(
      [bankDebit],
      [qbo1, qbo2],
      defaultReconciliationConfig.matching,
    );

    expect(result.reservedBankTransactionIds.has('bank-svc-mismatch')).toBe(false);
    expect(result.selectedCandidates.filter((c) => c.category === 'BankServiceChargeAmortization')).toHaveLength(0);
  });

  it('does not reserve a loan payment split when fewer than two QBO debits are within the date window', () => {
    const bankDebit = buildTransaction({
      id: 'bank-loan-solo',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-07-01',
      description: 'MORTGAGE PAYMENT WELLS FARGO',
      amount: -1500,
    });
    const qboSingle = buildTransaction({
      id: 'qbo-loan-only',
      source: 'qbo',
      lineNumber: 10,
      transactionDate: '2025-07-01',
      amount: -1500,
    });

    const result = reserveGroupedTransactionIds(
      [bankDebit],
      [qboSingle],
      defaultReconciliationConfig.matching,
    );

    expect(result.reservedBankTransactionIds.has('bank-loan-solo')).toBe(false);
    expect(result.selectedCandidates.filter((c) => c.category === 'LoanPaymentSplit')).toHaveLength(0);
  });
});