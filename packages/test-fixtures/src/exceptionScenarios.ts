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
} from './sampleRows';

import type { ErrorCategory } from '@recon/domain';

export type WorkbookRows = Array<Array<string | number>>;

export interface ExceptionScenarioFixture {
  name: string;
  expectedCategory: ErrorCategory;
  expectedCount: number;
  bankRows: WorkbookRows;
  qboRows: WorkbookRows;
}

export interface ExceptionEdgeCaseFixture {
  name: string;
  bankRows: WorkbookRows;
  qboRows: WorkbookRows;
  expectedPresent: Array<{ category: ErrorCategory; count: number }>;
  expectedAbsent: ErrorCategory[];
}

export interface ExceptionPrecedenceFixture {
  name: string;
  bankRows: WorkbookRows;
  qboRows: WorkbookRows;
  expectedPresent: Array<{ category: ErrorCategory; count: number }>;
  expectedAbsent: ErrorCategory[];
}

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
];

export const allExceptionCategories = exceptionScenarioFixtures.map((fixture) => fixture.expectedCategory);

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
    expectedPresent: [{ category: 'MissingFromBank', count: 1 }],
    expectedAbsent: ['StaleOutstandingCheck'],
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

export const allExceptionsExpectedCounts = exceptionScenarioFixtures.reduce<Record<ErrorCategory, number>>((counts, fixture) => {
  counts[fixture.expectedCategory] = (counts[fixture.expectedCategory] ?? 0) + fixture.expectedCount;
  return counts;
}, {} as Record<ErrorCategory, number>);

export const createAllExceptionsBankWorkbook = async (): Promise<Buffer> => {
  const { bankRows } = buildAllExceptionsCombinedRows();
  return createWorkbookFromRows(bankRows);
};

export const createAllExceptionsQboWorkbook = async (): Promise<Buffer> => {
  const { qboRows } = buildAllExceptionsCombinedRows();
  return createWorkbookFromRows(qboRows);
};