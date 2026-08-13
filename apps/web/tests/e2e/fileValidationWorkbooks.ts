import { createWorkbookFromRows } from '@recon/test-fixtures';

/**
 * Bank/GL row sets shaped for the File Validation Engine (transaction-csv-spec.md §2-3), used by
 * E2E specs exercising the upload flow. Kept separate from packages/test-fixtures's own
 * sampleBankRows/sampleGlRows -- those use the pre-File-Validation header convention
 * (Date/Description/Debit/Credit/...) and are still relied on by packages/core's own matching-
 * engine unit tests, so they can't be changed to the new headers without breaking those.
 *
 * Header order matters for Step 2 (COLUMN_ORDER): only the relative order among headers that are
 * both present and required is checked, but keeping the full column set consistent with the
 * spec's required order avoids any ambiguity.
 *
 * Once a run's files pass File Validation, apps/api/src/app.ts's triggerMatchingForImportRun
 * re-parses the ORIGINAL uploaded bytes through the *existing* GL<->Bank matching pipeline
 * (packages/core/src/parsers/excelParser.ts's own fuzzy alias resolution against
 * packages/config/src/default-config.ts's baseAliases) -- it does not consume the File
 * Validation Engine's normalized output. transaction_id/account_id/posted_date/amount/
 * transaction_type/description all happen to alias-match the old engine's own business fields
 * (referenceNumber/accountIdentifier/transactionDate/amount/transactionType/description), and
 * GL's debit_amount/credit_amount fuzzy-match the old engine's debit/credit aliases (its
 * 'debitCreditColumns' amount-sign convention for GL), so a File-Validation-shaped workbook is
 * *also* readable by the old engine -- confirmed empirically, not by construction.
 *
 * GL rows use a balanced two-line entry per real-world transaction (one line on the meaningful
 * account, a contra line via CONTRA_GL_LINE) purely to satisfy the File Validation Engine's
 * Step 3 GL_UNBALANCED gate (entry-level debit/credit totals must match per entry_id) -- a
 * single-line entry always fails that gate, which flips the file to INVALID and blocks the
 * automated matching trigger entirely (see runImportValidationWorkflow's
 * `passed = fileOutcomes.every(...)`), landing on the partial-import/all-invalid screens instead
 * of a completed run.
 *
 * The old engine parses each row independently (no entry_id grouping), so the contra line
 * becomes its own GL-side transaction candidate for matching -- if it shared the real line's
 * date and description (as an initial version of this file did), it competed for the same match
 * slot and starved the intended category (empirically: an "Amount Mismatch" scenario produced
 * "Missing from Bank"/"Missing from GL" instead). CONTRA_GL_LINE fixes this by parking every
 * contra line on 2024-01-02 with a distinct account/description, a date far outside every
 * matching-window setting in packages/config/src/default-config.ts (the widest is
 * partialPaymentWindowDays: 90) relative to any scenario date used below (2025-01 through
 * 2025-09), so it can never become a candidate for a real bank row and always lands as its own
 * harmless, isolated "Missing from Bank" exception.
 */

const CONTRA_ACCOUNT_CODE = '9999';
const CONTRA_DESCRIPTION = 'GL balancing entry - do not match';
const CONTRA_DATE = '2024-01-02';

/** entryId's contra line, offsetting `amount` booked as the mirror side of the real GL line. */
const contraGlLine = (entryId: string, lineNumber: string, amount: string, realLineIsDebit: boolean) => [
  entryId,
  lineNumber,
  CONTRA_DATE,
  CONTRA_ACCOUNT_CODE,
  CONTRA_DESCRIPTION,
  'USD',
  realLineIsDebit ? '' : amount,
  realLineIsDebit ? amount : '',
];

const GL_HEADER = [
  'entry_id',
  'line_number',
  'transaction_date',
  'account_code',
  'description',
  'currency_code',
  'debit_amount',
  'credit_amount',
];

const BANK_HEADER = [
  'transaction_id',
  'account_id',
  'posted_date',
  'amount',
  'currency_code',
  'transaction_type',
  'description',
];

export const sampleBankFileValidationRows = [
  BANK_HEADER,
  ['TXN-1001', 'OPERATING-001', '2025-01-02', '-125.50', 'USD', 'DEBIT', 'ACME OFFICE SUPPLY'],
  ['TXN-1002', 'OPERATING-001', '2025-01-03', '-3200.00', 'USD', 'DIRECTDEBIT', 'PAYROLL ACH'],
  ['TXN-1003', 'OPERATING-001', '2025-01-05', '3200.00', 'USD', 'DEP', 'CLIENT PAYMENT NORTH'],
  ['TXN-1004', 'OPERATING-001', '2025-01-08', '-1600.00', 'USD', 'CHECK', 'CHECK 1052 RENT'],
];

export const sampleGlFileValidationRows = [
  GL_HEADER,
  ['E-1001', '1', '2025-01-02', '6100', 'Office supplies order', 'USD', '125.50', ''],
  contraGlLine('E-1001', '2', '125.50', true),
  ['E-1002', '1', '2025-01-03', '6200', 'Payroll ACH batch', 'USD', '3200.00', ''],
  contraGlLine('E-1002', '2', '3200.00', true),
  ['E-1003', '1', '2025-01-05', '4000', 'Client payment North', 'USD', '', '3200.00'],
  contraGlLine('E-1003', '2', '3200.00', false),
  ['E-1004', '1', '2025-01-08', '6300', 'Rent January', 'USD', '1600.00', ''],
  contraGlLine('E-1004', '2', '1600.00', true),
];

