/**
 * Raw spreadsheet row arrays for every exception scenario and edge case used across unit,
 * integration, and E2E test suites. Each named export is a self-contained set of header +
 * data rows for a specific bank or GL file. Workbook factory helpers at the bottom of the
 * file convert any row array into an ExcelJS buffer.
 */
import { Buffer } from 'node:buffer';
import ExcelJS from 'exceljs';

export const bankHeaderOnlyRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
];

export const glHeaderOnlyRows = [['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount']];

export const sampleBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-01-02', 'ACME OFFICE SUPPLY', '1', '', '125.50', '', '9874.50'],
  ['2025-01-03', 'PAYROLL ACH', '2', '', '3200.00', '', '6674.50'],
  ['2025-01-05', 'CLIENT PAYMENT NORTH', '3', '', '', '3200.00', '9874.50'],
  ['2025-01-08', 'CHECK 1052 RENT', '4', '1052', '1600.00', '', '8274.50'],
  ['2025-01-09', 'CHECK 1052 RENT', '5', '1052', '1600.00', '', '6674.50'],
  ['2025-01-11', 'CARD ADJUSTMENT', '6', '', '5.00', '', '6669.50'],
];

export const sampleGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-01-01', 'Journal', '', '', 'Beginning Balance', '15000.00'],
  ['2025-01-02', 'Expense', '', 'Acme Office Supplies', 'Office supplies order', '-125.50'],
  ['2025-01-03', 'Expense', '', 'Payroll Processor', 'Payroll ACH batch', '-3200.00'],
  ['2025-01-05', 'Deposit', '', 'North Client', 'Client payment North', '3200.00'],
  ['2025-01-10', 'Check', '1052', 'Landlord LLC', 'Rent January', '-1600.00'],
  ['2025-01-10', 'Expense', '', '', 'Card adjustment fee', '-5.00'],
];

export const referenceMismatchBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-02-05', 'LANDLORD RENT CHECK 2150 FEB', '1', '2150', '1600.00', '', '8400.00'],
];

export const referenceMismatchGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-02-05', 'Check', '2151', 'Landlord Rent', 'Landlord rent check 2151 feb', '-1600.00'],
];

export const amountMismatchBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-03-04', 'WIRE VENDOR ALPHA INV-993', '1', '', '500.00', '', '7900.00'],
];

export const amountMismatchGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-03-04', 'Expense', '', 'Vendor Alpha', 'Invoice 993 payment', '-520.00'],
];

export const timingDifferenceBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-04-29', 'PAYROLL PROCESSOR APRIL BATCH', '1', '', '2400.00', '', '5500.00'],
];

export const timingDifferenceGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-05-18', 'Expense', '', 'Payroll Processor', 'Payroll processor April batch', '-2400.00'],
];

export const splitCombineBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-07-15', 'VENDOR SETTLEMENT BATCH', '1', '', '300.00', '', '6400.00'],
];

export const splitCombineGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-07-15', 'Expense', '', 'Vendor Alpha', 'Vendor settlement part 1', '-120.00'],
  ['2025-07-16', 'Expense', '', 'Vendor Alpha', 'Vendor settlement part 2', '-180.00'],
];

export const depositGroupingBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-08-05', 'MERCHANT SERVICES BATCH DEPOSIT', '1', '', '', '3200.00', '9600.00'],
];

export const depositGroupingGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-08-04', 'Deposit', '', 'Customer A', 'Batch receipt A', '2000.00'],
  ['2025-08-05', 'Deposit', '', 'Customer B', 'Batch receipt B', '1200.00'],
];

export const splitCombineNearMissBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-07-22', 'VENDOR SETTLEMENT BATCH', '1', '', '300.00', '', '6100.00'],
];

export const splitCombineNearMissGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-07-22', 'Expense', '', 'Vendor Alpha', 'Vendor settlement part 1', '-120.00'],
  ['2025-07-23', 'Expense', '', 'Vendor Alpha', 'Vendor settlement part 2', '-179.97'],
];

