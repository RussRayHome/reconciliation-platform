import { errorCategoryDisplayNames, type ExceptionItem } from '@recon/domain';

import { formatCurrency, formatDate } from './format';

/** Sort keys available in the triage list. */
export type TriageSortKey = 'severity' | 'amount' | 'date';

/** Facet dimensions the reviewer can filter by. */
export type TriageFacetKey = 'severity' | 'category' | 'source' | 'rule' | 'amountBand';

/** Selected facet values keyed by facet dimension. */
export type TriageFacetSelection = Record<TriageFacetKey, string[]>;

/** A single facet option with its label and current match count. */
export type TriageFacetOption = {
  value: string;
  label: string;
  count: number;
};

/** A precomputed display projection of one exception used by the list and detail panes. */
export type ExceptionDisplay = {
  item: ExceptionItem;
  categoryLabel: string;
  ruleLabel: string;
  sourceLabel: string;
  dateLabel: string;
  amountLabel: string;
  counterpartLabel: string;
  fileLineLabel: string;
  amountBand: string;
};

/** A named, persisted facet+sort+query selection. */
export type SavedTriageView = {
  id: string;
  name: string;
  query: string;
  sortKey: TriageSortKey;
  facets: TriageFacetSelection;
};

export const SAVED_VIEWS_STORAGE_KEY = 'reconciliation-platform:saved-views';

export const severityRank: Record<ExceptionItem['severity'], number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export const emptyFacetSelection = (): TriageFacetSelection => ({
  severity: [],
  category: [],
  source: [],
  rule: [],
  amountBand: [],
});

const amountBands: ReadonlyArray<{ value: string; label: string; test: (abs: number) => boolean }> =
  [
    { value: 'band-0-100', label: 'Under $100', test: (abs) => abs < 100 },
    { value: 'band-100-1k', label: '$100 – $1,000', test: (abs) => abs >= 100 && abs < 1000 },
    { value: 'band-1k-10k', label: '$1,000 – $10,000', test: (abs) => abs >= 1000 && abs < 10000 },
    { value: 'band-10k-plus', label: '$10,000 and up', test: (abs) => abs >= 10000 },
  ];

export const resolveAmountBand = (amount: number | null): string => {
  if (amount === null || Number.isNaN(amount)) {
    return 'band-unknown';
  }

  const abs = Math.abs(amount);

  return amountBands.find((band) => band.test(abs))?.value ?? 'band-unknown';
};

const amountBandLabel = (value: string): string =>
  value === 'band-unknown'
    ? 'No amount'
    : (amountBands.find((band) => band.value === value)?.label ?? value);

const resolveCounterpartLabel = (item: ExceptionItem): string => {
  const counterparts =
    item.ruleTrace?.counterparts?.length || !item.ruleTrace?.counterpart
      ? (item.ruleTrace?.counterparts ?? [])
      : [item.ruleTrace.counterpart];

  if (counterparts.length === 0) {
    return item.likelyMatchingReference ?? 'No counterpart';
  }

  return counterparts
    .map((counterpart) =>
      counterpart.spreadsheetFileName
        ? `${counterpart.source?.toUpperCase() ?? ''} ${counterpart.spreadsheetFileName} / ${counterpart.lineNumber ?? 'N/A'}`.trim()
        : (counterpart.transactionId ?? 'N/A'),
    )
    .join(' | ');
};

export const toExceptionDisplay = (item: ExceptionItem): ExceptionDisplay => ({
  item,
  categoryLabel: errorCategoryDisplayNames[item.category] ?? item.category,
  ruleLabel: item.ruleTrace?.ruleName ?? 'Derived classification',
  sourceLabel: item.source.toUpperCase(),
  dateLabel: formatDate(item.transactionDate),
  amountLabel: formatCurrency(item.amount),
  counterpartLabel: resolveCounterpartLabel(item),
  fileLineLabel: `${item.spreadsheetFileName} / ${item.lineNumber}`,
  amountBand: resolveAmountBand(item.amount),
});

const facetValueOfItem = (display: ExceptionDisplay, key: TriageFacetKey): string => {
  switch (key) {
    case 'severity':
      return display.item.severity;
    case 'category':
      return display.item.category;
    case 'source':
      return display.item.source;
    case 'rule':
      return display.ruleLabel;
    case 'amountBand':
      return display.amountBand;
    default:
      return '';
  }
};

const facetOptionLabel = (key: TriageFacetKey, value: string): string => {
  switch (key) {
    case 'severity':
      return value;
    case 'category':
      return errorCategoryDisplayNames[value as ExceptionItem['category']] ?? value;
    case 'source':
      return value.toUpperCase();
    case 'amountBand':
      return amountBandLabel(value);
    default:
      return value;
  }
};

