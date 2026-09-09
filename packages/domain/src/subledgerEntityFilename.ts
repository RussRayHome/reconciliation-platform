/** A subledger file's name must start with its entity id, followed by `-` or `_` (R1 WP4),
 * mirroring the bank account-number filename convention (`bankAccountFilename.ts`'s own doc
 * comment) -- e.g. `E100_ap-export.csv` or `E100-AcmeCorp-Subledger.xlsx`.
 *
 * Lives in `@recon/domain` rather than `@recon/core` because `apps/web` consumes it and has no
 * dependency on `@recon/core`. (The previous comment here also claimed a server-side ingestion
 * consumer; there is none -- `apps/api` never imported it.)
 *
 * AP and AR share this pattern deliberately: it describes a *filename shape*, not a validation
 * rule. The Phase 2 ruling on #401 permits the two source types to share the `BILLING` source type
 * and this shape while forbidding them to share a rule set -- so the rejection *codes* stay
 * per-type (`UPLOAD_AP_FILENAME_INVALID` / `UPLOAD_AR_FILENAME_INVALID`) even though one function
 * produces both. Without that split an AR file would surface AP-worded errors, and screen 1b's
 * exception copy would inherit that wording verbatim. */
export const SUBLEDGER_ENTITY_ID_FILENAME_PATTERN = /^([A-Za-z0-9]+)[-_]/;

/** Returns the entity id embedded in a subledger file's original filename, or null if the filename
 * doesn't start with `<entityId><-|_>`. Unlike a bank account number, an entity id is
 * alphanumeric, not purely numeric -- so this returns the matched id verbatim rather than a
 * fixed-length numeric suffix the way `parseBankAccountLast4FromFilename` does. */
export const parseSubledgerEntityIdFromFilename = (filename: string): string | null => {
  const match = SUBLEDGER_ENTITY_ID_FILENAME_PATTERN.exec(filename);
  return match ? match[1]! : null;
};
