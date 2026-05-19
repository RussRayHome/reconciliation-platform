/**
 * Raw spreadsheet row arrays for every exception scenario and edge case used across unit,
 * integration, and E2E test suites. Each named export is a self-contained set of header +
 * data rows for a specific bank or QBO file. Workbook factory helpers at the bottom of the
 * file convert any row array into an ExcelJS buffer.
 */
import { Buffer } from 'node:buffer';
import ExcelJS from 'exceljs';

export const bankHeaderOnlyRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
];

export const qboHeaderOnlyRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
];

export const sampleBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-01-02', 'ACME OFFICE SUPPLY', '', '125.50', '', '9874.50'],
  ['2025-01-03', 'PAYROLL ACH', '', '3200.00', '', '6674.50'],
  ['2025-01-05', 'CLIENT PAYMENT NORTH', '', '', '3200.00', '9874.50'],
  ['2025-01-08', 'CHECK 1052 RENT', '1052', '1600.00', '', '8274.50'],
  ['2025-01-09', 'CHECK 1052 RENT', '1052', '1600.00', '', '6674.50'],
  ['2025-01-11', 'CARD ADJUSTMENT', '', '0', '', '6674.50'],
];

export const sampleQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-01-01', 'Journal', '', '', 'Beginning Balance', '15000.00'],
  ['2025-01-02', 'Expense', '', 'Acme Office Supplies', 'Office supplies order', '-125.50'],
  ['2025-01-03', 'Expense', '', 'Payroll Processor', 'Payroll ACH batch', '-3200.00'],
  ['2025-01-05', 'Deposit', '', 'North Client', 'Client payment North', '3200.00'],
  ['2025-01-10', 'Check', '1052', 'Landlord LLC', 'Rent January', '-1600.00'],
  ['2025-01-10', 'Expense', '', '', '', '0'],
];

export const referenceMismatchBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-02-05', 'LANDLORD RENT CHECK 2150 FEB', '2150', '1600.00', '', '8400.00'],
];

export const referenceMismatchQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-02-05', 'Check', '2151', 'Landlord Rent', 'Landlord rent check 2151 feb', '-1600.00'],
];

export const amountMismatchBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-03-04', 'WIRE VENDOR ALPHA INV-993', '', '500.00', '', '7900.00'],
];

export const amountMismatchQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-03-04', 'Expense', '', 'Vendor Alpha', 'Invoice 993 payment', '-520.00'],
];

export const timingDifferenceBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-04-29', 'PAYROLL PROCESSOR APRIL BATCH', '', '2400.00', '', '5500.00'],
];

export const timingDifferenceQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-05-18', 'Expense', '', 'Payroll Processor', 'Payroll processor April batch', '-2400.00'],
];

export const splitCombineBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-07-15', 'VENDOR SETTLEMENT BATCH', '', '300.00', '', '6400.00'],
];

export const splitCombineQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-07-15', 'Expense', '', 'Vendor Alpha', 'Vendor settlement part 1', '-120.00'],
  ['2025-07-16', 'Expense', '', 'Vendor Alpha', 'Vendor settlement part 2', '-180.00'],
];

export const depositGroupingBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-08-05', 'MERCHANT SERVICES BATCH DEPOSIT', '', '', '3200.00', '9600.00'],
];

export const depositGroupingQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-08-04', 'Deposit', '', 'Customer A', 'Batch receipt A', '2000.00'],
  ['2025-08-05', 'Deposit', '', 'Customer B', 'Batch receipt B', '1200.00'],
];

export const splitCombineNearMissBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-07-22', 'VENDOR SETTLEMENT BATCH', '', '300.00', '', '6100.00'],
];

export const splitCombineNearMissQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-07-22', 'Expense', '', 'Vendor Alpha', 'Vendor settlement part 1', '-120.00'],
  ['2025-07-23', 'Expense', '', 'Vendor Alpha', 'Vendor settlement part 2', '-179.97'],
];

export const depositGroupingOversizedBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-08-12', 'MERCHANT SERVICES BATCH DEPOSIT', '', '', '3200.00', '12800.00'],
];

export const depositGroupingOversizedQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-08-11', 'Deposit', '', 'Customer A', 'Batch receipt A', '1000.00'],
  ['2025-08-12', 'Deposit', '', 'Customer B', 'Batch receipt B', '800.00'],
  ['2025-08-12', 'Deposit', '', 'Customer C', 'Batch receipt C', '700.00'],
  ['2025-08-12', 'Deposit', '', 'Customer D', 'Batch receipt D', '700.00'],
];

export const ambiguousBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-06-10', 'CARD SHELL FUEL', '', '85.00', '', '4900.00'],
];

export const ambiguousQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-06-15', 'Expense', '', 'Merchant A', 'Card shell fuel tag-a', '-85.00'],
  ['2025-06-15', 'Expense', '', 'Vendor B', 'Card shell fuel tag-b', '-85.00'],
];

export const missingFromQboBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-02', 'UNBOOKED BANK FEE', '', '45.00', '', '9955.00'],
];

export const missingFromQboQboRows = qboHeaderOnlyRows;

export const missingFromBankBankRows = bankHeaderOnlyRows;

