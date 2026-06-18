import {
  ambiguousBankRows,
  ambiguousQboRows,
  amountMismatchBankRows,
  amountMismatchQboRows,
  createWorkbookFromRows,
  dateVarianceBankRows,
  dateVarianceQboRows,
  depositGroupingBankRows,
  depositGroupingOversizedBankRows,
  depositGroupingOversizedQboRows,
  depositGroupingQboRows,
  descriptionVarianceBankRows,
  descriptionVarianceQboRows,
  duplicateInBankBankRows,
  duplicateInBankQboRows,
  duplicateInQboBankRows,
  duplicateInQboQboRows,
  invalidDataBankRows,
  invalidDataQboRows,
  likelyMiscodingBankRows,
  likelyMiscodingQboRows,
  missingFromBankBankRows,
  missingFromBankQboRows,
  missingFromQboBankRows,
  missingFromQboQboRows,
  referenceMismatchBankRows,
  referenceMismatchQboRows,
  referenceNumberMismatchBankRows,
  referenceNumberMismatchQboRows,
  splitCombineBankRows,
  splitCombineNearMissBankRows,
  splitCombineNearMissQboRows,
  splitCombineQboRows,
  staleOutstandingBankRows,
  staleOutstandingBelowThresholdBankRows,
  staleOutstandingBelowThresholdQboRows,
  staleOutstandingMixedResidualBankRows,
  staleOutstandingMixedResidualQboRows,
  staleOutstandingQboRows,
  timingDifferenceBankRows,
  timingDifferenceQboRows,
  reversalVoidBankRows,
  reversalVoidQboRows,
  achReturnBankRows,
  achReturnQboRows,
  depositInTransitBankRows,
  depositInTransitQboRows,
  chargebackReturnBankRows,
  chargebackReturnQboRows,
  interestIncomeBankRows,
  interestIncomeQboRows,
  intercompanyMismatchBankRows,
  intercompanyMismatchQboRows,
  outstandingCheckBankRows,
  outstandingCheckQboRows,
  feeNettingMatchBankRows,
  feeNettingMatchQboRows,
  partialPaymentMatchBankRows,
  partialPaymentMatchQboRows,
  payrollBatchMatchBankRows,
  payrollBatchMatchQboRows,
  bankServiceChargeAmortizationBankRows,
  bankServiceChargeAmortizationQboRows,
  loanPaymentSplitBankRows,
  loanPaymentSplitQboRows,
  nsfReturnedDepositBankRows,
  nsfReturnedDepositQboRows,
  voidedCheckClearedBankRows,
  voidedCheckClearedQboRows,
} from './sampleRows';

import type { ErrorCategory } from '@recon/domain';

/** Raw spreadsheet rows: each outer array is a row, each inner element is a cell value. */
export type WorkbookRows = Array<Array<string | number>>;

/** Fixture for a single exception scenario: one expected category with an expected occurrence count. */
export interface ExceptionScenarioFixture {
  name: string;
  expectedCategory: ErrorCategory;
  expectedCount: number;
  bankRows: WorkbookRows;
  qboRows: WorkbookRows;
}

/** Fixture for an exception edge case that may produce multiple categories or none at all. */
export interface ExceptionEdgeCaseFixture {
  name: string;
  bankRows: WorkbookRows;
  qboRows: WorkbookRows;
  expectedPresent: Array<{ category: ErrorCategory; count: number }>;
  expectedAbsent: ErrorCategory[];
}

/** Fixture for verifying classification precedence: some categories must be present, others must not. */
export interface ExceptionPrecedenceFixture {
  name: string;
  bankRows: WorkbookRows;
  qboRows: WorkbookRows;
  expectedPresent: Array<{ category: ErrorCategory; count: number }>;
  expectedAbsent: ErrorCategory[];
}

