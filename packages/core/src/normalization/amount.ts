/**
 * Shared lenient amount parser, extracted from `normalization/transactions.ts` (Issue #137) so
 * both the old normalization pathway and the File Validation Engine's row validators
 * (`fileValidation/primitives.ts`) parse amounts identically. Recognizes standard, unambiguous
 * accounting notation: currency symbols, thousands-comma separators, whitespace, parentheses
 * negatives, trailing minus, and CR/DR suffixes.
 */
export const parseAmount = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isParenthesesNegative = /^\(.*\)$/.test(trimmed);
  const hasTrailingMinus = /-$/.test(trimmed);
  const directionMatch = /\b(CR|DR)\b$/i.exec(trimmed);

  const unsigned = trimmed
    .replaceAll(/[,$\s]/g, '')
    .replaceAll(/[()]/g, '')
    .replaceAll(/\b(CR|DR)\b/gi, '')
    .replaceAll(/[^0-9.+-]/g, '');

  if (!unsigned || unsigned === '-' || unsigned === '+') {
    return null;
  }

  const parsed = Number(unsigned.replace(/-$/, ''));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const directionToken = directionMatch?.[1]?.toUpperCase();
  let directionalSign = 1;
  if (directionToken === 'DR') {
    directionalSign = -1;
  }
  const explicitNumericSign = parsed < 0 ? -1 : 1;
  const numericSign = isParenthesesNegative || hasTrailingMinus ? -1 : explicitNumericSign;

  return Math.abs(parsed) * directionalSign * numericSign;
};
