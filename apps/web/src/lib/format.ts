const currencyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeCurrencyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formats a monetary amount as US dollars with thousands separators and two decimals.
 * Negatives use accounting parentheses; nullish/NaN values render as "N/A".
 */
export const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A';
  }

  const formatted = currencyFormatter.format(Math.abs(value));

  return value < 0 ? `($${formatted})` : `$${formatted}`;
};

/**
 * Formats a monetary amount as whole US dollars (rounded, no cents), for summary
 * figures where cent-level precision isn't materially significant.
 * Negatives use accounting parentheses; nullish/NaN values render as "N/A".
 */
export const formatCurrencyWhole = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A';
  }

  const formatted = wholeCurrencyFormatter.format(Math.round(Math.abs(value)));

  return value < 0 ? `($${formatted})` : `$${formatted}`;
};

/** Formats an optional ISO/date string for display, falling back to "N/A". */
export const formatDate = (value: string | null | undefined): string => value?.trim() || 'N/A';

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Formats an ISO timestamp as "4 Aug 2026", falling back to "—" for null/invalid input. */
export const formatShortDate = (value: string | null | undefined): string => {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '—' : shortDateFormatter.format(parsed);
};

const compactDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: 'short',
});

/** Formats an ISO timestamp as "04 Aug" (no year), for narrow table columns. Falls back to "—". */
export const formatCompactDate = (value: string | null | undefined): string => {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '—' : compactDateFormatter.format(parsed);
};
