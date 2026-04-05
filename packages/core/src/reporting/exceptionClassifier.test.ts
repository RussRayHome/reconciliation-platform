import type { MatchResult, NormalizedTransaction, SourceFile } from '@recon/domain';
import { describe, expect, it } from 'vitest';

import { classifyExceptions } from './exceptionClassifier';
import { defaultReconciliationConfig } from '@recon/config';
import { randomUUID } from 'node:crypto';

const buildSourceFile = (overrides: Partial<SourceFile>): SourceFile => ({
  id: overrides.id ?? randomUUID(),
  source: overrides.source ?? 'bank',
  fileName: overrides.fileName ?? 'workbook.xlsx',
  mimeType: overrides.mimeType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  sizeBytes: overrides.sizeBytes ?? 1024,
  worksheetName: overrides.worksheetName ?? 'Sheet1',
  headerRow: overrides.headerRow ?? 1,
  transactionStartRow: overrides.transactionStartRow ?? 2,
  excludedRowNumbers: overrides.excludedRowNumbers ?? [],
  uploadedAt: overrides.uploadedAt ?? new Date().toISOString(),
});

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: overrides.id ?? randomUUID(),
  runId: overrides.runId ?? 'classifier-run',
  rawRowId: overrides.rawRowId ?? `${overrides.id ?? 'row'}-raw`,
  sourceFileId: overrides.sourceFileId ?? `${overrides.source ?? 'bank'}-file`,
  source: overrides.source ?? 'bank',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'workbook.xlsx',
  worksheetName: overrides.worksheetName ?? 'Sheet1',
  lineNumber: overrides.lineNumber ?? 2,
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

const buildMatchResult = (overrides: Partial<MatchResult> = {}): MatchResult => ({
  id: overrides.id ?? randomUUID(),
  disposition: overrides.disposition ?? 'DateVariance',
  confidence: overrides.confidence ?? 'DateVariance',
  ruleId: overrides.ruleId,
  ruleName: overrides.ruleName ?? 'Amount + Extended Date Window Match',
  reason: overrides.reason,
  score: overrides.score ?? 0.82,
  bankTransactionId: overrides.bankTransactionId,
  qboTransactionId: overrides.qboTransactionId,
  dateDifferenceDays: overrides.dateDifferenceDays ?? 2,
  amountDifference: overrides.amountDifference ?? 0,
  evidence: overrides.evidence ?? ['Amounts agree within configured tolerance.'],
  likelyMatchingReference: overrides.likelyMatchingReference,
  exceptionCategory: overrides.exceptionCategory ?? 'DateVariance',
  reviewerNotes: overrides.reviewerNotes,
});

