import type { BusinessField, ColumnAliasMap } from '@recon/domain';

const normalize = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Small hand-rolled Levenshtein edit distance — no fuzzy-match dependency for a ~20-line job. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = (previousRow[j] ?? 0) + 1;
      const insertion = (currentRow[j - 1] ?? 0) + 1;
      const substitution = (previousRow[j - 1] ?? 0) + cost;
      currentRow.push(Math.min(deletion, insertion, substitution));
    }
    previousRow = currentRow;
  }

  return previousRow[b.length] ?? Math.max(a.length, b.length);
}

/** A normalized column header is accepted as a fuzzy match within roughly one edit per three characters. */
const MAX_SUGGESTION_DISTANCE_RATIO = 0.34;

/**
 * Suggests a canonical field per source column header: an exact match against `aliases` (or the
 * field id itself) first, a bounded Levenshtein fallback second, otherwise left unmapped. Each
 * canonical field is claimed by at most one column, so two similarly-named source columns never
 * both suggest the same database column.
 */
export function suggestMapping(
  columns: string[],
  aliases: ColumnAliasMap,
  availableFields: BusinessField[],
): Record<string, BusinessField> {
  const normalizedAliasIndex = new Map<string, BusinessField>();

  for (const field of availableFields) {
    normalizedAliasIndex.set(normalize(field), field);
    for (const alias of aliases[field] ?? []) {
      normalizedAliasIndex.set(normalize(alias), field);
    }
  }

  const suggestions: Record<string, BusinessField> = {};
  const claimedFields = new Set<BusinessField>();

  for (const column of columns) {
    const normalizedColumn = normalize(column);
    const exactField = normalizedAliasIndex.get(normalizedColumn);

    if (exactField && !claimedFields.has(exactField)) {
      suggestions[column] = exactField;
      claimedFields.add(exactField);
      continue;
    }

    let bestField: BusinessField | null = null;
    let bestDistance = Infinity;

    for (const [aliasText, field] of normalizedAliasIndex) {
      if (claimedFields.has(field)) continue;
      const distance = levenshtein(normalizedColumn, aliasText);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestField = field;
      }
    }

    const threshold = Math.max(
      1,
      Math.round(normalizedColumn.length * MAX_SUGGESTION_DISTANCE_RATIO),
    );
    if (bestField && bestDistance <= threshold) {
      suggestions[column] = bestField;
      claimedFields.add(bestField);
    }
  }

  return suggestions;
}
