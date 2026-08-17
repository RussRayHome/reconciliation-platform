/**
 * Primitive parsers/validators ported near-verbatim from the design-handoff bundle's
 * `reference/schema.ts` -- kept byte-for-byte equivalent in behavior since that file is the
 * verified reference implementation this feature is built against.
 */

/** Strict ISO 8601 calendar date, YYYY-MM-DD. */
export const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month === undefined || day === undefined || year === undefined) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

/** ISO 4217 shape check (3 uppercase letters). Pair with a real code list in production. */
export const isIso4217 = (value: string): boolean => /^[A-Z]{3}$/.test(value);

/**
 * Parses a plain decimal string. Rejects currency symbols, thousands separators, whitespace, and
 * blanks. Returns null on any non-conforming input. Accepts an optional leading '-' and up to
 * `minorUnits` decimal places.
 */
export const parseDecimal = (value: string, minorUnits = 2): number | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const pattern = new RegExp(`^-?\\d+(?:\\.\\d{1,${minorUnits}})?$`);
  if (!pattern.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isBlank = (value: string | undefined): boolean => value == null || value.trim() === '';

export const todayIso = (): string => new Date().toISOString().slice(0, 10);