/** Builds facet options with counts for a dimension, honoring all other active facet selections. */
export const buildFacetOptions = (
  displays: ExceptionDisplay[],
  key: TriageFacetKey,
  selection: TriageFacetSelection,
): TriageFacetOption[] => {
  const counts = new Map<string, number>();

  for (const display of displays) {
    if (!matchesFacets(display, selection, key)) {
      continue;
    }

    const value = facetValueOfItem(display, key);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: facetOptionLabel(key, value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

/** Returns true when a display matches all active facet selections, optionally excluding one dimension. */
export const matchesFacets = (
  display: ExceptionDisplay,
  selection: TriageFacetSelection,
  excludeKey?: TriageFacetKey,
): boolean =>
  (Object.keys(selection) as TriageFacetKey[]).every((key) => {
    if (key === excludeKey) {
      return true;
    }

    const selected = selection[key];

    return selected.length === 0 || selected.includes(facetValueOfItem(display, key));
  });

export const matchesQuery = (display: ExceptionDisplay, normalizedQuery: string): boolean => {
  if (!normalizedQuery) {
    return true;
  }

  const item = display.item;

  return (
    item.errorMessage.toUpperCase().includes(normalizedQuery) ||
    item.spreadsheetFileName.toUpperCase().includes(normalizedQuery) ||
    display.ruleLabel.toUpperCase().includes(normalizedQuery) ||
    item.normalizedComparisonTokens.join(' ').toUpperCase().includes(normalizedQuery)
  );
};

export const sortDisplays = (
  displays: ExceptionDisplay[],
  sortKey: TriageSortKey,
): ExceptionDisplay[] =>
  [...displays].sort((a, b) => {
    if (sortKey === 'amount') {
      return Math.abs(b.item.amount ?? 0) - Math.abs(a.item.amount ?? 0);
    }

    if (sortKey === 'date') {
      return (b.item.transactionDate ?? '').localeCompare(a.item.transactionDate ?? '');
    }

    return (
      severityRank[a.item.severity] - severityRank[b.item.severity] ||
      Math.abs(b.item.amount ?? 0) - Math.abs(a.item.amount ?? 0)
    );
  });

/** Derives the Bank-side and QBO-side lines for the detail comparison from an exception and its counterparts. */
export const buildComparisonSides = (
  item: ExceptionItem,
): { bank: ComparisonLine[]; qbo: ComparisonLine[] } => {
  const selfLine: ComparisonLine = {
    fileName: item.spreadsheetFileName,
    lineNumber: item.lineNumber,
    amountLabel: formatCurrency(item.amount),
    dateLabel: formatDate(item.transactionDate),
    isPrimary: true,
  };

  const counterparts =
    item.ruleTrace?.counterparts?.length || !item.ruleTrace?.counterpart
      ? (item.ruleTrace?.counterparts ?? [])
      : [item.ruleTrace.counterpart];

  const counterpartLines: Array<{ source: 'bank' | 'qbo'; line: ComparisonLine }> =
    counterparts.map((counterpart) => ({
      source: counterpart.source ?? (item.source === 'bank' ? 'qbo' : 'bank'),
      line: {
        fileName: counterpart.spreadsheetFileName ?? counterpart.transactionId ?? 'N/A',
        lineNumber: counterpart.lineNumber,
        amountLabel: 'N/A',
        dateLabel: 'N/A',
        isPrimary: false,
      },
    }));

  const bank: ComparisonLine[] = [];
  const qbo: ComparisonLine[] = [];

  if (item.source === 'bank') {
    bank.push(selfLine);
  } else {
    qbo.push(selfLine);
  }

  for (const counterpart of counterpartLines) {
    (counterpart.source === 'bank' ? bank : qbo).push(counterpart.line);
  }

  return { bank, qbo };
};

/** One line rendered inside a Bank/QBO comparison column. */
export type ComparisonLine = {
  fileName: string;
  lineNumber?: number;
  amountLabel: string;
  dateLabel: string;
  isPrimary: boolean;
};

/** Builds the Prior → Prior → Final rule lineage trail for an exception. */
export const buildRuleLineage = (
  item: ExceptionItem,
): Array<{ label: 'Prior' | 'Final'; ruleName: string }> => {
  const traces = [...(item.priorRuleTraces ?? []), ...(item.ruleTrace ? [item.ruleTrace] : [])];

  return traces.map((trace, index) => ({
    label: index === traces.length - 1 ? 'Final' : 'Prior',
    ruleName: trace.ruleName,
  }));
};