export const depositGroupingOversizedBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-08-12', 'MERCHANT SERVICES BATCH DEPOSIT', '1', '', '', '3200.00', '12800.00'],
];

export const depositGroupingOversizedGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-08-01', 'Deposit', '', 'Customer A', 'Batch receipt A', '1000.00'],
  ['2025-08-01', 'Deposit', '', 'Customer B', 'Batch receipt B', '800.00'],
  ['2025-08-01', 'Deposit', '', 'Customer C', 'Batch receipt C', '700.00'],
  ['2025-08-01', 'Deposit', '', 'Customer D', 'Batch receipt D', '700.00'],
];

export const ambiguousBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-06-10', 'CARD SHELL FUEL', '1', '', '85.00', '', '4900.00'],
];

export const ambiguousGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-06-15', 'Expense', '', 'Merchant A', 'Card shell fuel tag-a', '-85.00'],
  ['2025-06-15', 'Expense', '', 'Vendor B', 'Card shell fuel tag-b', '-85.00'],
];

export const missingFromGlBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-02', 'UNBOOKED BANK FEE', '1', '', '45.00', '', '9955.00'],
];

export const missingFromGlGlRows = glHeaderOnlyRows;

export const missingFromBankBankRows = bankHeaderOnlyRows;

export const missingFromBankGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-09-03', 'Expense', '', 'North Vendor', 'Vendor payment missing from bank', '-450.00'],
];

export const duplicateInBankBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-04', 'VENDOR OMEGA EFT', '1', '', '210.00', '', '9745.00'],
  ['2025-09-05', 'VENDOR OMEGA EFT', '2', '', '210.00', '', '9535.00'],
];

export const duplicateInBankGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-09-04', 'Expense', '', 'Vendor Omega', 'Vendor omega eft', '-210.00'],
];

export const duplicateInGlBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-06', 'CLIENT REFUND SIGMA', '1', '', '180.00', '', '9355.00'],
];

export const duplicateInGlGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-09-06', 'Expense', '', 'Client Sigma', 'Client refund sigma', '-180.00'],
  ['2025-09-07', 'Expense', '', 'Client Sigma', 'Client refund sigma', '-180.00'],
];

export const likelyMiscodingBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-03-10', 'ACME PAYROLL', '1', '', '575.00', '', '9425.00'],
];

export const likelyMiscodingGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-03-11', 'Expense', '', 'Office Depot', 'Office supplies', '-575.00'],
];

export const dateVarianceBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-04-01', 'CLIENT BATCH DEPOSIT', '1', '', '', '3200.00', '8200.00'],
];

export const dateVarianceGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-04-15', 'Journal Entry', '', 'Client Batch', 'Client batch deposit clearing', '3200.00'],
];

export const referenceNumberMismatchBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Reference', 'Debit', 'Credit', 'Balance'],
  ['2025-02-12', 'WIRE CLIENT REF 7788 SETTLEMENT', '1', '7788', '450.00', '', '9550.00'],
];

export const referenceNumberMismatchGlRows = [
  ['Date', 'Type', 'Reference', 'Name', 'Memo', 'Amount'],
  ['2025-02-12', 'Expense', '7799', 'Client Wire', 'Wire client ref settlement', '-450.00'],
];

export const descriptionVarianceBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-02-18', 'OFFICE DEPOT MONTHLY RUN', '1', '', '245.00', '', '9305.00'],
];

export const descriptionVarianceGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-02-18', 'Expense', '', 'Office Depot', 'Client charge', '-245.00'],
];

export const outstandingCheckBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-15', 'MONTH-END OPERATING', '1', '', '350.00', '', '9000.00'],
];

export const outstandingCheckGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-11-07', 'Check', '1201', 'Vendor B', 'Normal uncleared check', '-273.50'],
];