/** Creates an Excel workbook buffer with File-Validation-compliant banking headers/rows. */
export const createSampleBankFileValidationWorkbook = () =>
  createWorkbookFromRows(sampleBankFileValidationRows);

/** Creates an Excel workbook buffer with File-Validation-compliant GL headers/rows. */
export const createSampleGlFileValidationWorkbook = () =>
  createWorkbookFromRows(sampleGlFileValidationRows);

export const bankHeaderOnlyFileValidationRows = [BANK_HEADER];

export const glHeaderOnlyFileValidationRows = [GL_HEADER];

// ─── Exception category scenarios ────────────────────────────────────────────
// Each pair mirrors the semantic driver of packages/test-fixtures's old-header scenario of the
// same name (same dates/amounts/description tokens) so the old matching engine classifies it
// under the same category, just re-expressed in File-Validation-compliant headers.

/** Bank transaction with no GL counterpart at all (GL file has zero data rows). */
export const missingFromGlBankFileValidationRows = [
  BANK_HEADER,
  ['TXN-4001', 'OPERATING-001', '2025-09-02', '-45.00', 'USD', 'FEE', 'UNBOOKED BANK FEE'],
];
export const missingFromGlGlFileValidationRows = glHeaderOnlyFileValidationRows;

/** Same date/vendor on both sides, but bank ($500.00) and GL ($520.00) amounts disagree. */
export const amountMismatchBankFileValidationRows = [
  BANK_HEADER,
  ['TXN-4002', 'OPERATING-001', '2025-03-04', '-500.00', 'USD', 'PAYMENT', 'WIRE VENDOR ALPHA INV-993'],
];
export const amountMismatchGlFileValidationRows = [
  GL_HEADER,
  // The old fixture's equivalent row carried the vendor name in a separate Name column
  // ('Vendor Alpha') alongside its Memo ('Invoice 993 payment') -- the old engine's text
  // similarity match considers both. REQUIRED_GL_HEADERS has no separate payee/name field, so
  // the vendor name is folded into description here to keep the same textual overlap with the
  // bank row's "WIRE VENDOR ALPHA INV-993" (shared tokens: VENDOR, ALPHA) that the amount-
  // mismatch classification needs to treat this as a near-miss pair rather than two unrelated,
  // unmatched transactions.
  ['E-4002', '1', '2025-03-04', '6400', 'Vendor Alpha Invoice 993 payment', 'USD', '520.00', ''],
  contraGlLine('E-4002', '2', '520.00', true),
];

/** Two identical bank entries for one real-world GL transaction. */
export const duplicateInBankBankFileValidationRows = [
  BANK_HEADER,
  ['TXN-4003A', 'OPERATING-001', '2025-09-04', '-210.00', 'USD', 'PAYMENT', 'VENDOR OMEGA EFT'],
  ['TXN-4003B', 'OPERATING-001', '2025-09-05', '-210.00', 'USD', 'PAYMENT', 'VENDOR OMEGA EFT'],
];
export const duplicateInBankGlFileValidationRows = [
  GL_HEADER,
  ['E-4003', '1', '2025-09-04', '6500', 'Vendor omega eft', 'USD', '210.00', ''],
  contraGlLine('E-4003', '2', '210.00', true),
];

/** Same amount/description, but bank posts on 2025-04-29 while GL books it on 2025-05-18. */
export const timingDifferenceBankFileValidationRows = [
  BANK_HEADER,
  ['TXN-4004', 'OPERATING-001', '2025-04-29', '-2400.00', 'USD', 'DIRECTDEBIT', 'PAYROLL PROCESSOR APRIL BATCH'],
];
export const timingDifferenceGlFileValidationRows = [
  GL_HEADER,
  ['E-4004', '1', '2025-05-18', '6200', 'Payroll processor April batch', 'USD', '2400.00', ''],
  contraGlLine('E-4004', '2', '2400.00', true),
];

/** Combines every scenario above onto one bank sheet and one GL sheet. */
export const allExceptionsBankFileValidationRows = [
  BANK_HEADER,
  ...missingFromGlBankFileValidationRows.slice(1),
  ...amountMismatchBankFileValidationRows.slice(1),
  ...duplicateInBankBankFileValidationRows.slice(1),
  ...timingDifferenceBankFileValidationRows.slice(1),
];
export const allExceptionsGlFileValidationRows = [
  GL_HEADER,
  ...amountMismatchGlFileValidationRows.slice(1),
  ...duplicateInBankGlFileValidationRows.slice(1),
  ...timingDifferenceGlFileValidationRows.slice(1),
];

export const createAllExceptionsBankFileValidationWorkbook = () =>
  createWorkbookFromRows(allExceptionsBankFileValidationRows);
export const createAllExceptionsGlFileValidationWorkbook = () =>
  createWorkbookFromRows(allExceptionsGlFileValidationRows);
