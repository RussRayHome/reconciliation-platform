import {
  ambiguousBankRows,
  ambiguousGlRows,
  amountMismatchBankRows,
  amountMismatchGlRows,
  createWorkbookFromRows,
  dateVarianceBankRows,
  dateVarianceGlRows,
  depositGroupingBankRows,
  depositGroupingOversizedBankRows,
  depositGroupingOversizedGlRows,
  depositGroupingGlRows,
  descriptionVarianceBankRows,
  descriptionVarianceGlRows,
  duplicateInBankBankRows,
  duplicateInBankGlRows,
  duplicateInGlBankRows,
  duplicateInGlGlRows,
  likelyMiscodingBankRows,
  likelyMiscodingGlRows,
  missingFromBankBankRows,
  missingFromBankGlRows,
  missingFromGlBankRows,
  missingFromGlGlRows,
  referenceMismatchBankRows,
  referenceMismatchGlRows,
  referenceNumberMismatchBankRows,
  referenceNumberMismatchGlRows,
  splitCombineBankRows,
  splitCombineNearMissBankRows,
  splitCombineNearMissGlRows,
  splitCombineGlRows,
  staleOutstandingBankRows,
  staleOutstandingBelowThresholdBankRows,
  staleOutstandingBelowThresholdGlRows,
  staleOutstandingMixedResidualBankRows,
  staleOutstandingMixedResidualGlRows,
  staleOutstandingGlRows,
  timingDifferenceBankRows,
  timingDifferenceGlRows,
  reversalVoidBankRows,
  reversalVoidGlRows,
  achReturnBankRows,
  achReturnGlRows,
  depositInTransitBankRows,
  depositInTransitGlRows,
  chargebackReturnBankRows,
  chargebackReturnGlRows,
  interestIncomeBankRows,
  interestIncomeGlRows,
  intercompanyMismatchBankRows,
  intercompanyMismatchGlRows,
  outstandingCheckBankRows,
  outstandingCheckGlRows,
  feeNettingMatchBankRows,
  feeNettingMatchGlRows,
  partialPaymentMatchBankRows,
  partialPaymentMatchGlRows,
  payrollBatchMatchBankRows,
  payrollBatchMatchGlRows,
  bankServiceChargeAmortizationBankRows,
  bankServiceChargeAmortizationGlRows,
  loanPaymentSplitBankRows,
  loanPaymentSplitGlRows,
  nsfReturnedDepositBankRows,
  nsfReturnedDepositGlRows,
  voidedCheckClearedBankRows,
  voidedCheckClearedGlRows,
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
  glRows: WorkbookRows;
}

/** Fixture for an exception edge case that may produce multiple categories or none at all. */
export interface ExceptionEdgeCaseFixture {
  name: string;
  bankRows: WorkbookRows;
  glRows: WorkbookRows;
  expectedPresent: Array<{ category: ErrorCategory; count: number }>;
  expectedAbsent: ErrorCategory[];
}

/** Fixture for verifying classification precedence: some categories must be present, others must not. */
export interface ExceptionPrecedenceFixture {
  name: string;
  bankRows: WorkbookRows;
  glRows: WorkbookRows;
  expectedPresent: Array<{ category: ErrorCategory; count: number }>;
  expectedAbsent: ErrorCategory[];
}

