/** An AP/Billing subledger file's name must start with its entity id, followed by `-` or `_`
 * (R1 WP4), mirroring the bank account-number filename convention
 * (`bankAccountFilename.ts`'s own doc comment) -- e.g. `E100_ap-export.csv` or
 * `E100-AcmeCorp-Subledger.xlsx`. Shared between the server-side ingestion step and the
 * client-side upload pre-check (`apps/web`'s `SourceDropZone`), which is why this lives in
 * `@recon/domain` rather than `@recon/core` -- `apps/web` has no dependency on `@recon/core`. */
export const AP_ENTITY_ID_FILENAME_PATTERN = /^([A-Za-z0-9]+)[-_]/;

/** Returns the entity id embedded in an AP/Billing file's original filename, or null if the
 * filename doesn't start with `<entityId><-|_>`. Unlike a bank account number, an entity id is
 * alphanumeric, not purely numeric -- so this returns the matched id verbatim rather than a
 * fixed-length numeric suffix the way `parseBankAccountLast4FromFilename` does. */
export const parseApEntityIdFromFilename = (filename: string): string | null => {
  const match = AP_ENTITY_ID_FILENAME_PATTERN.exec(filename);
  return match ? match[1]! : null;
};
