import { z } from 'zod';

import type { CanonicalField, TransformKind } from '@recon/domain';

export const TRANSFORM_LABELS: Record<TransformKind, string> = {
  none: 'None',
  trim: 'Trim whitespace',
  dateReformat: 'Reformat date',
  parseNumber: 'Parse number',
  negate: 'Negate (debit columns)',
  deriveDirection: 'Derive DEBIT / CREDIT',
  uppercase: 'Uppercase',
  accountLookup: 'Account lookup (by code / number)',
};

export const TRANSFORM_KINDS = Object.keys(TRANSFORM_LABELS) as TransformKind[];

/** Sensible default transform per canonical field type — the build's starting point, not a lock. */
export function defaultTransformForType(type: CanonicalField['type']): TransformKind {
  switch (type) {
    case 'date':
      return 'dateReformat';
    case 'numeric':
      return 'parseNumber';
    case 'enum':
      return 'uppercase';
    case 'text':
    default:
      return 'trim';
  }
}

/**
 * `new Date(value)` interprets some formats in local time and others (bare ISO dates) as UTC,
 * which can shift the displayed day near a timezone boundary. Acceptable here — this only drives
 * a UI preview, never the authoritative import parse.
 */
function tryFormatDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parses plain numbers, `$`/`,`-formatted amounts, and accounting-style `(123.45)` negatives. */
function tryParseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isParenNegative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[()$,\s]/g, '');
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return isParenNegative ? -Math.abs(parsed) : parsed;
}

/** Computes the live preview shown next to a transform `<select>`, from the source column's sample value. */
export function applyTransform(kind: TransformKind, sampleValue: string): string {
  switch (kind) {
    case 'none':
      return sampleValue;
    case 'trim':
      return sampleValue.trim();
    case 'dateReformat':
      return tryFormatDate(sampleValue) ?? sampleValue.trim();
    case 'parseNumber': {
      const parsed = tryParseNumber(sampleValue);
      return parsed === null ? sampleValue.trim() : parsed.toFixed(2);
    }
    case 'negate': {
      const parsed = tryParseNumber(sampleValue);
      return parsed === null ? sampleValue.trim() : (-parsed).toFixed(2);
    }
    case 'deriveDirection': {
      const parsed = tryParseNumber(sampleValue);
      if (parsed !== null) {
        if (parsed < 0) return 'DEBIT';
        if (parsed > 0) return 'CREDIT';
        return '—';
      }
      const normalized = sampleValue.trim().toLowerCase();
      if (/debit|withdrawal/.test(normalized)) return 'DEBIT';
      if (/credit|deposit/.test(normalized)) return 'CREDIT';
      return '—';
    }
    case 'uppercase':
      return sampleValue.trim().toUpperCase();
    case 'accountLookup':
      return sampleValue.trim();
    default:
      return sampleValue;
  }
}

const SAMPLE_VALIDATORS: Record<CanonicalField['type'], z.ZodType<string>> = {
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Does not look like a date after this transform.'),
  numeric: z.string().regex(/^-?\d+\.\d{2}$/, 'Does not look like a number after this transform.'),
  text: z.string().min(1, 'Value is empty after this transform.'),
  enum: z.string().min(1, 'Value is empty after this transform.'),
};

/** Validates a (transformed) sample value against its canonical field's expected shape. */
export function validateSampleValue(
  type: CanonicalField['type'],
  transformedValue: string,
): { valid: boolean; message?: string } {
  if (!transformedValue) {
    return { valid: true };
  }

  const result = SAMPLE_VALIDATORS[type].safeParse(transformedValue);
  return result.success
    ? { valid: true }
    : { valid: false, message: result.error.issues[0]?.message };
}