/** All single-category exception scenario fixtures, one per `ErrorCategory`. */
export const exceptionScenarioFixtures: ExceptionScenarioFixture[] = [
  {
    name: 'missing-from-qbo',
    expectedCategory: 'MissingFromQBO',
    expectedCount: 1,
    bankRows: missingFromQboBankRows,
    qboRows: missingFromQboQboRows,
  },
  {
    name: 'missing-from-bank',
    expectedCategory: 'MissingFromBank',
    expectedCount: 1,
    bankRows: missingFromBankBankRows,
    qboRows: missingFromBankQboRows,
  },
  {
    name: 'amount-mismatch',
    expectedCategory: 'AmountMismatch',
    expectedCount: 1,
    bankRows: amountMismatchBankRows,
    qboRows: amountMismatchQboRows,
  },
  {
    name: 'duplicate-in-bank',
    expectedCategory: 'DuplicateInBank',
    expectedCount: 1,
    bankRows: duplicateInBankBankRows,
    qboRows: duplicateInBankQboRows,
  },
  {
    name: 'duplicate-in-qbo',
    expectedCategory: 'DuplicateInQBO',
    expectedCount: 1,
    bankRows: duplicateInQboBankRows,
    qboRows: duplicateInQboQboRows,
  },
  {
    name: 'likely-split-combine-issue',
    expectedCategory: 'LikelySplitCombineIssue',
    expectedCount: 3,
    bankRows: splitCombineBankRows,
    qboRows: splitCombineQboRows,
  },
  {
    name: 'deposit-grouping-issue',
    expectedCategory: 'DepositGroupingIssue',
    expectedCount: 3,
    bankRows: depositGroupingBankRows,
    qboRows: depositGroupingQboRows,
  },
  {
    name: 'likely-miscoding',
    expectedCategory: 'LikelyMiscoding',
    expectedCount: 2,
    bankRows: likelyMiscodingBankRows,
    qboRows: likelyMiscodingQboRows,
  },
  {
    name: 'date-variance',
    expectedCategory: 'DateVariance',
    expectedCount: 1,
    bankRows: dateVarianceBankRows,
    qboRows: dateVarianceQboRows,
  },
  {
    name: 'timing-difference',
    expectedCategory: 'TimingDifference',
    expectedCount: 2,
    bankRows: timingDifferenceBankRows,
    qboRows: timingDifferenceQboRows,
  },
  {
    name: 'check-number-mismatch',
    expectedCategory: 'CheckNumberMismatch',
    expectedCount: 1,
    bankRows: referenceMismatchBankRows,
    qboRows: referenceMismatchQboRows,
  },
  {
    name: 'reference-number-mismatch',
    expectedCategory: 'ReferenceNumberMismatch',
    expectedCount: 1,
    bankRows: referenceNumberMismatchBankRows,
    qboRows: referenceNumberMismatchQboRows,
  },
  {
    name: 'description-merchant-variance',
    expectedCategory: 'DescriptionMerchantVariance',
    expectedCount: 1,
    bankRows: descriptionVarianceBankRows,
    qboRows: descriptionVarianceQboRows,
  },
  {
    name: 'stale-outstanding-check',
    expectedCategory: 'StaleOutstandingCheck',
    expectedCount: 1,
    bankRows: staleOutstandingBankRows,
    qboRows: staleOutstandingQboRows,
  },
  {
    name: 'outstanding-check',
    expectedCategory: 'OutstandingCheck',
    expectedCount: 1,
    bankRows: outstandingCheckBankRows,
    qboRows: outstandingCheckQboRows,
  },
  {
    name: 'fee-netting-match',
    expectedCategory: 'FeeNettingMatch',
    expectedCount: 3,
    bankRows: feeNettingMatchBankRows,
    qboRows: feeNettingMatchQboRows,
  },
  {
    name: 'partial-payment-match',
    expectedCategory: 'PartialPaymentMatch',
    expectedCount: 3,
    bankRows: partialPaymentMatchBankRows,
    qboRows: partialPaymentMatchQboRows,
  },
  {
    name: 'payroll-batch-match',
    expectedCategory: 'PayrollBatchMatch',
    expectedCount: 3,
    bankRows: payrollBatchMatchBankRows,
    qboRows: payrollBatchMatchQboRows,
  },
  {
    name: 'bank-service-charge-amortization',
    expectedCategory: 'BankServiceChargeAmortization',
    expectedCount: 3,
    bankRows: bankServiceChargeAmortizationBankRows,
    qboRows: bankServiceChargeAmortizationQboRows,
  },
  {
    name: 'loan-payment-split',
    expectedCategory: 'LoanPaymentSplit',
    expectedCount: 3,
    bankRows: loanPaymentSplitBankRows,
    qboRows: loanPaymentSplitQboRows,
  },
  {
    name: 'nsf-returned-deposit',
    expectedCategory: 'NSFReturnedDeposit',
    expectedCount: 1,
    bankRows: nsfReturnedDepositBankRows,
    qboRows: nsfReturnedDepositQboRows,
  },
  {
    name: 'voided-check-cleared',
    expectedCategory: 'VoidedCheckCleared',
    expectedCount: 1,
    bankRows: voidedCheckClearedBankRows,
    qboRows: voidedCheckClearedQboRows,
  },
  {
    name: 'invalid-or-missing-data',
    expectedCategory: 'InvalidOrMissingData',
    expectedCount: 1,
    bankRows: invalidDataBankRows,
    qboRows: invalidDataQboRows,
  },
  {
    name: 'ambiguous-match-requiring-review',
    expectedCategory: 'AmbiguousMatchRequiringReview',
    expectedCount: 1,
    bankRows: ambiguousBankRows,
    qboRows: ambiguousQboRows,
  },
  {
    name: 'reversal-void',
    expectedCategory: 'ReversalVoid',
    expectedCount: 2,
    bankRows: reversalVoidBankRows,
    qboRows: reversalVoidQboRows,
  },
  {
    name: 'ach-return',
    expectedCategory: 'ACHReturn',
    expectedCount: 2,
    bankRows: achReturnBankRows,
    qboRows: achReturnQboRows,
  },
  {
    name: 'deposit-in-transit',
    expectedCategory: 'DepositInTransit',
    expectedCount: 1,
    bankRows: depositInTransitBankRows,
    qboRows: depositInTransitQboRows,
  },
  {
    name: 'chargeback-return',
    expectedCategory: 'ChargebackReturn',
    expectedCount: 1,
    bankRows: chargebackReturnBankRows,
    qboRows: chargebackReturnQboRows,
  },
  {
    name: 'interest-income',
    expectedCategory: 'InterestIncome',
    expectedCount: 1,
    bankRows: interestIncomeBankRows,
    qboRows: interestIncomeQboRows,
  },
  {
    name: 'intercompany-mismatch',
    expectedCategory: 'IntercompanyMismatch',
    expectedCount: 1,
    bankRows: intercompanyMismatchBankRows,
    qboRows: intercompanyMismatchQboRows,
  },
];

