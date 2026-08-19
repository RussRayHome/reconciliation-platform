import {
  amountMismatchBankRows,
  amountMismatchGlRows,
  bankHeaderOnlyRows,
  createWorkbookFromRows,
  duplicateInBankBankRows,
  duplicateInBankGlRows,
  glHeaderOnlyRows,
  missingFromGlBankRows,
  missingFromGlGlRows,
  sampleBankRows,
  sampleGlRows,
  timingDifferenceBankRows,
  timingDifferenceGlRows,
} from '@recon/test-fixtures';

/**
 * Bank/GL row sets for E2E specs exercising the upload flow, matching the File Validation
 * Engine's real canonical schema (transaction-csv-spec.md): Date/Description/Sequence Number/
 * Check Number/Debit/Credit/Balance for Bank, Date/Type/Num/Name/Memo/Amount for GL -- the same
 * headers the app's actual downloadable Bank/GL templates ship.
 *
 * A distinct "FileValidation" copy of these fixtures used to exist here, built against an
 * invented snake_case schema (transaction_id/account_id/entry_id/debit_amount/...) that shared
 * zero header overlap with the real templates -- every file this module generated failed
 * structural validation immediately. That schema never should have diverged from
 * packages/test-fixtures's own sampleRows.ts, which already modeled the real templates
 * correctly; this module now thinly wraps those fixtures (same scenario names, same dates/
 * amounts/description tokens that drive each exception category) instead of maintaining a
 * second, drift-prone copy.
 */

export const sampleBankFileValidationRows = sampleBankRows;
export const sampleGlFileValidationRows = sampleGlRows;

export const createSampleBankFileValidationWorkbook = () => createWorkbookFromRows(sampleBankRows);
export const createSampleGlFileValidationWorkbook = () => createWorkbookFromRows(sampleGlRows);

export const bankHeaderOnlyFileValidationRows = bankHeaderOnlyRows;
export const glHeaderOnlyFileValidationRows = glHeaderOnlyRows;

// ─── Exception category scenarios ────────────────────────────────────────────
// Re-exported from packages/test-fixtures/src/sampleRows.ts under this module's established
// names -- same dates/amounts/description tokens, so each scenario still drives the same
// exception category.

export const missingFromGlBankFileValidationRows = missingFromGlBankRows;
export const missingFromGlGlFileValidationRows = missingFromGlGlRows;

export const amountMismatchBankFileValidationRows = amountMismatchBankRows;
export const amountMismatchGlFileValidationRows = amountMismatchGlRows;

export const duplicateInBankBankFileValidationRows = duplicateInBankBankRows;
export const duplicateInBankGlFileValidationRows = duplicateInBankGlRows;

export const timingDifferenceBankFileValidationRows = timingDifferenceBankRows;
export const timingDifferenceGlFileValidationRows = timingDifferenceGlRows;

/** Combines every scenario above onto one bank sheet and one GL sheet. Each source scenario's own
 * Bank rows independently number their "Sequence Number" column starting from 1 (designed to be
 * uploaded alone) -- concatenated as-is, that collides (multiple rows sharing Sequence Number
 * "1") and trips BANK_SEQUENCE_DUPLICATE, silently dropping rows. Renumbered sequentially across
 * the whole combined set instead. */
export const allExceptionsBankFileValidationRows = (() => {
  const SEQUENCE_NUMBER_COLUMN = 2;
  const dataRows = [
    ...missingFromGlBankRows.slice(1),
    ...amountMismatchBankRows.slice(1),
    ...duplicateInBankBankRows.slice(1),
    ...timingDifferenceBankRows.slice(1),
  ];
  return [
    sampleBankRows[0]!,
    ...dataRows.map((row, index) => {
      const renumbered = [...row];
      renumbered[SEQUENCE_NUMBER_COLUMN] = String(index + 1);
      return renumbered;
    }),
  ];
})();
export const allExceptionsGlFileValidationRows = [
  sampleGlRows[0]!,
  ...amountMismatchGlRows.slice(1),
  ...duplicateInBankGlRows.slice(1),
  ...timingDifferenceGlRows.slice(1),
];

export const createAllExceptionsBankFileValidationWorkbook = () =>
  createWorkbookFromRows(allExceptionsBankFileValidationRows);
export const createAllExceptionsGlFileValidationWorkbook = () =>
  createWorkbookFromRows(allExceptionsGlFileValidationRows);