export const staleOutstandingBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-03-31', 'OPERATING ACTIVITY', '1', '', '200.00', '', '800.00'],
  ['2025-04-30', 'MONTH-END ACTIVITY', '2', '', '100.00', '', '700.00'],
];

export const staleOutstandingGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-02-10', 'Check', '1124', 'Vendor A', 'Uncleared check', '-150.00'],
];

export const staleOutstandingBelowThresholdBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-04-29', 'OPERATING ACTIVITY', '1', '', '200.00', '', '800.00'],
];

export const staleOutstandingBelowThresholdGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-03-16', 'Check', '1045', 'Vendor A', 'Recent unmatched check', '-150.00'],
];

export const staleOutstandingMixedResidualBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-03-15', 'UNBOOKED BANK FEE', '1', '', '45.00', '', '955.00'],
  ['2025-04-30', 'MONTH-END ACTIVITY', '2', '', '100.00', '', '750.00'],
];

export const staleOutstandingMixedResidualGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-03-16', 'Check', '1045', 'Vendor A', 'Uncleared check', '-150.00'],
];

export const reversalVoidBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-10-01', 'BANK DEBIT JOURNAL ENTRY', '1', '', '500.00', '', '9500.00'],
  ['2025-10-02', 'BANK CREDIT JOURNAL ENTRY', '2', '', '', '500.00', '10000.00'],
];

export const reversalVoidGlRows = glHeaderOnlyRows;

export const achReturnBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-10-10', 'ACH DEBIT VENDOR GAMMA', '1', '', '300.00', '', '9700.00'],
  ['2025-10-11', 'NSF RETURN ACH VENDOR GAMMA', '2', '', '', '300.00', '10000.00'],
];

export const achReturnGlRows = glHeaderOnlyRows;

export const depositInTransitBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-15', 'OPERATING EXPENSE UNMATCHED', '1', '', '100.00', '', '9900.00'],
];

export const depositInTransitGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-11-12', 'Deposit', '', 'Remote Client', 'Client deposit in transit', '250.00'],
];

export const chargebackReturnBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-20', 'CLIENT INVOICE SETTLEMENT ALPHA', '1', '', '', '750.00', '10750.00'],
  ['2025-10-25', 'CHARGEBACK DISPUTED CLIENT ALPHA', '2', '', '750.00', '', '10000.00'],
];

export const chargebackReturnGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-09-20', 'Income', '', 'Client Alpha', 'Client invoice settlement alpha', '750.00'],
];

export const interestIncomeBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-30', 'INTEREST EARNED SAVINGS', '1', '', '', '12.50', '10012.50'],
];

export const interestIncomeGlRows = glHeaderOnlyRows;

export const intercompanyMismatchBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-09-25', 'DUE FROM SUBSIDIARY ALPHA', '1', '', '1000.00', '', '9000.00'],
];

export const intercompanyMismatchGlRows = glHeaderOnlyRows;

// FeeNettingMatch: bank credit = GL revenue + GL fee
export const feeNettingMatchBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-10-01', 'STRIPE PAYOUT NET', '1', '', '', '93.17', '10093.17'],
];

export const feeNettingMatchGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-10-01', 'Sales Receipt', '', 'Stripe', 'Stripe gross revenue payout', '101.80'],
  ['2025-10-01', 'Expense', '', 'Stripe', 'Stripe processing fee', '-8.63'],
];

// PartialPaymentMatch: two bank debits sum to one GL debit
export const partialPaymentMatchBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-10-05', 'INSTALLMENT VENDOR DELTA INV-992 PART 1', '1', '', '150.75', '', '9849.25'],
  ['2025-10-09', 'INSTALLMENT VENDOR DELTA INV-992 PART 2', '2', '', '150.75', '', '9698.50'],
];

export const partialPaymentMatchGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  [
    '2025-10-05',
    'Bill Payment',
    '',
    'Vendor Delta',
    'Vendor delta inv 992 installment plan',
    '-301.50',
  ],
];

