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
  it('prefers the higher-scoring overlapping grouped candidate when one gl batch could satisfy multiple bank anchors', () => {
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
    const glTransactions = [
      buildTransaction({
        id: 'gl-batch-1',
        source: 'gl',
        transactionDate: '2025-10-01',
        transactionType: 'Deposit',
        description: 'Card receipt alpha',
        amount: 100,
      }),
      buildTransaction({
        id: 'gl-batch-2',
        source: 'gl',
        transactionDate: '2025-10-02',
        transactionType: 'Deposit',
        description: 'Card receipt beta',
        amount: 200,
      }),
    ];

    const result = reserveGroupedTransactionIds(
      bankTransactions,
      glTransactions,
      defaultReconciliationConfig.matching,
    );

    expect([...result.reservedBankTransactionIds]).toEqual(['bank-preferred']);
    expect([...result.reservedGlTransactionIds].sort()).toEqual(['gl-batch-1', 'gl-batch-2']);
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
    const glTransactions = [
      buildTransaction({
        id: 'gl-batch-1a',
        source: 'gl',
        transactionDate: '2025-11-01',
        transactionType: 'Deposit',
        description: 'Batch 1 alpha',
        amount: 120,
      }),
      buildTransaction({
        id: 'gl-batch-1b',
        source: 'gl',
        transactionDate: '2025-11-02',
        transactionType: 'Deposit',
        description: 'Batch 1 beta',
        amount: 180,
      }),
      buildTransaction({
        id: 'gl-batch-2a',
        source: 'gl',
        transactionDate: '2025-11-05',
        transactionType: 'Deposit',
        description: 'Batch 2 alpha',
        amount: 70,
      }),
      buildTransaction({
        id: 'gl-batch-2b',
        source: 'gl',
        transactionDate: '2025-11-06',
        transactionType: 'Deposit',
        description: 'Batch 2 beta',
        amount: 110,
      }),
    ];

    const result = reserveGroupedTransactionIds(
      bankTransactions,
      glTransactions,
      defaultReconciliationConfig.matching,
    );

    expect([...result.reservedBankTransactionIds].sort()).toEqual(['bank-batch-1', 'bank-batch-2']);
    expect([...result.reservedGlTransactionIds].sort()).toEqual([
      'gl-batch-1a',
      'gl-batch-1b',
      'gl-batch-2a',
      'gl-batch-2b',
    ]);
  });

  it('reserves a payroll batch when bank debit has a payroll keyword and GL debits sum to it within date tolerance', () => {
    const bankPayroll = buildTransaction({
      id: 'bank-payroll',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-05-15',
      description: 'ADP PAYROLL ACH BATCH 20250515',
      amount: -12500,
    });
    const glPayroll1 = buildTransaction({
      id: 'gl-payroll-1',
      source: 'gl',
      lineNumber: 10,
      transactionDate: '2025-05-15',
      description: 'Salaries - Alice',
      amount: -5000,
    });
    const glPayroll2 = buildTransaction({
      id: 'gl-payroll-2',
      source: 'gl',
      lineNumber: 11,
      transactionDate: '2025-05-15',
      description: 'Salaries - Bob',
      amount: -4500,
    });
    const glPayroll3 = buildTransaction({
      id: 'gl-payroll-3',
      source: 'gl',
      lineNumber: 12,
      transactionDate: '2025-05-15',
      description: 'Salaries - Carol',
      amount: -3000,
    });

    const result = reserveGroupedTransactionIds(
      [bankPayroll],
      [glPayroll1, glPayroll2, glPayroll3],
      defaultReconciliationConfig.matching,
    );

    expect(result.selectedCandidates).toHaveLength(1);
    expect(result.selectedCandidates[0]?.category).toBe('PayrollBatchMatch');
    expect(result.selectedCandidates[0]?.ruleId).toBe('payroll-batch-reserved');
    expect(result.reservedBankTransactionIds.has('bank-payroll')).toBe(true);
    expect(result.reservedGlTransactionIds.has('gl-payroll-1')).toBe(true);
    expect(result.reservedGlTransactionIds.has('gl-payroll-2')).toBe(true);
    expect(result.reservedGlTransactionIds.has('gl-payroll-3')).toBe(true);
  });

  it('reserves a bank service charge when bank debit has a service charge keyword and GL debits sum to it', () => {
    const bankCharge = buildTransaction({
      id: 'bank-svc-charge',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-07-31',
      description: 'MONTHLY SERVICE CHARGE',
      amount: -45,
    });
    const glFee1 = buildTransaction({
      id: 'gl-fee-1',
      source: 'gl',
      lineNumber: 20,
      transactionDate: '2025-07-31',
      description: 'Bank Fees - Maintenance',
      amount: -25,
    });
    const glFee2 = buildTransaction({
      id: 'gl-fee-2',
      source: 'gl',
      lineNumber: 21,
      transactionDate: '2025-07-31',
      description: 'Bank Fees - Transaction',
      amount: -20,
    });

    const result = reserveGroupedTransactionIds(
      [bankCharge],
      [glFee1, glFee2],
      defaultReconciliationConfig.matching,
    );

    expect(result.selectedCandidates).toHaveLength(1);
    expect(result.selectedCandidates[0]?.category).toBe('BankServiceChargeAmortization');
    expect(result.selectedCandidates[0]?.ruleId).toBe('bank-service-charge-reserved');
    expect(result.reservedBankTransactionIds.has('bank-svc-charge')).toBe(true);
    expect(result.reservedGlTransactionIds.has('gl-fee-1')).toBe(true);
    expect(result.reservedGlTransactionIds.has('gl-fee-2')).toBe(true);
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
    const glDebit1 = buildTransaction({
      id: 'gl-debit-1',
      source: 'gl',
      lineNumber: 20,
      transactionDate: '2025-07-31',
      amount: -25,
    });
    const glDebit2 = buildTransaction({
      id: 'gl-debit-2',
      source: 'gl',
      lineNumber: 21,
      transactionDate: '2025-07-31',
      amount: -20,
    });

    const result = reserveGroupedTransactionIds(
      [bankGeneric],
      [glDebit1, glDebit2],
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
    const glLine1 = buildTransaction({
      id: 'gl-line-1',
      source: 'gl',
      lineNumber: 10,
      transactionDate: '2025-05-15',
      amount: -5000,
    });
    const glLine2 = buildTransaction({
      id: 'gl-line-2',
      source: 'gl',
      lineNumber: 11,
      transactionDate: '2025-05-15',
      amount: -7500,
    });

    const result = reserveGroupedTransactionIds(
      [bankGeneric],
      [glLine1, glLine2],
      defaultReconciliationConfig.matching,
    );

    const payrollCandidates = result.selectedCandidates.filter((c) => c.category === 'PayrollBatchMatch');
    expect(payrollCandidates).toHaveLength(0);
  });

  it('does not reserve a bank service charge when GL pool total does not match bank debit amount', () => {
    const bankDebit = buildTransaction({
      id: 'bank-svc-mismatch',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-06-15',
      description: 'MONTHLY SERVICE CHARGE FEE',
      amount: -100,
    });
    const gl1 = buildTransaction({
      id: 'gl-fee-m1',
      source: 'gl',
      lineNumber: 10,
      transactionDate: '2025-06-15',
      amount: -40,
    });
    const gl2 = buildTransaction({
      id: 'gl-fee-m2',
      source: 'gl',
      lineNumber: 11,
      transactionDate: '2025-06-15',
      amount: -40,
    });

    const result = reserveGroupedTransactionIds(
      [bankDebit],
      [gl1, gl2],
      defaultReconciliationConfig.matching,
    );

    expect(result.reservedBankTransactionIds.has('bank-svc-mismatch')).toBe(false);
    expect(result.selectedCandidates.filter((c) => c.category === 'BankServiceChargeAmortization')).toHaveLength(0);
  });

  it('does not reserve a loan payment split when fewer than two GL debits are within the date window', () => {
    const bankDebit = buildTransaction({
      id: 'bank-loan-solo',
      source: 'bank',
      lineNumber: 1,
      transactionDate: '2025-07-01',
      description: 'MORTGAGE PAYMENT WELLS FARGO',
      amount: -1500,
    });
    const glSingle = buildTransaction({
      id: 'gl-loan-only',
      source: 'gl',
      lineNumber: 10,
      transactionDate: '2025-07-01',
      amount: -1500,
    });

    const result = reserveGroupedTransactionIds(
      [bankDebit],
      [glSingle],
      defaultReconciliationConfig.matching,
    );

    expect(result.reservedBankTransactionIds.has('bank-loan-solo')).toBe(false);
    expect(result.selectedCandidates.filter((c) => c.category === 'LoanPaymentSplit')).toHaveLength(0);
  });
});