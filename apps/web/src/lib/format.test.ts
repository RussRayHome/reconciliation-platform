import { describe, expect, it } from 'vitest';

import {
  formatCompactDate,
  formatCurrency,
  formatCurrencyWhole,
  formatDate,
  formatShortDate,
} from './format';

describe('formatCurrency', () => {
  it('formats a positive amount with two decimals', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('wraps negative amounts in accounting parentheses', () => {
    expect(formatCurrency(-1234.5)).toBe('($1,234.50)');
  });

  it('falls back to N/A for null, undefined, and NaN', () => {
    expect(formatCurrency(null)).toBe('N/A');
    expect(formatCurrency(undefined)).toBe('N/A');
    expect(formatCurrency(Number.NaN)).toBe('N/A');
  });
});

describe('formatCurrencyWhole', () => {
  it('rounds a positive amount to whole dollars', () => {
    expect(formatCurrencyWhole(1234.5)).toBe('$1,235');
  });

  it('wraps negative amounts in accounting parentheses', () => {
    expect(formatCurrencyWhole(-1234.5)).toBe('($1,235)');
  });

  it('falls back to N/A for null, undefined, and NaN', () => {
    expect(formatCurrencyWhole(null)).toBe('N/A');
    expect(formatCurrencyWhole(undefined)).toBe('N/A');
    expect(formatCurrencyWhole(Number.NaN)).toBe('N/A');
  });
});

describe('formatDate', () => {
  it('passes through a non-empty value', () => {
    expect(formatDate('2026-07-14')).toBe('2026-07-14');
  });

  it('falls back to N/A for null, undefined, and whitespace-only values', () => {
    expect(formatDate(null)).toBe('N/A');
    expect(formatDate(undefined)).toBe('N/A');
    expect(formatDate('   ')).toBe('N/A');
  });
});

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const compactDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: 'short',
});

// Noon UTC keeps the local calendar date stable regardless of the host machine's time zone.
const NOON_UTC_TIMESTAMP = '2026-08-04T12:00:00.000Z';

describe('formatShortDate', () => {
  it('formats a valid ISO timestamp', () => {
    expect(formatShortDate(NOON_UTC_TIMESTAMP)).toBe(
      shortDateFormatter.format(new Date(NOON_UTC_TIMESTAMP)),
    );
  });

  it('falls back to an em dash for null and undefined', () => {
    expect(formatShortDate(null)).toBe('—');
    expect(formatShortDate(undefined)).toBe('—');
  });

  it('falls back to an em dash for an unparseable date string', () => {
    expect(formatShortDate('not-a-date')).toBe('—');
  });
});

describe('formatCompactDate', () => {
  it('formats a valid ISO timestamp without a year', () => {
    expect(formatCompactDate(NOON_UTC_TIMESTAMP)).toBe(
      compactDateFormatter.format(new Date(NOON_UTC_TIMESTAMP)),
    );
  });

  it('falls back to an em dash for null and undefined', () => {
    expect(formatCompactDate(null)).toBe('—');
    expect(formatCompactDate(undefined)).toBe('—');
  });

  it('falls back to an em dash for an unparseable date string', () => {
    expect(formatCompactDate('not-a-date')).toBe('—');
  });
});