export const missingFromBankQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-09-03', 'Deposit', '', 'North Client', 'Client receipt not yet on statement', '450.00'],
];

export const duplicateInBankBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-04', 'VENDOR OMEGA EFT', '', '210.00', '', '9745.00'],
  ['2025-09-05', 'VENDOR OMEGA EFT', '', '210.00', '', '9535.00'],
];

export const duplicateInBankQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-09-04', 'Expense', '', 'Vendor Omega', 'Vendor omega eft', '-210.00'],
];

export const duplicateInQboBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-06', 'CLIENT REFUND SIGMA', '', '180.00', '', '9355.00'],
];

export const duplicateInQboQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-09-06', 'Expense', '', 'Client Sigma', 'Client refund sigma', '-180.00'],
  ['2025-09-07', 'Expense', '', 'Client Sigma', 'Client refund sigma', '-180.00'],
];

export const likelyMiscodingBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-03-10', 'ACME PAYROLL', '', '575.00', '', '9425.00'],
];

export const likelyMiscodingQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-03-11', 'Expense', '', 'Office Depot', 'Office supplies', '-575.00'],
];

export const dateVarianceBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-04-01', 'CLIENT BATCH DEPOSIT', '', '', '3200.00', '8200.00'],
];

export const dateVarianceQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-04-15', 'Journal Entry', '', 'Client Batch', 'Client batch deposit clearing', '3200.00'],
];

export const referenceNumberMismatchBankRows = [
  ['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'],
  ['2025-02-12', 'WIRE CLIENT REF 7788 SETTLEMENT', '7788', '450.00', '', '9550.00'],
];

export const referenceNumberMismatchQboRows = [
  ['Date', 'Type', 'Reference', 'Name', 'Memo', 'Amount'],
  ['2025-02-12', 'Expense', '7799', 'Client Wire', 'Wire client ref settlement', '-450.00'],
];

export const descriptionVarianceBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-02-18', 'OFFICE DEPOT MONTHLY RUN', '', '245.00', '', '9305.00'],
];

export const descriptionVarianceQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-02-18', 'Expense', '', 'Office Depot', 'Client charge', '-245.00'],
];

export const staleOutstandingBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-03-31', 'OPERATING ACTIVITY', '', '200.00', '', '800.00'],
  ['2025-04-30', 'MONTH-END ACTIVITY', '', '100.00', '', '700.00'],
];

export const staleOutstandingQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-02-10', 'Check', '1124', 'Vendor A', 'Uncleared check', '-150.00'],
];

export const staleOutstandingBelowThresholdBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-04-29', 'OPERATING ACTIVITY', '', '200.00', '', '800.00'],
];

export const staleOutstandingBelowThresholdQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-03-16', 'Check', '1045', 'Vendor A', 'Recent unmatched check', '-150.00'],
];

export const staleOutstandingMixedResidualBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-03-15', 'UNBOOKED BANK FEE', '', '45.00', '', '955.00'],
  ['2025-04-30', 'MONTH-END ACTIVITY', '', '100.00', '', '750.00'],
];

export const staleOutstandingMixedResidualQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-03-16', 'Check', '1045', 'Vendor A', 'Uncleared check', '-150.00'],
];

export const invalidDataBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['', 'WIRE WITHOUT DATE', '', '250.00', '', '999.00'],
];

export const invalidDataQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-03-04', 'Expense', '', 'Vendor', 'Wire without date', '-250.00'],
];

export const nonStandardHeaderBankRows = [
  [
    'Posted Date',
    'Transaction Details',
    'Payments and Other Debits',
    'Deposits and Other Credits',
    'Current Balance',
  ],
  ['2025-01-02', 'ACME OFFICE SUPPLY', '125.50', '', '9874.50'],
  ['2025-01-05', 'CLIENT PAYMENT NORTH', '', '3200.00', '13074.50'],
];

export const nonStandardHeaderQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-01-02', 'Expense', '', 'Acme Office Supply', 'ACME OFFICE SUPPLY', '-125.50'],
  ['2025-01-05', 'Deposit', '', 'North Client', 'CLIENT PAYMENT NORTH', '3200.00'],
];

const buildWorkbookBuffer = async (rows: Array<Array<string | number>>): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Transactions');
  rows.forEach((row) => worksheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();

  if (Buffer.isBuffer(buffer)) {
    return buffer;
  }

  if (buffer instanceof Uint8Array) {
    return Buffer.from(buffer);
  }

  if (buffer instanceof ArrayBuffer) {
    return Buffer.from(buffer);
  }

  if (ArrayBuffer.isView(buffer)) {
    return Buffer.from(buffer);
  }

  throw new TypeError('Unsupported workbook buffer type from exceljs writeBuffer().');
};

/** Creates an Excel workbook buffer from the default sample bank rows. */
export const createSampleBankWorkbook = () => buildWorkbookBuffer(sampleBankRows);
/** Creates an Excel workbook buffer from the default sample QBO rows. */
export const createSampleQboWorkbook = () => buildWorkbookBuffer(sampleQboRows);

/** Creates an Excel workbook buffer from arbitrary row data. */
export const createWorkbookFromRows = (rows: Array<Array<string | number>>) => buildWorkbookBuffer(rows);