describe('classifyExceptions', () => {
  it('classifies a stale outstanding check at the 45-day threshold and attaches recommended actions', () => {
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const anchorBank = buildTransaction({
      id: 'bank-anchor',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 10,
      transactionDate: '2025-04-30',
      amount: -25,
      description: 'Anchor activity',
      normalizedComparisonTokens: ['ANCHOR', 'ACTIVITY'],
    });
    const staleQbo = buildTransaction({
      id: 'qbo-stale',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 12,
      transactionDate: '2025-03-16',
      transactionType: 'Check',
      checkNumber: '1045',
      amount: -150,
      description: 'Uncleared check',
      normalizedComparisonTokens: ['UNCLEARED', 'CHECK'],
    });

    const output = classifyExceptions({
      runId: 'run-1',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [anchorBank, staleQbo],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedQboTransactionIds: new Set<string>(['qbo-stale']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const exception = output.exceptions.find((item) => item.category === 'StaleOutstandingCheck');

    expect(exception).toBeDefined();
    expect(exception?.ruleTrace?.ruleId).toBe('stale-outstanding-check');
    expect(exception?.recommendedNextActions).toEqual(
      expect.arrayContaining([
        'Determine whether the check should be voided, reissued, or left outstanding based on current status.',
      ]),
    );
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('does not classify a check as stale before the threshold', () => {
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const anchorBank = buildTransaction({
      id: 'bank-anchor',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 10,
      transactionDate: '2025-04-29',
      amount: -25,
    });
    const qboCheck = buildTransaction({
      id: 'qbo-check',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 12,
      transactionDate: '2025-03-16',
      transactionType: 'Check',
      checkNumber: '1045',
      amount: -150,
    });

    const output = classifyExceptions({
      runId: 'run-1',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [anchorBank, qboCheck],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedQboTransactionIds: new Set<string>(['qbo-check']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    expect(output.exceptions.some((item) => item.category === 'StaleOutstandingCheck')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(true);
  });

  it('promotes a weak date variance pair into likely miscoding with counterpart trace and recommended actions', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankTransaction = buildTransaction({
      id: 'bank-1',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 5,
      transactionDate: '2025-03-10',
      amount: -500,
      description: 'ACME PAYROLL',
      normalizedComparisonTokens: ['ACME', 'PAYROLL'],
    });
    const qboTransaction = buildTransaction({
      id: 'qbo-1',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 8,
      transactionDate: '2025-03-11',
      amount: -500,
      description: 'Office supplies',
      payeeName: 'Office Depot',
      normalizedComparisonTokens: ['OFFICE', 'SUPPLIES'],
    });
    const matchResult = buildMatchResult({
      bankTransactionId: bankTransaction.id,
      qboTransactionId: qboTransaction.id,
      exceptionCategory: 'DateVariance',
      ruleId: 'amount-extended-date-window-match',
      reason: 'Original date variance classification',
    });

    const output = classifyExceptions({
      runId: 'run-2',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTransaction, qboTransaction],
      matchResults: [matchResult],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedQboTransactionIds: new Set<string>(),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const miscodingItems = output.exceptions.filter((item) => item.category === 'LikelyMiscoding');

    expect(miscodingItems).toHaveLength(2);
    expect(miscodingItems.every((item) => item.ruleTrace?.ruleId === 'likely-miscoding')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'DateVariance')).toBe(false);
    expect(
      miscodingItems.every(
        (item) => item.ruleTrace?.counterpart?.spreadsheetFileName === 'bank.xlsx' || item.ruleTrace?.counterpart?.spreadsheetFileName === 'qbo.xlsx',
      ),
    ).toBe(true);
    expect(
      miscodingItems.every((item) =>
        item.recommendedNextActions.includes(
          'Review both source lines to determine whether the transaction was posted to the wrong vendor, customer, or account.',
        ),
      ),
    ).toBe(true);
  });

  it('attaches recommended next actions to missing-from-qbo exceptions', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const bankTransaction = buildTransaction({
      id: 'bank-1',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 3,
      transactionDate: '2025-03-10',
      amount: -125,
      description: 'Vendor payment',
      normalizedComparisonTokens: ['VENDOR', 'PAYMENT'],
    });

    const output = classifyExceptions({
      runId: 'run-3',
      sourceFiles: [bankFile],
      normalizedTransactions: [bankTransaction],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-1']),
      unmatchedQboTransactionIds: new Set<string>(),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const missing = output.exceptions.find((item) => item.category === 'MissingFromQBO');

    expect(missing).toBeDefined();
    expect(missing?.recommendedNextActions).toEqual(
      expect.arrayContaining([
        'Check whether the bank transaction was recorded to the correct QBO account and period.',
      ]),
    );
    expect(missing?.ruleTrace?.ruleId).toBe('missing-from-qbo');
  });

  it('classifies unmatched same-amount residuals as timing differences before missing-item fallback', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankTransaction = buildTransaction({
      id: 'bank-timing',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 14,
      transactionDate: '2025-05-01',
      amount: -2400,
      description: 'PAYROLL PROCESSOR APRIL BATCH',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['PAYROLL', 'PROCESSOR', 'APRIL', 'BATCH'],
    });
    const qboTransaction = buildTransaction({
      id: 'qbo-timing',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 19,
      transactionDate: '2025-05-18',
      amount: -2400,
      description: 'Payroll processor April batch',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['PAYROLL', 'PROCESSOR', 'APRIL', 'BATCH'],
    });

    const output = classifyExceptions({
      runId: 'run-4',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTransaction, qboTransaction],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-timing']),
      unmatchedQboTransactionIds: new Set<string>(['qbo-timing']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const timingItems = output.exceptions.filter((item) => item.category === 'TimingDifference');

    expect(timingItems).toHaveLength(2);
    expect(timingItems.every((item) => item.ruleTrace?.ruleId === 'residual-timing-difference')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('prefers stale outstanding check over missing fallback in a mixed residual run', () => {
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const bankOnlyTransaction = buildTransaction({
      id: 'bank-residual',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 15,
      transactionDate: '2025-03-15',
      amount: -45,
      description: 'UNBOOKED BANK FEE',
      normalizedComparisonTokens: ['UNBOOKED', 'BANK', 'FEE'],
    });
    const anchorBank = buildTransaction({
      id: 'bank-anchor',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 16,
      transactionDate: '2025-04-30',
      amount: -100,
      description: 'MONTH-END ACTIVITY',
      normalizedComparisonTokens: ['MONTH', 'END', 'ACTIVITY'],
    });
    const staleQbo = buildTransaction({
      id: 'qbo-stale-overlap',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 17,
      transactionDate: '2025-03-16',
      transactionType: 'Check',
      checkNumber: '1045',
      amount: -150,
      description: 'Uncleared check',
      normalizedComparisonTokens: ['UNCLEARED', 'CHECK'],
    });

    const output = classifyExceptions({
      runId: 'run-8',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankOnlyTransaction, anchorBank, staleQbo],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-residual']),
      unmatchedQboTransactionIds: new Set<string>(['qbo-stale-overlap']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    expect(output.exceptions.filter((item) => item.category === 'StaleOutstandingCheck')).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromQBO')).toHaveLength(1);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies one-to-many residuals as likely split/combine issues before missing fallback', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankTransaction = buildTransaction({
      id: 'bank-grouped',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 30,
      transactionDate: '2025-07-15',
      amount: -300,
      description: 'VENDOR SETTLEMENT BATCH',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['VENDOR', 'SETTLEMENT', 'BATCH'],
    });
    const qboTransactionOne = buildTransaction({
      id: 'qbo-grouped-1',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 31,
      transactionDate: '2025-07-15',
      amount: -120,
      description: 'Vendor settlement part 1',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['VENDOR', 'SETTLEMENT', 'PART'],
    });
    const qboTransactionTwo = buildTransaction({
      id: 'qbo-grouped-2',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 32,
      transactionDate: '2025-07-16',
      amount: -180,
      description: 'Vendor settlement part 2',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['VENDOR', 'SETTLEMENT', 'PART'],
    });

    const output = classifyExceptions({
      runId: 'run-5',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTransaction, qboTransactionOne, qboTransactionTwo],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-grouped']),
      unmatchedQboTransactionIds: new Set<string>(['qbo-grouped-1', 'qbo-grouped-2']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const groupedItems = output.exceptions.filter((item) => item.category === 'LikelySplitCombineIssue');

    expect(groupedItems).toHaveLength(3);
    expect(groupedItems.every((item) => item.ruleTrace?.ruleId === 'grouped-split-combine-residual')).toBe(true);
    expect(groupedItems.every((item) => item.ruleTrace?.evidence.some((entry) => entry.includes('bank=withdrawal')))).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies grouped receipt residuals as deposit grouping issues', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankTransaction = buildTransaction({
      id: 'bank-deposit-grouped',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 40,
      transactionDate: '2025-08-05',
      amount: 3200,
      description: 'MERCHANT SERVICES BATCH DEPOSIT',
      transactionType: 'Deposit',
      normalizedComparisonTokens: ['MERCHANT', 'SERVICES', 'BATCH', 'DEPOSIT'],
    });
    const qboTransactionOne = buildTransaction({
      id: 'qbo-deposit-grouped-1',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 41,
      transactionDate: '2025-08-04',
      amount: 2000,
      description: 'Batch receipt A',
      transactionType: 'Deposit',
      normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
    });
    const qboTransactionTwo = buildTransaction({
      id: 'qbo-deposit-grouped-2',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 42,
      transactionDate: '2025-08-05',
      amount: 1200,
      description: 'Batch receipt B',
      transactionType: 'Deposit',
      normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
    });

    const output = classifyExceptions({
      runId: 'run-6',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTransaction, qboTransactionOne, qboTransactionTwo],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-deposit-grouped']),
      unmatchedQboTransactionIds: new Set<string>(['qbo-deposit-grouped-1', 'qbo-deposit-grouped-2']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const groupedItems = output.exceptions.filter((item) => item.category === 'DepositGroupingIssue');

    expect(groupedItems).toHaveLength(3);
    expect(groupedItems.every((item) => item.ruleTrace?.ruleId === 'grouped-deposit-residual')).toBe(true);
    expect(groupedItems.every((item) => item.ruleTrace?.evidence.some((entry) => entry.includes('bank=deposit')))).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('does not classify grouped near-miss totals as split/combine issues', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankTransaction = buildTransaction({
      id: 'bank-near-miss',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 50,
      transactionDate: '2025-07-22',
      amount: -300,
      description: 'VENDOR SETTLEMENT BATCH',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['VENDOR', 'SETTLEMENT', 'BATCH'],
    });
    const qboTransactionOne = buildTransaction({
      id: 'qbo-near-miss-1',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 51,
      transactionDate: '2025-07-22',
      amount: -120,
      description: 'Vendor settlement part 1',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['VENDOR', 'SETTLEMENT', 'PART'],
    });
    const qboTransactionTwo = buildTransaction({
      id: 'qbo-near-miss-2',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 52,
      transactionDate: '2025-07-23',
      amount: -179.97,
      description: 'Vendor settlement part 2',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['VENDOR', 'SETTLEMENT', 'PART'],
    });

    const output = classifyExceptions({
      runId: 'run-7',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTransaction, qboTransactionOne, qboTransactionTwo],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-near-miss']),
      unmatchedQboTransactionIds: new Set<string>(['qbo-near-miss-1', 'qbo-near-miss-2']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    expect(output.exceptions.some((item) => item.category === 'LikelySplitCombineIssue')).toBe(false);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromQBO')).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromBank')).toHaveLength(2);
  });

  it('does not classify oversized grouped deposits beyond the supported residual group limit', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankTransaction = buildTransaction({
      id: 'bank-oversized-group',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 60,
      transactionDate: '2025-08-12',
      amount: 3200,
      description: 'MERCHANT SERVICES BATCH DEPOSIT',
      transactionType: 'Deposit',
      normalizedComparisonTokens: ['MERCHANT', 'SERVICES', 'BATCH', 'DEPOSIT'],
    });
    const qboTransactions = [
      buildTransaction({
        id: 'qbo-oversized-1',
        source: 'qbo',
        sourceFileId: qboFile.id,
        spreadsheetFileName: qboFile.fileName,
        lineNumber: 61,
        transactionDate: '2025-08-11',
        amount: 1000,
        description: 'Batch receipt A',
        transactionType: 'Deposit',
        normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
      }),
      buildTransaction({
        id: 'qbo-oversized-2',
        source: 'qbo',
        sourceFileId: qboFile.id,
        spreadsheetFileName: qboFile.fileName,
        lineNumber: 62,
        transactionDate: '2025-08-12',
        amount: 800,
        description: 'Batch receipt B',
        transactionType: 'Deposit',
        normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
      }),
      buildTransaction({
        id: 'qbo-oversized-3',
        source: 'qbo',
        sourceFileId: qboFile.id,
        spreadsheetFileName: qboFile.fileName,
        lineNumber: 63,
        transactionDate: '2025-08-12',
        amount: 700,
        description: 'Batch receipt C',
        transactionType: 'Deposit',
        normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
      }),
      buildTransaction({
        id: 'qbo-oversized-4',
        source: 'qbo',
        sourceFileId: qboFile.id,
        spreadsheetFileName: qboFile.fileName,
        lineNumber: 64,
        transactionDate: '2025-08-12',
        amount: 700,
        description: 'Batch receipt D',
        transactionType: 'Deposit',
        normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
      }),
    ];

    const output = classifyExceptions({
      runId: 'run-8',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTransaction, ...qboTransactions],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-oversized-group']),
      unmatchedQboTransactionIds: new Set<string>(qboTransactions.map((transaction) => transaction.id)),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    expect(output.exceptions.some((item) => item.category === 'DepositGroupingIssue')).toBe(false);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromQBO')).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromBank')).toHaveLength(4);
  });
});