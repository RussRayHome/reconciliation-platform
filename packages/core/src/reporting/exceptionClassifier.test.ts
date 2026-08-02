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
  glTransactionId: overrides.glTransactionId,
  dateDifferenceDays: overrides.dateDifferenceDays ?? 2,
  amountDifference: overrides.amountDifference ?? 0,
  evidence: overrides.evidence ?? ['Amounts agree within configured tolerance.'],
  likelyMatchingReference: overrides.likelyMatchingReference,
  exceptionCategory: overrides.exceptionCategory ?? 'DateVariance',
  reviewerNotes: overrides.reviewerNotes,
});

describe('classifyExceptions', () => {
  it('classifies a stale outstanding check at the 45-day threshold and attaches recommended actions', () => {
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const staleGl = buildTransaction({
      id: 'gl-stale',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [anchorBank, staleGl],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedGlTransactionIds: new Set<string>(['gl-stale']),
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
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const glCheck = buildTransaction({
      id: 'gl-check',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 12,
      transactionDate: '2025-03-16',
      transactionType: 'Check',
      checkNumber: '1045',
      amount: -150,
    });

    const output = classifyExceptions({
      runId: 'run-1',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [anchorBank, glCheck],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedGlTransactionIds: new Set<string>(['gl-check']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    expect(output.exceptions.some((item) => item.category === 'StaleOutstandingCheck')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'OutstandingCheck')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies a non-stale GL check as OutstandingCheck and excludes it from MissingFromBank', () => {
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
      id: 'gl-recent-check',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [anchorBank, recentCheck],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedGlTransactionIds: new Set<string>(['gl-recent-check']),
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
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
      id: 'gl-stale-check',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 3,
      transactionDate: '2025-03-16',
      transactionType: 'Check',
      checkNumber: '1055',
      amount: -300,
      normalizedComparisonTokens: ['STALE', 'CHECK'],
    });

    const output = classifyExceptions({
      runId: 'run-boundary',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [anchorBank, staleCheck],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedGlTransactionIds: new Set<string>(['gl-stale-check']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.some((item) => item.category === 'StaleOutstandingCheck')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'OutstandingCheck')).toBe(false);
  });

  it('does not classify a GL debit without check-like signals as OutstandingCheck', () => {
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const nonCheckGl = buildTransaction({
      id: 'gl-expense',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 4,
      transactionDate: '2025-04-15',
      transactionType: 'Expense',
      amount: -200,
      description: 'Supplier payment',
      normalizedComparisonTokens: ['SUPPLIER', 'PAYMENT'],
    });

    const output = classifyExceptions({
      runId: 'run-non-check',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [anchorBank, nonCheckGl],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedGlTransactionIds: new Set<string>(['gl-expense']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.some((item) => item.category === 'OutstandingCheck')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(true);
  });

  it('does not classify a GL check with no date as OutstandingCheck (falls to MissingFromBank)', () => {
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
      id: 'gl-undated-check',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 3,
      transactionType: 'Check',
      checkNumber: '1070',
      amount: -180,
      normalizedComparisonTokens: ['CHECK'],
    });

    const output = classifyExceptions({
      runId: 'run-undated-check',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [anchorBank, undatedCheck],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedGlTransactionIds: new Set<string>(['gl-undated-check']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.some((item) => item.category === 'OutstandingCheck')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(true);
  });

  it('classifies a check-type GL transaction by transactionType alone as OutstandingCheck', () => {
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
      id: 'gl-type-check',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 6,
      transactionDate: '2025-04-20',
      transactionType: 'Check',
      amount: -400,
      description: 'Vendor payment',
      normalizedComparisonTokens: ['VENDOR', 'PAYMENT'],
    });

    const output = classifyExceptions({
      runId: 'run-type-check',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [anchorBank, typeOnlyCheck],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedGlTransactionIds: new Set<string>(['gl-type-check']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.some((item) => item.category === 'OutstandingCheck')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('promotes a weak date variance pair into likely miscoding with counterpart trace and recommended actions', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const glTransaction = buildTransaction({
      id: 'gl-1',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 8,
      transactionDate: '2025-03-11',
      amount: -500,
      description: 'Office supplies',
      payeeName: 'Office Depot',
      normalizedComparisonTokens: ['OFFICE', 'SUPPLIES'],
    });
    const matchResult = buildMatchResult({
      bankTransactionId: bankTransaction.id,
      glTransactionId: glTransaction.id,
      exceptionCategory: 'DateVariance',
      ruleId: 'amount-extended-date-window-match',
      reason: 'Original date variance classification',
    });

    const output = classifyExceptions({
      runId: 'run-2',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTransaction, glTransaction],
      matchResults: [matchResult],
      unmatchedBankTransactionIds: new Set<string>(),
      unmatchedGlTransactionIds: new Set<string>(),
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
        (item) => item.ruleTrace?.counterpart?.spreadsheetFileName === 'bank.xlsx' || item.ruleTrace?.counterpart?.spreadsheetFileName === 'gl.xlsx',
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

  it('attaches recommended next actions to missing-from-gl exceptions', () => {
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
      unmatchedGlTransactionIds: new Set<string>(),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const missing = output.exceptions.find((item) => item.category === 'MissingFromGL');

    expect(missing).toBeDefined();
    expect(missing?.recommendedNextActions).toEqual(
      expect.arrayContaining([
        'Check whether the bank transaction was recorded to the correct GL account and period.',
      ]),
    );
    expect(missing?.ruleTrace?.ruleId).toBe('missing-from-gl');
  });

  it('preserves full grouped counterpart arrays for residual split-combine classifications', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const glTransactionOne = buildTransaction({
      id: 'gl-grouped-1',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 31,
      transactionDate: '2025-03-10',
      transactionType: 'Expense',
      amount: -100,
      description: 'Vendor batch payment part 1',
      normalizedComparisonTokens: ['VENDOR', 'BATCH', 'PAYMENT'],
    });
    const glTransactionTwo = buildTransaction({
      id: 'gl-grouped-2',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 32,
      transactionDate: '2025-03-11',
      transactionType: 'Expense',
      amount: -200,
      description: 'Vendor batch payment part 2',
      normalizedComparisonTokens: ['VENDOR', 'BATCH', 'PAYMENT'],
    });

    const output = classifyExceptions({
      runId: 'run-grouped',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTransaction, glTransactionOne, glTransactionTwo],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-grouped']),
      unmatchedGlTransactionIds: new Set<string>(['gl-grouped-1', 'gl-grouped-2']),
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
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const glTransaction = buildTransaction({
      id: 'gl-timing',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 19,
      transactionDate: '2025-05-18',
      amount: -2400,
      description: 'Payroll processor April batch',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['PAYROLL', 'PROCESSOR', 'APRIL', 'BATCH'],
    });

    const output = classifyExceptions({
      runId: 'run-4',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTransaction, glTransaction],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-timing']),
      unmatchedGlTransactionIds: new Set<string>(['gl-timing']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const timingItems = output.exceptions.filter((item) => item.category === 'TimingDifference');

    expect(timingItems).toHaveLength(2);
    expect(timingItems.every((item) => item.ruleTrace?.ruleId === 'residual-timing-difference')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('prefers stale outstanding check over missing fallback in a mixed residual run', () => {
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const staleGl = buildTransaction({
      id: 'gl-stale-overlap',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankOnlyTransaction, anchorBank, staleGl],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-residual']),
      unmatchedGlTransactionIds: new Set<string>(['gl-stale-overlap']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    expect(output.exceptions.filter((item) => item.category === 'StaleOutstandingCheck')).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromGL')).toHaveLength(1);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies one-to-many residuals as likely split/combine issues before missing fallback', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const glTransactionOne = buildTransaction({
      id: 'gl-grouped-1',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 31,
      transactionDate: '2025-07-15',
      amount: -120,
      description: 'Vendor settlement part 1',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['VENDOR', 'SETTLEMENT', 'PART'],
    });
    const glTransactionTwo = buildTransaction({
      id: 'gl-grouped-2',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 32,
      transactionDate: '2025-07-16',
      amount: -180,
      description: 'Vendor settlement part 2',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['VENDOR', 'SETTLEMENT', 'PART'],
    });

    const output = classifyExceptions({
      runId: 'run-5',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTransaction, glTransactionOne, glTransactionTwo],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-grouped']),
      unmatchedGlTransactionIds: new Set<string>(['gl-grouped-1', 'gl-grouped-2']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const groupedItems = output.exceptions.filter((item) => item.category === 'LikelySplitCombineIssue');

    expect(groupedItems).toHaveLength(3);
    expect(groupedItems.every((item) => item.ruleTrace?.ruleId === 'grouped-split-combine-residual')).toBe(true);
    expect(groupedItems.every((item) => item.ruleTrace?.evidence.some((entry) => entry.includes('bank=withdrawal')))).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies grouped receipt residuals as deposit grouping issues', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const glTransactionOne = buildTransaction({
      id: 'gl-deposit-grouped-1',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 41,
      transactionDate: '2025-08-04',
      amount: 2000,
      description: 'Batch receipt A',
      transactionType: 'Deposit',
      normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
    });
    const glTransactionTwo = buildTransaction({
      id: 'gl-deposit-grouped-2',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 42,
      transactionDate: '2025-08-05',
      amount: 1200,
      description: 'Batch receipt B',
      transactionType: 'Deposit',
      normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
    });

    const output = classifyExceptions({
      runId: 'run-6',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTransaction, glTransactionOne, glTransactionTwo],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-deposit-grouped']),
      unmatchedGlTransactionIds: new Set<string>(['gl-deposit-grouped-1', 'gl-deposit-grouped-2']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const groupedItems = output.exceptions.filter((item) => item.category === 'DepositGroupingIssue');

    expect(groupedItems).toHaveLength(3);
    expect(groupedItems.every((item) => item.ruleTrace?.ruleId === 'grouped-deposit-residual')).toBe(true);
    expect(groupedItems.every((item) => item.ruleTrace?.evidence.some((entry) => entry.includes('bank=deposit')))).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('does not classify grouped near-miss totals as split/combine issues', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const glTransactionOne = buildTransaction({
      id: 'gl-near-miss-1',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 51,
      transactionDate: '2025-07-22',
      amount: -120,
      description: 'Vendor settlement part 1',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['VENDOR', 'SETTLEMENT', 'PART'],
    });
    const glTransactionTwo = buildTransaction({
      id: 'gl-near-miss-2',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 52,
      transactionDate: '2025-07-23',
      amount: -179.97,
      description: 'Vendor settlement part 2',
      transactionType: 'Expense',
      normalizedComparisonTokens: ['VENDOR', 'SETTLEMENT', 'PART'],
    });

    const output = classifyExceptions({
      runId: 'run-7',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTransaction, glTransactionOne, glTransactionTwo],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-near-miss']),
      unmatchedGlTransactionIds: new Set<string>(['gl-near-miss-1', 'gl-near-miss-2']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    expect(output.exceptions.some((item) => item.category === 'LikelySplitCombineIssue')).toBe(false);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromGL')).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromBank')).toHaveLength(2);
  });

  it('does not classify oversized grouped deposits beyond the supported residual group limit', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });
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
    const glTransactions = [
      buildTransaction({
        id: 'gl-oversized-1',
        source: 'gl',
        sourceFileId: glFile.id,
        spreadsheetFileName: glFile.fileName,
        lineNumber: 61,
        transactionDate: '2025-07-15',
        amount: 1000,
        description: 'Batch receipt A',
        transactionType: 'Deposit',
        normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
      }),
      buildTransaction({
        id: 'gl-oversized-2',
        source: 'gl',
        sourceFileId: glFile.id,
        spreadsheetFileName: glFile.fileName,
        lineNumber: 62,
        transactionDate: '2025-07-15',
        amount: 800,
        description: 'Batch receipt B',
        transactionType: 'Deposit',
        normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
      }),
      buildTransaction({
        id: 'gl-oversized-3',
        source: 'gl',
        sourceFileId: glFile.id,
        spreadsheetFileName: glFile.fileName,
        lineNumber: 63,
        transactionDate: '2025-07-15',
        amount: 700,
        description: 'Batch receipt C',
        transactionType: 'Deposit',
        normalizedComparisonTokens: ['BATCH', 'RECEIPT'],
      }),
      buildTransaction({
        id: 'gl-oversized-4',
        source: 'gl',
        sourceFileId: glFile.id,
        spreadsheetFileName: glFile.fileName,
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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTransaction, ...glTransactions],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-oversized-group']),
      unmatchedGlTransactionIds: new Set<string>(glTransactions.map((transaction) => transaction.id)),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    expect(output.exceptions.some((item) => item.category === 'DepositGroupingIssue')).toBe(false);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromGL')).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromBank')).toHaveLength(4);
  });

  it('classifies an unmatched bank debit with chargeback keyword as ChargebackReturn when a matched bank credit of the same amount exists', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });

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
    const glRevenue = buildTransaction({
      id: 'gl-revenue',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
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
      glTransactionId: 'gl-revenue',
      disposition: 'ExactMatch',
      exceptionCategory: undefined,
    });

    const output = classifyExceptions({
      runId: 'run-chargeback',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [originalCredit, glRevenue, chargebackDebit],
      matchResults: [matchResult],
      unmatchedBankTransactionIds: new Set<string>(['bank-chargeback']),
      unmatchedGlTransactionIds: new Set<string>(),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const chargebackException = output.exceptions.find((item) => item.category === 'ChargebackReturn');
    expect(chargebackException).toBeDefined();
    expect(chargebackException?.ruleTrace?.ruleId).toBe('chargeback-return');
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
  });

  it('classifies an unmatched bank credit with interest keyword as InterestIncome instead of MissingFromGL', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });

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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [interestCredit],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-interest']),
      unmatchedGlTransactionIds: new Set<string>(),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const interestException = output.exceptions.find((item) => item.category === 'InterestIncome');
    expect(interestException).toBeDefined();
    expect(interestException?.ruleTrace?.ruleId).toBe('interest-income');
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
  });

  it('does not classify a bank debit with interest keyword as InterestIncome — only credits qualify', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });

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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [interestDebit],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-interest-debit']),
      unmatchedGlTransactionIds: new Set<string>(),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    expect(output.exceptions.some((item) => item.category === 'InterestIncome')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(true);
  });

  it('classifies an unmatched transaction with intercompany keywords as IntercompanyMismatch on both sides', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank', fileName: 'bank.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl', fileName: 'gl.xlsx' });

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
    const glIntercompany = buildTransaction({
      id: 'gl-ico',
      source: 'gl',
      sourceFileId: glFile.id,
      spreadsheetFileName: glFile.fileName,
      lineNumber: 8,
      transactionDate: '2025-06-03',
      description: 'Due to Parent Company Settlement',
      amount: -24000,
    });

    const output = classifyExceptions({
      runId: 'run-ico',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankIntercompany, glIntercompany],
      matchResults: [],
      unmatchedBankTransactionIds: new Set<string>(['bank-ico']),
      unmatchedGlTransactionIds: new Set<string>(['gl-ico']),
      duplicateTransactionIds: new Set<string>(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Monthly',
    });

    const bankException = output.exceptions.find((item) => item.id && output.exceptions.find((e) => e.category === 'IntercompanyMismatch' && e.source === 'bank'));
    const intercompanyExceptions = output.exceptions.filter((item) => item.category === 'IntercompanyMismatch');
    expect(intercompanyExceptions).toHaveLength(2);
    expect(intercompanyExceptions.some((item) => item.source === 'bank')).toBe(true);
    expect(intercompanyExceptions.some((item) => item.source === 'gl')).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);

    void bankException;
  });

  const buildGroupedMatchResult = (
    overrides: Partial<GroupedMatchResult> & { bankTransactionIds: string[]; glTransactionIds: string[] },
  ): GroupedMatchResult => ({
    id: randomUUID(),
    disposition: 'GroupedReviewMatch',
    confidence: 'Probable',
    category: overrides.category,
    bankTransactionIds: overrides.bankTransactionIds,
    glTransactionIds: overrides.glTransactionIds,
    bankMembers: [],
    glMembers: [],
    totalAmount: 0,
    dateDifferenceDays: 0,
    score: 90,
    ruleId: overrides.ruleId ?? 'fee-netting-reserved',
    ruleName: overrides.ruleName ?? 'Fee Netting Candidate',
    reason: overrides.reason ?? 'Test grouped reason.',
    evidence: overrides.evidence ?? ['Test evidence.'],
  });

  it('classifies engine-reserved FeeNettingMatch groups and excludes members from MissingFromGL/MissingFromBank', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl' });
    const bankTx = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: 93.17, lineNumber: 2 });
    const glRevenue = buildTransaction({ id: 'gl-1', source: 'gl', sourceFileId: 'gl-file', amount: 101.80, lineNumber: 2 });
    const glFee = buildTransaction({ id: 'gl-2', source: 'gl', sourceFileId: 'gl-file', amount: -8.63, lineNumber: 3 });

    const grouped = buildGroupedMatchResult({
      category: 'FeeNettingMatch',
      ruleId: 'fee-netting-reserved',
      ruleName: 'Fee Netting Candidate',
      bankTransactionIds: [bankTx.id],
      glTransactionIds: [glRevenue.id, glFee.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTx, glRevenue, glFee],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedGlTransactionIds: new Set([glRevenue.id, glFee.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    const feeNettingExceptions = output.exceptions.filter((e) => e.category === 'FeeNettingMatch');
    expect(feeNettingExceptions).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromGL')).toBe(false);
  });

  it('classifies engine-reserved PartialPaymentMatch groups and excludes members from MissingFromBank', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl' });
    const bank1 = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: -150.75, lineNumber: 2 });
    const bank2 = buildTransaction({ id: 'bank-2', source: 'bank', sourceFileId: 'bank-file', amount: -150.75, lineNumber: 3 });
    const glTx = buildTransaction({ id: 'gl-1', source: 'gl', sourceFileId: 'gl-file', amount: -301.50, lineNumber: 2 });

    const grouped = buildGroupedMatchResult({
      category: 'PartialPaymentMatch',
      ruleId: 'partial-payment-reserved',
      ruleName: 'Partial Payment Candidate',
      bankTransactionIds: [bank1.id, bank2.id],
      glTransactionIds: [glTx.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bank1, bank2, glTx],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bank1.id, bank2.id]),
      unmatchedGlTransactionIds: new Set([glTx.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    const partialPaymentExceptions = output.exceptions.filter((e) => e.category === 'PartialPaymentMatch');
    expect(partialPaymentExceptions).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromGL')).toBe(false);
  });

  it('classifies engine-reserved PayrollBatchMatch groups and excludes members from MissingFromBank', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl' });
    const bankTx = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: -5001.00, lineNumber: 2 });
    const gl1 = buildTransaction({ id: 'gl-1', source: 'gl', sourceFileId: 'gl-file', amount: -3001.00, lineNumber: 2 });
    const gl2 = buildTransaction({ id: 'gl-2', source: 'gl', sourceFileId: 'gl-file', amount: -2000.00, lineNumber: 3 });

    const grouped = buildGroupedMatchResult({
      category: 'PayrollBatchMatch',
      ruleId: 'payroll-batch-reserved',
      ruleName: 'Payroll Batch Candidate',
      bankTransactionIds: [bankTx.id],
      glTransactionIds: [gl1.id, gl2.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTx, gl1, gl2],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedGlTransactionIds: new Set([gl1.id, gl2.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    const payrollExceptions = output.exceptions.filter((e) => e.category === 'PayrollBatchMatch');
    expect(payrollExceptions).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromGL')).toBe(false);
  });

  it('classifies engine-reserved BankServiceChargeAmortization groups and excludes members from MissingFromBank', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl' });
    const bankTx = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: -121.00, lineNumber: 2 });
    const gl1 = buildTransaction({ id: 'gl-1', source: 'gl', sourceFileId: 'gl-file', amount: -61.00, lineNumber: 2 });
    const gl2 = buildTransaction({ id: 'gl-2', source: 'gl', sourceFileId: 'gl-file', amount: -60.00, lineNumber: 3 });

    const grouped = buildGroupedMatchResult({
      category: 'BankServiceChargeAmortization',
      ruleId: 'bank-service-charge-reserved',
      ruleName: 'Bank Service Charge Candidate',
      bankTransactionIds: [bankTx.id],
      glTransactionIds: [gl1.id, gl2.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTx, gl1, gl2],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedGlTransactionIds: new Set([gl1.id, gl2.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    const serviceChargeExceptions = output.exceptions.filter((e) => e.category === 'BankServiceChargeAmortization');
    expect(serviceChargeExceptions).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromGL')).toBe(false);
  });

  it('classifies LikelySplitCombineIssue via residual grouped stage even when present in groupedMatchResults', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl' });
    const bankTx = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: -300.00, lineNumber: 2, transactionDate: '2025-07-15' });
    const gl1 = buildTransaction({ id: 'gl-1', source: 'gl', sourceFileId: 'gl-file', amount: -120.00, lineNumber: 2, transactionDate: '2025-07-15' });
    const gl2 = buildTransaction({ id: 'gl-2', source: 'gl', sourceFileId: 'gl-file', amount: -180.00, lineNumber: 3, transactionDate: '2025-07-16' });

    const grouped = buildGroupedMatchResult({
      category: 'LikelySplitCombineIssue',
      ruleId: 'grouped-split-combine-reserved',
      ruleName: 'Grouped Split/Combine Candidate',
      bankTransactionIds: [bankTx.id],
      glTransactionIds: [gl1.id, gl2.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTx, gl1, gl2],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedGlTransactionIds: new Set([gl1.id, gl2.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.filter((e) => e.category === 'LikelySplitCombineIssue')).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromGL')).toBe(false);
  });

  it('classifies engine-reserved LoanPaymentSplit groups and excludes members from MissingFromBank', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl' });
    const bankTx = buildTransaction({ id: 'bank-1', source: 'bank', sourceFileId: 'bank-file', amount: -1250.00, lineNumber: 2, description: 'MORTGAGE PAYMENT' });
    const gl1 = buildTransaction({ id: 'gl-1', source: 'gl', sourceFileId: 'gl-file', amount: -1000.00, lineNumber: 2 });
    const gl2 = buildTransaction({ id: 'gl-2', source: 'gl', sourceFileId: 'gl-file', amount: -250.00, lineNumber: 3 });

    const grouped = buildGroupedMatchResult({
      category: 'LoanPaymentSplit',
      ruleId: 'loan-payment-split-reserved',
      ruleName: 'Loan Payment Split Candidate',
      bankTransactionIds: [bankTx.id],
      glTransactionIds: [gl1.id, gl2.id],
    });

    const output = classifyExceptions({
      runId: 'test-run',
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTx, gl1, gl2],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedGlTransactionIds: new Set([gl1.id, gl2.id]),
      duplicateTransactionIds: new Set(),
      groupedMatchResults: [grouped],
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.filter((e) => e.category === 'LoanPaymentSplit')).toHaveLength(3);
    expect(output.exceptions.some((e) => e.category === 'MissingFromGL')).toBe(false);
    expect(output.exceptions.some((e) => e.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies NSFReturnedDeposit for unmatched bank debit with NSF keywords', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl' });
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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTx],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedGlTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.filter((e) => e.category === 'NSFReturnedDeposit')).toHaveLength(1);
    expect(output.exceptions.some((e) => e.category === 'MissingFromGL')).toBe(false);
  });

  it('does not classify ACH return pair as NSFReturnedDeposit', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl' });
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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankDebit, bankCredit],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankDebit.id, bankCredit.id]),
      unmatchedGlTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.filter((e) => e.category === 'ACHReturn')).toHaveLength(2);
    expect(output.exceptions.some((e) => e.category === 'NSFReturnedDeposit')).toBe(false);
  });

  it('classifies VoidedCheckCleared for unmatched bank check debit with check number', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl' });
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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTx],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedGlTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.filter((e) => e.category === 'VoidedCheckCleared')).toHaveLength(1);
    expect(output.exceptions.some((e) => e.category === 'MissingFromGL')).toBe(false);
  });

  it('does not classify unmatched bank debit without check signal as VoidedCheckCleared', () => {
    const bankFile = buildSourceFile({ id: 'bank-file', source: 'bank' });
    const glFile = buildSourceFile({ id: 'gl-file', source: 'gl' });
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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [bankTx],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([bankTx.id]),
      unmatchedGlTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
    });

    expect(output.exceptions.some((e) => e.category === 'VoidedCheckCleared')).toBe(false);
    expect(output.exceptions.filter((e) => e.category === 'MissingFromGL')).toHaveLength(1);
  });

  it('annual mode: skips date-less transactions when computing month coverage gaps', () => {
    const bankFile = buildSourceFile({ id: 'bank-annual-nd', source: 'bank', fileName: 'bank-annual.xlsx' });
    const glFile = buildSourceFile({ id: 'gl-annual-nd', source: 'gl', fileName: 'gl-annual.xlsx' });

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
      sourceFiles: [bankFile, glFile],
      normalizedTransactions: [dated, undated],
      matchResults: [],
      unmatchedBankTransactionIds: new Set([dated.id, undated.id]),
      unmatchedGlTransactionIds: new Set(),
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
      unmatchedGlTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      reporting: defaultReconciliationConfig.reporting,
      matching: defaultReconciliationConfig.matching,
      reconciliationFrequency: 'Annual',
    });

    const gapObs = output.reviewerObservations.filter((o) => o.title === 'Annual month coverage gap detected');
    expect(gapObs).toHaveLength(0);
  });
});