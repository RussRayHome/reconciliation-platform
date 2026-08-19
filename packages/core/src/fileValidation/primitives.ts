import { parseAmount as parseAmountLenient } from '../normalization/amount';

/**
 * Primitive parsers/validators for the File Validation Engine (transaction-csv-spec.md).
 * Dates stay strict ISO-8601 only. Amounts (Issue #137) share the same lenient parser as the
 * matching pathway's normalization step (`normalization/amount.ts`) -- currency symbols,
 * thousands-comma separators, parentheses-negatives, trailing minus, and CR/DR suffixes are all
 * standard, unambiguous accounting notation, not a loosening of rigor.
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

/** Parses a monetary amount, accepting standard accounting notation. Returns null on anything
 * that doesn't resolve to a real number (blank, stray symbols with no digits, etc.). */
export const parseAmount = (value: string | undefined): number | null => parseAmountLenient(value);

export const isBlank = (value: string | undefined): boolean => value == null || value.trim() === '';

export const todayIso = (): string => new Date().toISOString().slice(0, 10);