// PayrollBatchMatch: one bank payroll debit matches multiple GL payroll lines
export const payrollBatchMatchBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-01', 'PAYROLL DIRECT DEPOSIT BATCH', '1', '', '5001.00', '', '4999.00'],
];

export const payrollBatchMatchGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-11-01', 'Expense', '', 'Employee A', 'Payroll employee a salary nov', '-3001.00'],
  ['2025-11-01', 'Expense', '', 'Employee B', 'Payroll employee b salary nov', '-2000.00'],
];

// BankServiceChargeAmortization: one bank fee debit matches multiple GL expense lines
export const bankServiceChargeAmortizationBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-10-15', 'MONTHLY SERVICE FEE ACCOUNT MAINTENANCE', '1', '', '121.00', '', '9879.00'],
];

export const bankServiceChargeAmortizationGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-10-15', 'Expense', '', 'Bank', 'Bank fee admin account maintenance', '-61.00'],
  ['2025-10-15', 'Expense', '', 'Bank', 'Bank fee wire transfer services', '-60.00'],
];

// LoanPaymentSplit: one bank mortgage debit matches two GL principal+interest lines
export const loanPaymentSplitBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-10', 'MORTGAGE PAYMENT WELLS FARGO', '1', '', '1250.00', '', '8750.00'],
];

export const loanPaymentSplitGlRows = [
  ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
  ['2025-11-10', 'Expense', '', 'Wells Fargo', 'Mortgage loan principal reduction', '-1000.00'],
  ['2025-11-10', 'Expense', '', 'Wells Fargo', 'Mortgage loan interest expense', '-250.00'],
];

// NSFReturnedDeposit: bank debit with NSF keywords and no GL counterpart
export const nsfReturnedDepositBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-08', 'NSF RETURNED CHECK CUSTOMER ALPHA', '1', '', '317.89', '', '9682.11'],
];

export const nsfReturnedDepositGlRows = [['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount']];

// VoidedCheckCleared: bank check debit with check number and no GL counterpart
export const voidedCheckClearedBankRows = [
  ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
  ['2025-11-12', 'CHECK', '1', '1042', '657.33', '', '9342.67'],
];

export const voidedCheckClearedGlRows = [['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount']];

// ─── Multi-account bank merge (Issue #141 / ADR-0003) ────────────────────────
// One month, two bank accounts (1234/5678), one GL spanning both. Deliberately includes two
// same-day, same-description pairs across the accounts -- "PAYROLL ACH BATCH" (2026-02-09) and
// "INTEREST EARNED" (2026-02-26) -- disambiguated in the GL memos with "(acct 1234)"/
// "(acct 5678)", so a merge/match test can prove each bank row lands against its own account's GL
// line rather than cross-wiring the two just because the date and description happen to match.