/** All single-category exception scenario fixtures, one per `ErrorCategory`. */
export const exceptionScenarioFixtures: ExceptionScenarioFixture[] = [
  {
    name: 'missing-from-gl',
    expectedCategory: 'MissingFromGL',
    expectedCount: 1,
    bankRows: missingFromGlBankRows,
    glRows: missingFromGlGlRows,
  },
  {
    name: 'missing-from-bank',
    expectedCategory: 'MissingFromBank',
    expectedCount: 1,
    bankRows: missingFromBankBankRows,
    glRows: missingFromBankGlRows,
  },
  {
    name: 'amount-mismatch',
    expectedCategory: 'AmountMismatch',
    expectedCount: 1,
    bankRows: amountMismatchBankRows,
    glRows: amountMismatchGlRows,
  },
  {
    name: 'duplicate-in-bank',
    expectedCategory: 'DuplicateInBank',
    expectedCount: 1,
    bankRows: duplicateInBankBankRows,
    glRows: duplicateInBankGlRows,
  },
  {
    name: 'duplicate-in-gl',
    expectedCategory: 'DuplicateInGL',
    expectedCount: 1,
    bankRows: duplicateInGlBankRows,
    glRows: duplicateInGlGlRows,
  },
  {
    name: 'likely-split-combine-issue',
    expectedCategory: 'LikelySplitCombineIssue',
    expectedCount: 3,
    bankRows: splitCombineBankRows,
    glRows: splitCombineGlRows,
  },
  {
    name: 'deposit-grouping-issue',
    expectedCategory: 'DepositGroupingIssue',
    expectedCount: 3,
    bankRows: depositGroupingBankRows,
    glRows: depositGroupingGlRows,
  },
  {
    name: 'likely-miscoding',
    expectedCategory: 'LikelyMiscoding',
    expectedCount: 2,
    bankRows: likelyMiscodingBankRows,
    glRows: likelyMiscodingGlRows,
  },
  {
    name: 'date-variance',
    expectedCategory: 'DateVariance',
    expectedCount: 1,
    bankRows: dateVarianceBankRows,
    glRows: dateVarianceGlRows,
  },
  {
    name: 'timing-difference',
    expectedCategory: 'TimingDifference',
    expectedCount: 2,
    bankRows: timingDifferenceBankRows,
    glRows: timingDifferenceGlRows,
  },
  {
    name: 'check-number-mismatch',
    expectedCategory: 'CheckNumberMismatch',
    expectedCount: 1,
    bankRows: referenceMismatchBankRows,
    glRows: referenceMismatchGlRows,
  },
  {
    name: 'reference-number-mismatch',
    expectedCategory: 'ReferenceNumberMismatch',
    expectedCount: 1,
    bankRows: referenceNumberMismatchBankRows,
    glRows: referenceNumberMismatchGlRows,
  },
  {
    name: 'description-merchant-variance',
    expectedCategory: 'DescriptionMerchantVariance',
    expectedCount: 1,
    bankRows: descriptionVarianceBankRows,
    glRows: descriptionVarianceGlRows,
  },
  {
    name: 'stale-outstanding-check',
    expectedCategory: 'StaleOutstandingCheck',
    expectedCount: 1,
    bankRows: staleOutstandingBankRows,
    glRows: staleOutstandingGlRows,
  },
  {
    name: 'outstanding-check',
    expectedCategory: 'OutstandingCheck',
    expectedCount: 1,
    bankRows: outstandingCheckBankRows,
    glRows: outstandingCheckGlRows,
  },
  {
    name: 'fee-netting-match',
    expectedCategory: 'FeeNettingMatch',
    expectedCount: 3,
    bankRows: feeNettingMatchBankRows,
    glRows: feeNettingMatchGlRows,
  },
  {
    name: 'partial-payment-match',
    expectedCategory: 'PartialPaymentMatch',
    expectedCount: 3,
    bankRows: partialPaymentMatchBankRows,
    glRows: partialPaymentMatchGlRows,
  },
  {
    name: 'payroll-batch-match',
    expectedCategory: 'PayrollBatchMatch',
    expectedCount: 3,
    bankRows: payrollBatchMatchBankRows,
    glRows: payrollBatchMatchGlRows,
  },
  {
    name: 'bank-service-charge-amortization',
    expectedCategory: 'BankServiceChargeAmortization',
    expectedCount: 3,
    bankRows: bankServiceChargeAmortizationBankRows,
    glRows: bankServiceChargeAmortizationGlRows,
  },
  {
    name: 'loan-payment-split',
    expectedCategory: 'LoanPaymentSplit',
    expectedCount: 3,
    bankRows: loanPaymentSplitBankRows,
    glRows: loanPaymentSplitGlRows,
  },
  {
    name: 'nsf-returned-deposit',
    expectedCategory: 'NSFReturnedDeposit',
    expectedCount: 1,
    bankRows: nsfReturnedDepositBankRows,
    glRows: nsfReturnedDepositGlRows,
  },
  {
    name: 'voided-check-cleared',
    expectedCategory: 'VoidedCheckCleared',
    expectedCount: 1,
    bankRows: voidedCheckClearedBankRows,
    glRows: voidedCheckClearedGlRows,
  },
  {
    name: 'ambiguous-match-requiring-review',
    expectedCategory: 'AmbiguousMatchRequiringReview',
    expectedCount: 1,
    bankRows: ambiguousBankRows,
    glRows: ambiguousGlRows,
  },
  {
    name: 'reversal-void',
    expectedCategory: 'ReversalVoid',
    expectedCount: 2,
    bankRows: reversalVoidBankRows,
    glRows: reversalVoidGlRows,
  },
  {
    name: 'ach-return',
    expectedCategory: 'ACHReturn',
    expectedCount: 2,
    bankRows: achReturnBankRows,
    glRows: achReturnGlRows,
  },
  {
    name: 'deposit-in-transit',
    expectedCategory: 'DepositInTransit',
    expectedCount: 1,
    bankRows: depositInTransitBankRows,
    glRows: depositInTransitGlRows,
  },
  {
    name: 'chargeback-return',
    expectedCategory: 'ChargebackReturn',
    expectedCount: 1,
    bankRows: chargebackReturnBankRows,
    glRows: chargebackReturnGlRows,
  },
  {
    name: 'interest-income',
    expectedCategory: 'InterestIncome',
    expectedCount: 1,
    bankRows: interestIncomeBankRows,
    glRows: interestIncomeGlRows,
  },
  {
    name: 'intercompany-mismatch',
    expectedCategory: 'IntercompanyMismatch',
    expectedCount: 1,
    bankRows: intercompanyMismatchBankRows,
    glRows: intercompanyMismatchGlRows,
  },
];

