import type { GroupedMatchResult, MatchResult, NormalizedTransaction, SourceFile } from '@recon/domain';
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
    expect(output.exceptions.some((item) => item.category === 'OutstandingCheck')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies a non-stale QBO check as OutstandingCheck and excludes it from MissingFromBank', () => {
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const anchorBank = buildTransaction({
      id: 'bank-anchor',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 10,
      transactionDate: '2025-04-30',
      amount: -100,
      description: 'Other bank activity',
      normalizedComparisonTokens: ['OTHER', 'BANK'],
    });
    // 20 days before the anchor → within the 45-day window → OutstandingCheck
    const recentCheck = buildTransaction({
      id: 'qbo-recent-check',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 5,
      transactionDate: '2025-04-10',
      transactionType: 'Check',
      checkNumber: '1060',
      amount: -250,
      description: 'Rent check April',
      normalizedComparisonTokens: ['RENT', 'CHECK', 'APRIL'],
    });

    const output = classifyExceptions({
      runId: 'run-outstanding',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [anchorBank, recentCheck],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedQboTransactionIds: new Set<string>(['qbo-recent-check']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const exception = output.exceptions.find((item) => item.category === 'OutstandingCheck');
    expect(exception).toBeDefined();
    expect(exception?.ruleTrace?.ruleId).toBe('outstanding-check');
    expect(exception?.recommendedNextActions).toEqual(
      expect.arrayContaining([
        'Carry as an outstanding item on the reconciliation support schedule and confirm clearance in the next cycle.',
      ]),
    );
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'StaleOutstandingCheck')).toBe(false);
  });

  it('classifies a check at exactly the stale threshold as StaleOutstandingCheck not OutstandingCheck', () => {
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    // anchor: 2025-04-30, check: 2025-03-16 → exactly 45 days → stale
    const anchorBank = buildTransaction({
      id: 'bank-anchor',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 10,
      transactionDate: '2025-04-30',
      amount: -50,
      normalizedComparisonTokens: ['ANCHOR'],
    });
    const staleCheck = buildTransaction({
      id: 'qbo-stale-check',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 3,
      transactionDate: '2025-03-16',
      transactionType: 'Check',
      checkNumber: '1055',
      amount: -300,
      normalizedComparisonTokens: ['STALE', 'CHECK'],
    });

    const output = classifyExceptions({
      runId: 'run-boundary',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [anchorBank, staleCheck],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedQboTransactionIds: new Set<string>(['qbo-stale-check']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.some((item) => item.category === 'StaleOutstandingCheck')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'OutstandingCheck')).toBe(false);
  });

  it('does not classify a QBO debit without check-like signals as OutstandingCheck', () => {
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const anchorBank = buildTransaction({
      id: 'bank-anchor',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 10,
      transactionDate: '2025-04-30',
      amount: -50,
      normalizedComparisonTokens: ['ANCHOR'],
    });
    const nonCheckQbo = buildTransaction({
      id: 'qbo-expense',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 4,
      transactionDate: '2025-04-15',
      transactionType: 'Expense',
      amount: -200,
      description: 'Supplier payment',
      normalizedComparisonTokens: ['SUPPLIER', 'PAYMENT'],
    });

    const output = classifyExceptions({
      runId: 'run-non-check',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [anchorBank, nonCheckQbo],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedQboTransactionIds: new Set<string>(['qbo-expense']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.some((item) => item.category === 'OutstandingCheck')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(true);
  });

  it('does not classify a QBO check with no date as OutstandingCheck (falls to MissingFromBank)', () => {
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const anchorBank = buildTransaction({
      id: 'bank-anchor',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 10,
      transactionDate: '2025-04-30',
      amount: -50,
      normalizedComparisonTokens: ['ANCHOR'],
    });
    // No transactionDate or postingDate → parseIsoDate returns undefined → outstanding check guard returns early
    const undatedCheck = buildTransaction({
      id: 'qbo-undated-check',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 3,
      transactionType: 'Check',
      checkNumber: '1070',
      amount: -180,
      normalizedComparisonTokens: ['CHECK'],
    });

    const output = classifyExceptions({
      runId: 'run-undated-check',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [anchorBank, undatedCheck],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedQboTransactionIds: new Set<string>(['qbo-undated-check']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.some((item) => item.category === 'OutstandingCheck')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(true);
  });

  it('classifies a check-type QBO transaction by transactionType alone as OutstandingCheck', () => {
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const anchorBank = buildTransaction({
      id: 'bank-anchor',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 10,
      transactionDate: '2025-04-30',
      amount: -50,
      normalizedComparisonTokens: ['ANCHOR'],
    });
    const typeOnlyCheck = buildTransaction({
      id: 'qbo-type-check',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 6,
      transactionDate: '2025-04-20',
      transactionType: 'Check',
      amount: -400,
      description: 'Vendor payment',
      normalizedComparisonTokens: ['VENDOR', 'PAYMENT'],
    });

    const output = classifyExceptions({
      runId: 'run-type-check',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [anchorBank, typeOnlyCheck],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedQboTransactionIds: new Set<string>(['qbo-type-check']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.some((item) => item.category === 'OutstandingCheck')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
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
      miscodingItems.every((item) => item.priorRuleTraces?.[0]?.ruleId === 'amount-extended-date-window-match'),
    ).toBe(true);
    expect(
      miscodingItems.every((item) => item.priorRuleTraces?.[0]?.ruleName === 'Amount + Extended Date Window Match'),
    ).toBe(true);
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
        'Check whether the bank transaction was recorded to the correct GL account and period.',
      ]),
    );
    expect(missing?.ruleTrace?.ruleId).toBe('missing-from-qbo');
  });

  it('preserves full grouped counterpart arrays for residual split-combine classifications', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });
    const bankTransaction = buildTransaction({
      id: 'bank-grouped',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 21,
      transactionDate: '2025-03-10',
      transactionType: 'Expense',
      amount: -300,
      description: 'Vendor batch payment',
      normalizedComparisonTokens: ['VENDOR', 'BATCH', 'PAYMENT'],
    });
    const qboTransactionOne = buildTransaction({
      id: 'qbo-grouped-1',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 31,
      transactionDate: '2025-03-10',
      transactionType: 'Expense',
      amount: -100,
      description: 'Vendor batch payment part 1',
      normalizedComparisonTokens: ['VENDOR', 'BATCH', 'PAYMENT'],
    });
    const qboTransactionTwo = buildTransaction({
      id: 'qbo-grouped-2',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 32,
      transactionDate: '2025-03-11',
      transactionType: 'Expense',
      amount: -200,
      description: 'Vendor batch payment part 2',
      normalizedComparisonTokens: ['VENDOR', 'BATCH', 'PAYMENT'],
    });

    const output = classifyExceptions({
      runId: 'run-grouped',
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

    const bankGroupedException = output.exceptions.find((item) => item.id && item.source === 'bank' && item.category === 'LikelySplitCombineIssue');

    expect(bankGroupedException?.ruleTrace?.counterparts).toHaveLength(2);
    expect(bankGroupedException?.ruleTrace?.counterparts?.map((trace) => trace.lineNumber)).toEqual([31, 32]);
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
        transactionDate: '2025-07-15',
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
        transactionDate: '2025-07-15',
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
        transactionDate: '2025-07-15',
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
        transactionDate: '2025-07-15',
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

  it('classifies an unmatched bank debit with chargeback keyword as ChargebackReturn when a matched bank credit of the same amount exists', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });

    const originalCredit = buildTransaction({
      id: 'bank-original-credit',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 1,
      transactionDate: '2025-04-01',
      description: 'SALE SETTLED',
      amount: 500,
    });
    const qboRevenue = buildTransaction({
      id: 'qbo-revenue',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 1,
      transactionDate: '2025-04-01',
      description: 'Sale Revenue',
      amount: 500,
    });
    const chargebackDebit = buildTransaction({
      id: 'bank-chargeback',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 20,
      transactionDate: '2025-05-15',
      description: 'CHARGEBACK DISPUTE REF 9999',
      amount: -500,
    });

    const matchResult = buildMatchResult({
      bankTransactionId: 'bank-original-credit',
      qboTransactionId: 'qbo-revenue',
      disposition: 'ExactMatch',
      exceptionCategory: undefined,
    });

    const output = classifyExceptions({
      runId: 'run-chargeback',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [originalCredit, qboRevenue, chargebackDebit],
      matchResults: [matchResult],
      unmatchedBankTransactionIds: new Set<string>(['bank-chargeback']),
      unmatchedQboTransactionIds: new Set<string>(),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const chargebackException = output.exceptions.find((item) => item.category === 'ChargebackReturn');
    expect(chargebackException).toBeDefined();
    expect(chargebackException?.ruleTrace?.ruleId).toBe('chargeback-return');
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(false);
  });

  it('classifies an unmatched bank credit with interest keyword as InterestIncome instead of MissingFromQBO', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });

    const interestCredit = buildTransaction({
      id: 'bank-interest',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 5,
      transactionDate: '2025-05-31',
      description: 'INTEREST EARNED MONTHLY',
      amount: 12.50,
    });

    const output = classifyExceptions({
      runId: 'run-interest',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [interestCredit],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-interest']),
      unmatchedQboTransactionIds: new Set<string>(),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const interestException = output.exceptions.find((item) => item.category === 'InterestIncome');
    expect(interestException).toBeDefined();
    expect(interestException?.ruleTrace?.ruleId).toBe('interest-income');
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(false);
  });

  it('does not classify a bank debit with interest keyword as InterestIncome — only credits qualify', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });

    const interestDebit = buildTransaction({
      id: 'bank-interest-debit',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 3,
      transactionDate: '2025-05-31',
      description: 'INTEREST CHARGE ON OVERDRAFT',
      amount: -8,
    });

    const output = classifyExceptions({
      runId: 'run-interest-debit',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [interestDebit],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-interest-debit']),
      unmatchedQboTransactionIds: new Set<string>(),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    expect(output.exceptions.some((item) => item.category === 'InterestIncome')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(true);
  });

  it('classifies an unmatched transaction with intercompany keywords as IntercompanyMismatch on both sides', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo', fileName: 'qbo.xlsx' });

    const bankIntercompany = buildTransaction({
      id: 'bank-ico',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      lineNumber: 7,
      transactionDate: '2025-06-01',
      description: 'INTERCOMPANY TRANSFER ENTITY B',
      amount: -25000,
    });
    const qboIntercompany = buildTransaction({
      id: 'qbo-ico',
      source: 'qbo',
      sourceFileId: qboFile.id,
      spreadsheetFileName: qboFile.fileName,
      lineNumber: 8,
      transactionDate: '2025-06-03',
      description: 'Due to Parent Company Settlement',
      amount: -24000,
    });

    const output = classifyExceptions({
      runId: 'run-ico',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankIntercompany, qboIntercompany],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-ico']),
      unmatchedQboTransactionIds: new Set<string>(['qbo-ico']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const bankException = output.exceptions.find((item) => item.id && output.exceptions.find((e) => e.category === 'IntercompanyMismatch' && e.source === 'bank'));
    const intercompanyExceptions = output.exceptions.filter((item) => item.category === 'IntercompanyMismatch');
    expect(intercompanyExceptions).toHaveLength(2);
    expect(intercompanyExceptions.some((item) => item.source === 'bank')).toBe(true);
    expect(intercompanyExceptions.some((item) => item.source === 'qbo')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);

    void bankException;
  });

  const buildGroupedMatchResult = (
    overrides: Partial<GroupedMatchResult> & { bankTransactionIds: string[]; qboTransactionIds: string[] },
  ): GroupedMatchResult => ({
    id: randomUUID(),
    disposition: 'GroupedReviewMatch',
    confidence: 'Probable',
    category: overrides.category,
    bankTransactionIds: overrides.bankTransactionIds,
    qboTransactionIds: overrides.qboTransactionIds,
    bankMembers: [],
    qboMembers: [],
    totalAmount: 0,
    dateDifferenceDays: 0,
    score: 90,
    ruleId: overrides.ruleId ?? 'fee-netting-reserved',
    ruleName: overrides.ruleName ?? 'Fee Netting Candidate',
    reason: overrides.reason ?? 'Test grouped reason.',
    evidence: overrides.evidence ?? ['Test evidence.'],
  });

  it('classifies engine-reserved FeeNettingMatch groups and excludes members from MissingFromQBO/MissingFromBank', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo' });
    const bankTx = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: 93.17, lineNumber: 2 });
    const qboRevenue = buildTransaction({ id: 'qbo-1', source: 'qbo', sourceFileId: 'qbo-file', amount: 101.80, lineNumber: 2 });
    const qboFee = buildTransaction({ id: 'qbo-2', source: 'qbo', sourceFileId: 'qbo-file', amount: -8.63, lineNumber: 3 });

    const grouped = buildGroupedMatchResult({
      category: 'FeeNettingMatch',
      ruleId: 'fee-netting-reserved',
      ruleName: 'Fee Netting Candidate',
      bankTransactionIds: [bankTx.id],
      qboTransactionIds: [qboRevenue.id, qboFee.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTx, qboRevenue, qboFee],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedQboTransactionIds: new Set([qboRevenue.id, qboFee.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    const feeNettingExceptions = output.exceptions.filter((e) => e.category === 'FeeNettingMatch');
    expect(feeNettingExceptions).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromQBO')).toBe(false);
  });

  it('classifies engine-reserved PartialPaymentMatch groups and excludes members from MissingFromBank', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo' });
    const bank1 = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: -150.75, lineNumber: 2 });
    const bank2 = buildTransaction({ id: 'bank-2', source: 'bank', sourceFileId: 'bank-file', amount: -150.75, lineNumber: 3 });
    const qboTx = buildTransaction({ id: 'qbo-1', source: 'qbo', sourceFileId: 'qbo-file', amount: -301.50, lineNumber: 2 });

    const grouped = buildGroupedMatchResult({
      category: 'PartialPaymentMatch',
      ruleId: 'partial-payment-reserved',
      ruleName: 'Partial Payment Candidate',
      bankTransactionIds: [bank1.id, bank2.id],
      qboTransactionIds: [qboTx.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bank1, bank2, qboTx],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bank1.id, bank2.id]),
      unmatchedQboTransactionIds: new Set([qboTx.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    const partialPaymentExceptions = output.exceptions.filter((e) => e.category === 'PartialPaymentMatch');
    expect(partialPaymentExceptions).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromQBO')).toBe(false);
  });

  it('classifies engine-reserved PayrollBatchMatch groups and excludes members from MissingFromBank', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo' });
    const bankTx = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: -5001.00, lineNumber: 2 });
    const qbo1 = buildTransaction({ id: 'qbo-1', source: 'qbo', sourceFileId: 'qbo-file', amount: -3001.00, lineNumber: 2 });
    const qbo2 = buildTransaction({ id: 'qbo-2', source: 'qbo', sourceFileId: 'qbo-file', amount: -2000.00, lineNumber: 3 });

    const grouped = buildGroupedMatchResult({
      category: 'PayrollBatchMatch',
      ruleId: 'payroll-batch-reserved',
      ruleName: 'Payroll Batch Candidate',
      bankTransactionIds: [bankTx.id],
      qboTransactionIds: [qbo1.id, qbo2.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTx, qbo1, qbo2],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedQboTransactionIds: new Set([qbo1.id, qbo2.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    const payrollExceptions = output.exceptions.filter((e) => e.category === 'PayrollBatchMatch');
    expect(payrollExceptions).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromQBO')).toBe(false);
  });

  it('classifies engine-reserved BankServiceChargeAmortization groups and excludes members from MissingFromBank', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo' });
    const bankTx = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: -121.00, lineNumber: 2 });
    const qbo1 = buildTransaction({ id: 'qbo-1', source: 'qbo', sourceFileId: 'qbo-file', amount: -61.00, lineNumber: 2 });
    const qbo2 = buildTransaction({ id: 'qbo-2', source: 'qbo', sourceFileId: 'qbo-file', amount: -60.00, lineNumber: 3 });

    const grouped = buildGroupedMatchResult({
      category: 'BankServiceChargeAmortization',
      ruleId: 'bank-service-charge-reserved',
      ruleName: 'Bank Service Charge Candidate',
      bankTransactionIds: [bankTx.id],
      qboTransactionIds: [qbo1.id, qbo2.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTx, qbo1, qbo2],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedQboTransactionIds: new Set([qbo1.id, qbo2.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    const serviceChargeExceptions = output.exceptions.filter((e) => e.category === 'BankServiceChargeAmortization');
    expect(serviceChargeExceptions).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromQBO')).toBe(false);
  });

  it('classifies LikelySplitCombineIssue via residual grouped stage even when present in groupedMatchResults', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo' });
    const bankTx = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: -300.00, lineNumber: 2, transactionDate: '2025-07-15' });
    const qbo1 = buildTransaction({ id: 'qbo-1', source: 'qbo', sourceFileId: 'qbo-file', amount: -120.00, lineNumber: 2, transactionDate: '2025-07-15' });
    const qbo2 = buildTransaction({ id: 'qbo-2', source: 'qbo', sourceFileId: 'qbo-file', amount: -180.00, lineNumber: 3, transactionDate: '2025-07-16' });

    const grouped = buildGroupedMatchResult({
      category: 'LikelySplitCombineIssue',
      ruleId: 'grouped-split-combine-reserved',
      ruleName: 'Grouped Split/Combine Candidate',
      bankTransactionIds: [bankTx.id],
      qboTransactionIds: [qbo1.id, qbo2.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTx, qbo1, qbo2],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedQboTransactionIds: new Set([qbo1.id, qbo2.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.filter((e) => e.category === 'LikelySplitCombineIssue')).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromQBO')).toBe(false);
  });

  it('classifies engine-reserved LoanPaymentSplit groups and excludes members from MissingFromBank', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo' });
    const bankTx = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: -1250.00, lineNumber: 2, description: 'MORTGAGE PAYMENT' });
    const qbo1 = buildTransaction({ id: 'qbo-1', source: 'qbo', sourceFileId: 'qbo-file', amount: -1000.00, lineNumber: 2 });
    const qbo2 = buildTransaction({ id: 'qbo-2', source: 'qbo', sourceFileId: 'qbo-file', amount: -250.00, lineNumber: 3 });

    const grouped = buildGroupedMatchResult({
      category: 'LoanPaymentSplit',
      ruleId: 'loan-payment-split-reserved',
      ruleName: 'Loan Payment Split Candidate',
      bankTransactionIds: [bankTx.id],
      qboTransactionIds: [qbo1.id, qbo2.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTx, qbo1, qbo2],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedQboTransactionIds: new Set([qbo1.id, qbo2.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.filter((e) => e.category === 'LoanPaymentSplit')).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromQBO')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies NSFReturnedDeposit for unmatched bank debit with NSF keywords', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo' });
    const bankTx = buildTransaction({
      id: 'bank-1',
      source: 'bank',
      sourceFileId: 'bank-file',
      amount: -317.89,
      lineNumber: 2,
      description: 'NSF RETURNED CHECK CUSTOMER ALPHA',
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTx],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedQboTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.filter((e) => e.category === 'NSFReturnedDeposit')).toHaveLength(1);
    expect(output.exceptions.some((e) => e.category === 'MissingFromQBO')).toBe(false);
  });

  it('does not classify ACH return pair as NSFReturnedDeposit', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo' });
    const bankDebit = buildTransaction({
      id: 'bank-1',
      source: 'bank',
      sourceFileId: 'bank-file',
      amount: -300.00,
      lineNumber: 2,
      description: 'ACH DEBIT VENDOR GAMMA',
      transactionDate: '2025-10-10',
    });
    const bankCredit = buildTransaction({
      id: 'bank-2',
      source: 'bank',
      sourceFileId: 'bank-file',
      amount: 300.00,
      lineNumber: 3,
      description: 'NSF RETURN ACH VENDOR GAMMA',
      transactionDate: '2025-10-11',
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankDebit, bankCredit],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankDebit.id, bankCredit.id]),
      unmatchedQboTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.filter((e) => e.category === 'ACHReturn')).toHaveLength(2);
    expect(output.exceptions.some((e) => e.category === 'NSFReturnedDeposit')).toBe(false);
  });

  it('classifies VoidedCheckCleared for unmatched bank check debit with check number', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo' });
    const bankTx = buildTransaction({
      id: 'bank-1',
      source: 'bank',
      sourceFileId: 'bank-file',
      amount: -657.33,
      lineNumber: 2,
      description: 'CHECK',
      checkNumber: '1042',
      transactionDate: '2025-11-12',
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTx],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedQboTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.filter((e) => e.category === 'VoidedCheckCleared')).toHaveLength(1);
    expect(output.exceptions.some((e) => e.category === 'MissingFromQBO')).toBe(false);
  });

  it('does not classify unmatched bank debit without check signal as VoidedCheckCleared', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const qboFile = buildSourceFile({ id: 'qbo-file', source: 'qbo' });
    const bankTx = buildTransaction({
      id: 'bank-1',
      source: 'bank',
      sourceFileId: 'bank-file',
      amount: -200.00,
      lineNumber: 2,
      description: 'VENDOR PAYMENT EFT',
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [bankTx],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedQboTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.some((e) => e.category === 'VoidedCheckCleared')).toBe(false);
    expect(output.exceptions.filter((e) => e.category === 'MissingFromQBO')).toHaveLength(1);
  });

  it('annual mode: skips date-less transactions when computing month coverage gaps', () => {
    const bankFile = buildSourceFile({ id: 'bank-annual-nd', source: 'bank', fileName: 'bank-annual.xlsx' });
    const qboFile = buildSourceFile({ id: 'qbo-annual-nd', source: 'qbo', fileName: 'qbo-annual.xlsx' });

    const dated = buildTransaction({
      id: 'tx-dated',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      transactionDate: '2025-03-10',
      amount: -500,
    });
    const undated = buildTransaction({
      id: 'tx-undated',
      source: 'bank',
      sourceFileId: bankFile.id,
      spreadsheetFileName: bankFile.fileName,
      transactionDate: undefined,
      postingDate: undefined,
      amount: -200,
    });

    const output = classifyExceptions({
      runId: 'run-annual-nodatex',
      sourceFiles: [bankFile, qboFile],
      normalizedTransactions: [dated, undated],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([dated.id, undated.id]),
      unmatchedQboTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Annual',
    });

    const gapObs = output.reviewerObservations.filter((o) => o.title === 'Annual month coverage gap detected');
    expect(gapObs.length).toBeGreaterThan(0);
    const bankGap = gapObs.find((o) => o.message.includes('bank-annual.xlsx'));
    expect(bankGap).toBeDefined();
    expect(bankGap?.message).toContain('Jan');
  });

  it('annual mode: emits no month-coverage observation when all 12 months have transactions', () => {
    const bankFile = buildSourceFile({ id: 'bank-annual-full', source: 'bank', fileName: 'bank-full.xlsx' });

    const allMonths = Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      return buildTransaction({
        id: `tx-m${i + 1}`,
        source: 'bank',
        sourceFileId: bankFile.id,
        spreadsheetFileName: bankFile.fileName,
        transactionDate: `2025-${mm}-15`,
        amount: -(100 + i),
      });
    });

    const output = classifyExceptions({
      runId: 'run-annual-allmonths',
      sourceFiles: [bankFile],
      normalizedTransactions: allMonths,
      matchResults: [],
      unmatchedBankTransactionIds: new Set(allMonths.map((t) => t.id)),
      unmatchedQboTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Annual',
    });

    const gapObs = output.reviewerObservations.filter((o) => o.title === 'Annual month coverage gap detected');
    expect(gapObs).toHaveLength(0);
  });
});