/** Ordered list of every `ErrorCategory` covered by `exceptionScenarioFixtures`. */
export const allExceptionCategories = exceptionScenarioFixtures.map((fixture) => fixture.expectedCategory);

/** Fixtures for edge cases that produce multiple or zero exception categories. */
export const exceptionEdgeCaseFixtures: ExceptionEdgeCaseFixture[] = [
  {
    name: 'grouped-near-miss-falls-back-to-missing',
    bankRows: splitCombineNearMissBankRows,
    qboRows: splitCombineNearMissQboRows,
    expectedPresent: [
      { category: 'MissingFromQBO', count: 1 },
      { category: 'MissingFromBank', count: 2 },
    ],
    expectedAbsent: ['LikelySplitCombineIssue'],
  },
  {
    name: 'oversized-deposit-group-falls-back-to-missing',
    bankRows: depositGroupingOversizedBankRows,
    qboRows: depositGroupingOversizedQboRows,
    expectedPresent: [
      { category: 'MissingFromQBO', count: 1 },
      { category: 'MissingFromBank', count: 4 },
    ],
    expectedAbsent: ['DepositGroupingIssue'],
  },
  {
    name: 'recent-check-stays-missing-until-stale-threshold',
    bankRows: staleOutstandingBelowThresholdBankRows,
    qboRows: staleOutstandingBelowThresholdQboRows,
    expectedPresent: [{ category: 'OutstandingCheck', count: 1 }],
    expectedAbsent: ['StaleOutstandingCheck', 'MissingFromBank'],
  },
  {
    name: 'timing-incompatible-extended-window-stays-date-variance',
    bankRows: dateVarianceBankRows,
    qboRows: dateVarianceQboRows,
    expectedPresent: [{ category: 'DateVariance', count: 1 }],
    expectedAbsent: ['TimingDifference'],
  },
  {
    name: 'invalid-data-does-not-double-classify-as-missing',
    bankRows: invalidDataBankRows,
    qboRows: invalidDataQboRows,
    expectedPresent: [{ category: 'InvalidOrMissingData', count: 1 }],
    expectedAbsent: ['MissingFromQBO'],
  },
];

/** Fixtures for verifying that high-precedence classifiers suppress lower-precedence categories. */
export const exceptionPrecedenceFixtures: ExceptionPrecedenceFixture[] = [
  {
    name: 'invalid-data-wins-over-missing-fallback',
    bankRows: invalidDataBankRows,
    qboRows: invalidDataQboRows,
    expectedPresent: [{ category: 'InvalidOrMissingData', count: 1 }],
    expectedAbsent: ['MissingFromQBO'],
  },
  {
    name: 'timing-difference-wins-over-missing-fallback',
    bankRows: timingDifferenceBankRows,
    qboRows: timingDifferenceQboRows,
    expectedPresent: [{ category: 'TimingDifference', count: 2 }],
    expectedAbsent: ['MissingFromQBO', 'MissingFromBank'],
  },
  {
    name: 'split-combine-wins-over-missing-fallback',
    bankRows: splitCombineBankRows,
    qboRows: splitCombineQboRows,
    expectedPresent: [{ category: 'LikelySplitCombineIssue', count: 3 }],
    expectedAbsent: ['MissingFromQBO', 'MissingFromBank'],
  },
  {
    name: 'stale-check-wins-over-missing-fallback-in-mixed-residual-run',
    bankRows: staleOutstandingMixedResidualBankRows,
    qboRows: staleOutstandingMixedResidualQboRows,
    expectedPresent: [
      { category: 'StaleOutstandingCheck', count: 1 },
      { category: 'MissingFromQBO', count: 2 },
    ],
    expectedAbsent: ['MissingFromBank'],
  },
];