export const multiAccountBankRowsAccountA = [
  ['Date', 'Description', 'Check Number', 'Reference', 'Sequence Number', 'Debit', 'Credit', 'Balance'],
  ['2026-02-02', 'CHECK 5010 OFFICE RENT', '5010', '', '000001', '2100.00', '', '7900.00'],
  ['2026-02-03', 'ACH VENDOR SUPPLY CO', '', '', '000002', '340.25', '', '7559.75'],
  ['2026-02-04', 'CLIENT PAYMENT ACME CORP', '', '', '000003', '', '5200.00', '12759.75'],
  ['2026-02-05', 'WIRE VENDOR BRIGHTPATH REF-4471', '', '4471', '000004', '1875.00', '', '10884.75'],
  ['2026-02-06', 'CARD PURCHASE OFFICE DEPOT', '', '', '000005', '128.60', '', '10756.15'],
  ['2026-02-09', 'PAYROLL ACH BATCH', '', '', '000006', '6400.00', '', '4356.15'],
  ['2026-02-10', 'CLIENT PAYMENT NORTHWIND', '', '', '000007', '', '3100.00', '7456.15'],
  ['2026-02-11', 'CHECK 5011 INSURANCE', '5011', '', '000008', '610.00', '', '6846.15'],
  ['2026-02-12', 'UTILITY AUTOPAY CITY POWER', '', '', '000009', '245.80', '', '6600.35'],
  ['2026-02-16', 'ACH CREDIT REBATE VENDOR', '', '', '000010', '', '88.40', '6688.75'],
  ['2026-02-17', 'WIRE VENDOR CASCADE REF-5591', '', '5591', '000011', '2225.00', '', '4463.75'],
  ['2026-02-18', 'CLIENT PAYMENT DELTA GROUP', '', '', '000012', '', '4400.00', '8863.75'],
  ['2026-02-20', 'CARD PURCHASE STAPLES', '', '', '000013', '76.30', '', '8787.45'],
  ['2026-02-24', 'CHECK 5012 MAINTENANCE', '5012', '', '000014', '950.00', '', '7837.45'],
  ['2026-02-26', 'INTEREST EARNED', '', '', '000015', '', '14.20', '7851.65'],
];

export const multiAccountBankRowsAccountB = [
  ['Date', 'Description', 'Check Number', 'Reference', 'Sequence Number', 'Debit', 'Credit', 'Balance'],
  ['2026-02-02', 'CHECK 7710 WAREHOUSE LEASE', '7710', '', '000001', '3400.00', '', '8600.00'],
  ['2026-02-03', 'ACH VENDOR PACKAGING CO', '', '', '000002', '512.75', '', '8087.25'],
  ['2026-02-04', 'CLIENT PAYMENT ORION LLC', '', '', '000003', '', '2750.00', '10837.25'],
  ['2026-02-05', 'WIRE VENDOR TIDEWATER REF-8820', '', '8820', '000004', '990.00', '', '9847.25'],
  ['2026-02-06', 'CARD PURCHASE UPS STORE', '', '', '000005', '64.15', '', '9783.10'],
  ['2026-02-09', 'PAYROLL ACH BATCH', '', '', '000006', '4100.00', '', '5683.10'],
  ['2026-02-10', 'CLIENT PAYMENT SUMMIT RETAIL', '', '', '000007', '', '2600.00', '8283.10'],
  ['2026-02-11', 'CHECK 7711 EQUIPMENT SERVICE', '7711', '', '000008', '415.00', '', '7868.10'],
  ['2026-02-12', 'UTILITY AUTOPAY WATER DIST', '', '', '000009', '132.90', '', '7735.20'],
  ['2026-02-16', 'ACH CREDIT VENDOR REFUND', '', '', '000010', '', '55.00', '7790.20'],
  ['2026-02-17', 'WIRE VENDOR HARBOR REF-9012', '', '9012', '000011', '1730.00', '', '6060.20'],
  ['2026-02-18', 'CLIENT PAYMENT PIONEER INC', '', '', '000012', '', '3900.00', '9960.20'],
  ['2026-02-20', 'CARD PURCHASE HOME DEPOT', '', '', '000013', '210.45', '', '9749.75'],
  ['2026-02-24', 'CHECK 7712 REPAIR SERVICES', '7712', '', '000014', '680.00', '', '9069.75'],
  ['2026-02-26', 'INTEREST EARNED', '', '', '000015', '', '9.60', '9079.35'],
];

