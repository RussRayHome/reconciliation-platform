import ExcelJS from 'exceljs';

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

export const ambiguousBankRows = [
  ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-06-10', 'CARD SHELL FUEL', '', '85.00', '', '4900.00'],
];

export const ambiguousQboRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-06-15', 'Expense', '', 'Merchant A', 'Card shell fuel tag-a', '-85.00'],
  ['2025-06-15', 'Expense', '', 'Vendor B', 'Card shell fuel tag-b', '-85.00'],
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
  return Buffer.from(buffer);
};

export const createSampleBankWorkbook = () => buildWorkbookBuffer(sampleBankRows);
export const createSampleQboWorkbook = () => buildWorkbookBuffer(sampleQboRows);

export const createWorkbookFromRows = (rows: Array<Array<string | number>>) => buildWorkbookBuffer(rows);
