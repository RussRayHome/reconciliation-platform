/** A bank file's name must start with its account number (or the last 4 digits of it), followed
 * by `-` or `_` (ADR-0003 §3, Issue #141) -- e.g. `4321_bank-export.csv` or
 * `123214321-Chase-Activity.xlsx`. Shared between the server-side merge step
 * (`@recon/core`'s `mergeBankFiles`) and the client-side upload pre-check
 * (`apps/web`'s `SourceDropZone`), which is why this lives in `@recon/domain` rather than
 * `@recon/core` -- `apps/web` has no dependency on `@recon/core`. */
export const BANK_ACCOUNT_FILENAME_PATTERN = /^(\d{4,})[-_]/;

/** Returns the last 4 digits of the account number embedded in a bank file's original filename,
 * or null if the filename doesn't start with `<digits><-|_>`. */
export const parseBankAccountLast4FromFilename = (filename: string): string | null => {
  const match = BANK_ACCOUNT_FILENAME_PATTERN.exec(filename);
  return match ? match[1]!.slice(-4) : null;
};
