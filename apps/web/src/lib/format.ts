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
