import { baseAliases } from '@recon/config';
import type { CanonicalField } from '@recon/domain';

import { suggestMapping } from './mappingSuggest';

export interface HeaderPreviewWarning {
  unmatchedRequiredFields: CanonicalField[];
}

/**
 * R2 V6 (warn-only design, Issue #250): fuzzy-matches an uploaded file's header columns against
 * the canonical schema using the same machinery the Create Mapping canvas already uses
 * (`suggestMapping`'s alias-index + bounded Levenshtein), then flags any *required* canonical
 * field with no plausible match anywhere in the header. This never blocks Submit -- the server
 * remains the sole authority on pass/fail -- it only surfaces a heads-up before a doomed upload
 * costs a full round trip. Reuses `suggestMapping` as-is (not a parallel 1:1 comparator) since its
 * existing many-to-many alias-index matching is exactly the shape this needs.
 */
export const computeHeaderPreview = (
  columns: string[],
  canonicalFields: CanonicalField[],
): HeaderPreviewWarning => {
  const canonicalFieldIds = canonicalFields.map((field) => field.id);
  const suggestions = suggestMapping(columns, baseAliases, canonicalFieldIds);
  const matchedFieldIds = new Set(Object.values(suggestions));

  const unmatchedRequiredFields = canonicalFields.filter(
    (field) => field.required && !matchedFieldIds.has(field.id),
  );

  return { unmatchedRequiredFields };
};
