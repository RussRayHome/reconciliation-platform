import type { ValidationIssue } from './types';

/**
 * Step 1 & Step 2 of the ordered engine (transaction-csv-spec.md §4) -- these concern column
 * *layout*, not per-field values, so they live here rather than delegating to the ported Step 3
 * row validators (`rowValidators.ts`), per the adjusted plan's own split.
 */

/**
 * Step 1 -- header row present and first. `schema.ts`'s own `validateHeaders` doesn't implement
 * this (it only checks membership, not "is row 1 recognizable as a header at all"), so this is
 * new logic, not a port. A parser always treats row 1 as "the header row" mechanically; this
 * decides whether that row actually looks like one. Heuristic: if none of the actual headers
 * match any known column name (required or optional), row 1 reads as data, not a header (spec:
 * "the first row is data (no recognizable header)").
 */
export const checkHeaderPresent = (
  headers: string[],
  allKnownHeaders: readonly string[],
): ValidationIssue[] => {
  if (headers.length === 0) {
    return [
      {
        severity: 'ERROR',
        code: 'STRUCT_HEADER_MISSING',
        message: 'No header row was found -- the file appears to be empty.',
      },
    ];
  }

  const hasAnyKnownHeader = headers.some((header) => allKnownHeaders.includes(header));
  if (!hasAnyKnownHeader) {
    return [
      {
        severity: 'ERROR',
        code: 'STRUCT_HEADER_MISSING',
        message:
          'The first row does not match any expected column name -- it reads as a data row, not a header.',
      },
    ];
  }

  return [];
};

/**
 * Step 2 -- columns present and in the required order. Per spec §1's own summary ("missing/
 * misordered **required** columns are an error") and §4 ("A missing required column fails
 * STRUCT_COLUMN_MISSING"), MISSING and ORDER are scoped to `requiredHeaders` only -- an optional
 * column absent entirely (e.g. banking's `memo`, `counterparty_account`) is not an error, even
 * though it's part of the full canonical template. `allKnownHeaders` (the full per-format column
 * list) is used only to decide UNKNOWN: a present-but-optional column must not be warned as
 * unrecognized just because it isn't required.
 *
 * Three independent checks, each producing its own code:
 *
 * 1. Missing: any required header absent from the actual headers.
 * 2. Order: among headers that ARE both present and required, compare their relative sequence to
 *    the required sequence (also restricted to present columns). Deliberately ignores optional and
 *    unknown columns for this comparison and reports order violations only among required columns
 *    that genuinely exist -- letting a single missing column report once (STRUCT_COLUMN_MISSING)
 *    rather than cascading into an order error for every column after it, which would bury the one
 *    actionable finding under noise. Not specified at this level of detail by the source material;
 *    this is the sensible reading that keeps the two codes meaningfully distinct.
 * 3. Unknown: any actual header not in the full known set (required or optional), ignored rather
 *    than rejected.
 */
export const checkColumnOrder = (
  headers: string[],
  requiredHeaders: readonly string[],
  allKnownHeaders: readonly string[],
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  for (const header of missing) {
    issues.push({
      severity: 'ERROR',
      code: 'STRUCT_COLUMN_MISSING',
      field: header,
      message: `Required column "${header}" is absent.`,
    });
  }

  const requiredPresentOrder = requiredHeaders.filter((header) => headers.includes(header));
  const actualPresentRequiredOrder = headers.filter((header) => requiredHeaders.includes(header));
  requiredPresentOrder.forEach((requiredHeader, index) => {
    if (actualPresentRequiredOrder[index] !== requiredHeader) {
      const actualPosition = headers.indexOf(requiredHeader);
      issues.push({
        severity: 'ERROR',
        code: 'STRUCT_COLUMN_ORDER',
        field: requiredHeader,
        message: `"${requiredHeader}" found at position ${actualPosition + 1}, expected earlier/later relative to the other required columns.`,
      });
    }
  });

  const unknown = headers.filter((header) => !allKnownHeaders.includes(header));
  for (const header of unknown) {
    issues.push({
      severity: 'WARNING',
      code: 'STRUCT_COLUMN_UNKNOWN',
      field: header,
      message: `Unrecognized column "${header}" ignored.`,
    });
  }

  return issues;
};