const normalizeHeader = (value: string | number): string =>
  String(value)
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

const BANK_COLUMN_BY_NORMALIZED_HEADER: Record<string, string> = {
  DATE: 'date',
  DESCRIPTION: 'description',
  CHECK: 'checkNumber',
  'CHECK NUMBER': 'checkNumber',
  REFERENCE: 'referenceNumber',
  'REFERENCE NUMBER': 'referenceNumber',
  DEBIT: 'debit',
  WITHDRAWAL: 'debit',
  CREDIT: 'credit',
  DEPOSIT: 'credit',
  BALANCE: 'balance',
  'CURRENT BALANCE': 'balance',
};

const QBO_COLUMN_BY_NORMALIZED_HEADER: Record<string, string> = {
  DATE: 'date',
  TYPE: 'type',
  NUM: 'num',
  REFERENCE: 'reference',
  'REFERENCE NUMBER': 'reference',
  NAME: 'name',
  MEMO: 'memo',
  DESCRIPTION: 'memo',
  AMOUNT: 'amount',
};

const COMBINED_BANK_HEADER = ['Date', 'Description', 'Check Number', 'Reference', 'Debit', 'Credit', 'Balance'];
const COMBINED_QBO_HEADER = ['Date', 'Type', 'Num', 'Reference', 'Name', 'Memo', 'Amount'];

type RowRecord = Record<string, string | number>;

const rowsToCombinedRecord = (
  rows: WorkbookRows,
  columnByNormalizedHeader: Record<string, string>,
): RowRecord[] => {
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) {
    return [];
  }

  const fieldByIndex = headerRow.reduce<Array<string | undefined>>((fields, headerValue, index) => {
    fields[index] = columnByNormalizedHeader[normalizeHeader(headerValue)];
    return fields;
  }, []);

  return dataRows.map((dataRow) =>
    dataRow.reduce<RowRecord>((record, cellValue, index) => {
      const field = fieldByIndex[index];
      if (field) {
        record[field] = cellValue;
      }

      return record;
    }, {}),
  );
};

const recordToRow = (record: RowRecord, columns: string[]): Array<string | number> =>
  columns.map((column) => record[column] ?? '');

/** Merges all scenario fixture rows into a single bank/QBO row set covering every exception category. */
export const buildAllExceptionsCombinedRows = (): { bankRows: WorkbookRows; qboRows: WorkbookRows } => {
  const bankRecords = exceptionScenarioFixtures.flatMap((fixture) =>
    rowsToCombinedRecord(fixture.bankRows, BANK_COLUMN_BY_NORMALIZED_HEADER),
  );
  const qboRecords = exceptionScenarioFixtures.flatMap((fixture) =>
    rowsToCombinedRecord(fixture.qboRows, QBO_COLUMN_BY_NORMALIZED_HEADER),
  );

  return {
    bankRows: [COMBINED_BANK_HEADER, ...bankRecords.map((record) => recordToRow(record, ['date', 'description', 'checkNumber', 'referenceNumber', 'debit', 'credit', 'balance']))],
    qboRows: [COMBINED_QBO_HEADER, ...qboRecords.map((record) => recordToRow(record, ['date', 'type', 'num', 'reference', 'name', 'memo', 'amount']))],
  };
};

/** Aggregated expected exception counts keyed by `ErrorCategory` across all scenario fixtures. */
export const allExceptionsExpectedCounts = exceptionScenarioFixtures.reduce<Record<ErrorCategory, number>>((counts, fixture) => {
  counts[fixture.expectedCategory] = (counts[fixture.expectedCategory] ?? 0) + fixture.expectedCount;
  return counts;
}, {} as Record<ErrorCategory, number>);

/** Creates an Excel workbook buffer containing bank rows for every exception scenario combined. */
export const createAllExceptionsBankWorkbook = async (): Promise<Buffer> => {
  const { bankRows } = buildAllExceptionsCombinedRows();
  return createWorkbookFromRows(bankRows);
};

/** Creates an Excel workbook buffer containing QBO rows for every exception scenario combined. */
export const createAllExceptionsQboWorkbook = async (): Promise<Buffer> => {
  const { qboRows } = buildAllExceptionsCombinedRows();
  return createWorkbookFromRows(qboRows);
};