/** Ordered list of every `ErrorCategory` covered by `exceptionScenarioFixtures`. */
export const allExceptionCategories = exceptionScenarioFixtures.map(
  (fixture) => fixture.expectedCategory,
);

/** Fixtures for edge cases that produce multiple or zero exception categories. */
export const exceptionEdgeCaseFixtures: ExceptionEdgeCaseFixture[] = [
  {
    name: 'grouped-near-miss-falls-back-to-missing',
    bankRows: splitCombineNearMissBankRows,
    glRows: splitCombineNearMissGlRows,
    expectedPresent: [
      { category: 'MissingFromGL', count: 1 },
      { category: 'MissingFromBank', count: 2 },
    ],
    expectedAbsent: ['LikelySplitCombineIssue'],
  },
  {
    name: 'oversized-deposit-group-falls-back-to-missing',
    bankRows: depositGroupingOversizedBankRows,
    glRows: depositGroupingOversizedGlRows,
    expectedPresent: [
      { category: 'MissingFromGL', count: 1 },
      { category: 'MissingFromBank', count: 4 },
    ],
    expectedAbsent: ['DepositGroupingIssue'],
  },
  {
    name: 'recent-check-stays-missing-until-stale-threshold',
    bankRows: staleOutstandingBelowThresholdBankRows,
    glRows: staleOutstandingBelowThresholdGlRows,
    expectedPresent: [{ category: 'OutstandingCheck', count: 1 }],
    expectedAbsent: ['StaleOutstandingCheck', 'MissingFromBank'],
  },
  {
    name: 'timing-incompatible-extended-window-stays-date-variance',
    bankRows: dateVarianceBankRows,
    glRows: dateVarianceGlRows,
    expectedPresent: [{ category: 'DateVariance', count: 1 }],
    expectedAbsent: ['TimingDifference'],
  },
];

