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
  ['2025-08-01', 'Deposit', '', 'Customer A', 'Batch receipt A', '1000.00'],
  ['2025-08-01', 'Deposit', '', 'Customer B', 'Batch receipt B', '800.00'],
  ['2025-08-01', 'Deposit', '', 'Customer C', 'Batch receipt C', '700.00'],
  ['2025-08-01', 'Deposit', '', 'Customer D', 'Batch receipt D', '700.00'],
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
  ['2025-09-03', 'Expense', '', 'North Vendor', 'Vendor payment missing from bank', '-450.00'],
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

export const outstandingCheckBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-15', 'MONTH-END OPERATING', '', '350.00', '', '9000.00'],
];

export const outstandingCheckQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-11-07', 'Check', '1201', 'Vendor B', 'Normal uncleared check', '-273.50'],
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

export const reversalVoidBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-10-01', 'BANK DEBIT JOURNAL ENTRY', '', '500.00', '', '9500.00'],
  ['2025-10-02', 'BANK CREDIT JOURNAL ENTRY', '', '', '500.00', '10000.00'],
];

export const reversalVoidQboRows = qboHeaderOnlyRows;

export const achReturnBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-10-10', 'ACH DEBIT VENDOR GAMMA', '', '300.00', '', '9700.00'],
  ['2025-10-11', 'NSF RETURN ACH VENDOR GAMMA', '', '', '300.00', '10000.00'],
];

export const achReturnQboRows = qboHeaderOnlyRows;

export const depositInTransitBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-15', 'OPERATING EXPENSE UNMATCHED', '', '100.00', '', '9900.00'],
];

export const depositInTransitQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-11-12', 'Deposit', '', 'Remote Client', 'Client deposit in transit', '250.00'],
];

export const chargebackReturnBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-20', 'CLIENT INVOICE SETTLEMENT ALPHA', '', '', '750.00', '10750.00'],
  ['2025-10-25', 'CHARGEBACK DISPUTED CLIENT ALPHA', '', '750.00', '', '10000.00'],
];

export const chargebackReturnQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-09-20', 'Income', '', 'Client Alpha', 'Client invoice settlement alpha', '750.00'],
];

export const interestIncomeBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-30', 'INTEREST EARNED SAVINGS', '', '', '12.50', '10012.50'],
];

export const interestIncomeQboRows = qboHeaderOnlyRows;

export const intercompanyMismatchBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-25', 'DUE FROM SUBSIDIARY ALPHA', '', '1000.00', '', '9000.00'],
];

export const intercompanyMismatchQboRows = qboHeaderOnlyRows;

// FeeNettingMatch: bank credit = QBO revenue + QBO fee
export const feeNettingMatchBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-10-01', 'STRIPE PAYOUT NET', '', '', '93.17', '10093.17'],
];

export const feeNettingMatchQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-10-01', 'Sales Receipt', '', 'Stripe', 'Stripe gross revenue payout', '101.80'],
  ['2025-10-01', 'Expense', '', 'Stripe', 'Stripe processing fee', '-8.63'],
];

// PartialPaymentMatch: two bank debits sum to one QBO debit
export const partialPaymentMatchBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-10-05', 'INSTALLMENT VENDOR DELTA INV-992 PART 1', '', '150.75', '', '9849.25'],
  ['2025-10-09', 'INSTALLMENT VENDOR DELTA INV-992 PART 2', '', '150.75', '', '9698.50'],
];

export const partialPaymentMatchQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-10-05', 'Bill Payment', '', 'Vendor Delta', 'Vendor delta inv 992 installment plan', '-301.50'],
];

// PayrollBatchMatch: one bank payroll debit matches multiple QBO payroll lines
export const payrollBatchMatchBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-01', 'PAYROLL DIRECT DEPOSIT BATCH', '', '5001.00', '', '4999.00'],
];

export const payrollBatchMatchQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-11-01', 'Expense', '', 'Employee A', 'Payroll employee a salary nov', '-3001.00'],
  ['2025-11-01', 'Expense', '', 'Employee B', 'Payroll employee b salary nov', '-2000.00'],
];

// BankServiceChargeAmortization: one bank fee debit matches multiple QBO expense lines
export const bankServiceChargeAmortizationBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-10-15', 'MONTHLY SERVICE FEE ACCOUNT MAINTENANCE', '', '121.00', '', '9879.00'],
];

export const bankServiceChargeAmortizationQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-10-15', 'Expense', '', 'Bank', 'Bank fee admin account maintenance', '-61.00'],
  ['2025-10-15', 'Expense', '', 'Bank', 'Bank fee wire transfer services', '-60.00'],
];

// LoanPaymentSplit: one bank mortgage debit matches two QBO principal+interest lines
export const loanPaymentSplitBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-10', 'MORTGAGE PAYMENT WELLS FARGO', '', '1250.00', '', '8750.00'],
];

export const loanPaymentSplitQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-11-10', 'Expense', '', 'Wells Fargo', 'Mortgage loan principal reduction', '-1000.00'],
  ['2025-11-10', 'Expense', '', 'Wells Fargo', 'Mortgage loan interest expense', '-250.00'],
];

// NSFReturnedDeposit: bank debit with NSF keywords and no QBO counterpart
export const nsfReturnedDepositBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-08', 'NSF RETURNED CHECK CUSTOMER ALPHA', '', '317.89', '', '9682.11'],
];

export const nsfReturnedDepositQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
];

// VoidedCheckCleared: bank check debit with check number and no QBO counterpart
export const voidedCheckClearedBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-12', 'CHECK', '1042', '657.33', '', '9342.67'],
];

export const voidedCheckClearedQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
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