export const multiAccountGlRows = [
  ['Date', 'Type', 'Num', 'Reference', 'Name', 'Memo', 'Amount'],
  ['2026-02-02', 'Check', '5010', '', 'Riverside Properties', 'Check 5010 office rent', '-2100.00'],
  ['2026-02-02', 'Check', '7710', '', 'Westgate Holdings', 'Check 7710 warehouse lease', '-3400.00'],
  ['2026-02-03', 'Expense', '', '', 'Supply Co', 'ACH vendor supply co', '-340.25'],
  ['2026-02-03', 'Expense', '', '', 'Packaging Co', 'ACH vendor packaging co', '-512.75'],
  ['2026-02-04', 'Deposit', '', '', 'Acme Corp', 'Client payment acme corp', '5200.00'],
  ['2026-02-04', 'Deposit', '', '', 'Orion LLC', 'Client payment orion llc', '2750.00'],
  ['2026-02-05', 'Expense', '', '4471', 'Brightpath Vendor', 'Wire vendor brightpath ref-4471', '-1875.00'],
  ['2026-02-05', 'Expense', '', '8820', 'Tidewater Vendor', 'Wire vendor tidewater ref-8820', '-990.00'],
  ['2026-02-06', 'Expense', '', '', 'Office Depot', 'Card purchase office depot', '-128.60'],
  ['2026-02-06', 'Expense', '', '', 'UPS Store', 'Card purchase ups store', '-64.15'],
  ['2026-02-09', 'Expense', '', '', 'Payroll Processor', 'Payroll ACH batch (acct 1234)', '-6400.00'],
  ['2026-02-09', 'Expense', '', '', 'Payroll Processor', 'Payroll ACH batch (acct 5678)', '-4100.00'],
  ['2026-02-10', 'Deposit', '', '', 'Northwind Client', 'Client payment northwind', '3100.00'],
  ['2026-02-10', 'Deposit', '', '', 'Summit Retail', 'Client payment summit retail', '2600.00'],
  ['2026-02-11', 'Check', '5011', '', 'Guardian Insurance', 'Check 5011 insurance', '-610.00'],
  ['2026-02-11', 'Check', '7711', '', 'FieldTech Service', 'Check 7711 equipment service', '-415.00'],
  ['2026-02-12', 'Expense', '', '', 'City Power', 'Utility autopay city power', '-245.80'],
  ['2026-02-12', 'Expense', '', '', 'Water District', 'Utility autopay water dist', '-132.90'],
  ['2026-02-16', 'Deposit', '', '', 'Rebate Vendor', 'ACH credit rebate vendor', '88.40'],
  ['2026-02-16', 'Deposit', '', '', 'Vendor Refund', 'ACH credit vendor refund', '55.00'],
  ['2026-02-17', 'Expense', '', '5591', 'Cascade Vendor', 'Wire vendor cascade ref-5591', '-2225.00'],
  ['2026-02-17', 'Expense', '', '9012', 'Harbor Vendor', 'Wire vendor harbor ref-9012', '-1730.00'],
  ['2026-02-18', 'Deposit', '', '', 'Delta Group', 'Client payment delta group', '4400.00'],
  ['2026-02-18', 'Deposit', '', '', 'Pioneer Inc', 'Client payment pioneer inc', '3900.00'],
  ['2026-02-20', 'Expense', '', '', 'Staples', 'Card purchase staples', '-76.30'],
  ['2026-02-20', 'Expense', '', '', 'Home Depot', 'Card purchase home depot', '-210.45'],
  ['2026-02-24', 'Check', '5012', '', 'Maintenance Co', 'Check 5012 maintenance', '-950.00'],
  ['2026-02-24', 'Check', '7712', '', 'Repair Services Co', 'Check 7712 repair services', '-680.00'],
  ['2026-02-26', 'Deposit', '', '', 'Bank', 'Interest earned (acct 1234)', '14.20'],
  ['2026-02-26', 'Deposit', '', '', 'Bank', 'Interest earned (acct 5678)', '9.60'],
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
/** Creates an Excel workbook buffer from the default sample GL rows. */
export const createSampleGlWorkbook = () => buildWorkbookBuffer(sampleGlRows);

/** Creates an Excel workbook buffer from arbitrary row data. */
export const createWorkbookFromRows = (rows: Array<Array<string | number>>) =>
  buildWorkbookBuffer(rows);