/** Fixtures for verifying that high-precedence classifiers suppress lower-precedence categories. */
export const exceptionPrecedenceFixtures: ExceptionPrecedenceFixture[] = [
  {
    name: 'timing-difference-wins-over-missing-fallback',
    bankRows: timingDifferenceBankRows,
    glRows: timingDifferenceGlRows,
    expectedPresent: [{ category: 'TimingDifference', count: 2 }],
    expectedAbsent: ['MissingFromGL', 'MissingFromBank'],
  },
  {
    name: 'split-combine-wins-over-missing-fallback',
    bankRows: splitCombineBankRows,
    glRows: splitCombineGlRows,
    expectedPresent: [{ category: 'LikelySplitCombineIssue', count: 3 }],
    expectedAbsent: ['MissingFromGL', 'MissingFromBank'],
  },
  {
    name: 'stale-check-wins-over-missing-fallback-in-mixed-residual-run',
    bankRows: staleOutstandingMixedResidualBankRows,
    glRows: staleOutstandingMixedResidualGlRows,
    expectedPresent: [
      { category: 'StaleOutstandingCheck', count: 1 },
      { category: 'MissingFromGL', count: 2 },
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
  'SEQUENCE NUMBER': 'sequenceNumber',
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

const GL_COLUMN_BY_NORMALIZED_HEADER: Record<string, string> = {
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

const COMBINED_BANK_HEADER = [
  'Date',
  'Description',
  'Sequence Number',
  'Check Number',
  'Reference',
  'Debit',
  'Credit',
  'Balance',
];
const COMBINED_GL_HEADER = ['Date', 'Type', 'Num', 'Reference', 'Name', 'Memo', 'Amount'];

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

/** Merges all scenario fixture rows into a single bank/GL row set covering every exception category. */
export const buildAllExceptionsCombinedRows = (): {
  bankRows: WorkbookRows;
  glRows: WorkbookRows;
} => {
  const bankRecords = exceptionScenarioFixtures.flatMap((fixture) =>
    rowsToCombinedRecord(fixture.bankRows, BANK_COLUMN_BY_NORMALIZED_HEADER),
  );
  const glRecords = exceptionScenarioFixtures.flatMap((fixture) =>
    rowsToCombinedRecord(fixture.glRows, GL_COLUMN_BY_NORMALIZED_HEADER),
  );

  // Each fixture numbers its own Sequence Number column starting from 1, so combining fixtures
  // verbatim would produce many duplicate values (BANK_SEQUENCE_DUPLICATE) once merged into one
  // file. Renumber globally across the combined set instead -- File Validation only requires
  // uniqueness within a file, and which literal value each row carries is otherwise arbitrary.
  // Also drop each fixture's own Balance column: every fixture authors its own self-consistent
  // running balance in isolation, but concatenating unrelated fixtures' balances end-to-end has no
  // coherent single-ledger story, which would trip BANK_BALANCE_CONTINUITY at every fixture
  // boundary. Balance continuity is already covered by rowValidators.test.ts's dedicated fixtures;
  // leaving it blank here skips the file-level check entirely (it only runs when every row has a
  // value), matching this fixture's real purpose -- exhaustive exception-*taxonomy* coverage, not
  // balance-continuity coverage.
  const renumberedBankRecords = bankRecords.map((record, index) => {
    const next: RowRecord = { ...record, sequenceNumber: String(index + 1) };
    delete next['balance'];
    return next;
  });

  return {
    bankRows: [
      COMBINED_BANK_HEADER,
      ...renumberedBankRecords.map((record) =>
        recordToRow(record, [
          'date',
          'description',
          'sequenceNumber',
          'checkNumber',
          'referenceNumber',
          'debit',
          'credit',
          'balance',
        ]),
      ),
    ],
    glRows: [
      COMBINED_GL_HEADER,
      ...glRecords.map((record) =>
        recordToRow(record, ['date', 'type', 'num', 'reference', 'name', 'memo', 'amount']),
      ),
    ],
  };
};

/** Aggregated expected exception counts keyed by `ErrorCategory` across all scenario fixtures. */
export const allExceptionsExpectedCounts = exceptionScenarioFixtures.reduce<
  Record<ErrorCategory, number>
>(
  (counts, fixture) => {
    counts[fixture.expectedCategory] =
      (counts[fixture.expectedCategory] ?? 0) + fixture.expectedCount;
    return counts;
  },
  {} as Record<ErrorCategory, number>,
);

/** Creates an Excel workbook buffer containing bank rows for every exception scenario combined. */
export const createAllExceptionsBankWorkbook = async (): Promise<Buffer> => {
  const { bankRows } = buildAllExceptionsCombinedRows();
  return createWorkbookFromRows(bankRows);
};

/** Creates an Excel workbook buffer containing GL rows for every exception scenario combined. */
export const createAllExceptionsGlWorkbook = async (): Promise<Buffer> => {
  const { glRows } = buildAllExceptionsCombinedRows();
  return createWorkbookFromRows(glRows);
};
