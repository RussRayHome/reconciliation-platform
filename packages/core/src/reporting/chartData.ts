import {
  errorCategories,
  errorCategoryDisplayNames,
  type ChartSeries,
  type ExceptionItem,
  type SummaryMetrics,
} from '@recon/domain';

/** Upper bound (inclusive) of each Outstanding Check aging bucket -- the last bucket has no upper
 * bound (60+ days). Ordered ascending; a value falls into the first bucket whose bound it's <=. */
const AGING_BUCKETS = [
  { label: '0-5 days', maxDays: 5 },
  { label: '6-30 days', maxDays: 30 },
  { label: '31-60 days', maxDays: 60 },
  { label: '60+ days', maxDays: Infinity },
] as const;

const bucketLabelFor = (ageInDays: number): string =>
  AGING_BUCKETS.find((bucket) => ageInDays <= bucket.maxDays)?.label ?? AGING_BUCKETS[3].label;

/**
 * Buckets every OutstandingCheck/StaleOutstandingCheck exception by age into the four standard
 * aging bands, preserving `AGING_BUCKETS`' order regardless of which ages are actually present
 * (so the chart always shows all four buckets, including zero-count ones, rather than only the
 * buckets that happen to have data this run).
 */
const buildOutstandingCheckAgingData = (
  exceptions: ExceptionItem[],
): { label: string; value: number }[] => {
  const counts = new Map<string, number>(AGING_BUCKETS.map((bucket) => [bucket.label, 0]));

  for (const exception of exceptions) {
    if (
      (exception.category !== 'OutstandingCheck' && exception.category !== 'StaleOutstandingCheck') ||
      exception.ageInDays === undefined
    ) {
      continue;
    }

    const label = bucketLabelFor(exception.ageInDays);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return AGING_BUCKETS.map((bucket) => ({ label: bucket.label, value: counts.get(bucket.label) ?? 0 }));
};

/**
 * Builds the chart series (count-by-category, dollar-exposure-by-category, and outstanding-check
 * aging) from the summary metrics and the run's own exceptions, filtering out zero-count
 * categories (except the aging buckets, which always show all four for a stable axis).
 */
export const buildChartSeries = (
  summary: SummaryMetrics,
  exceptions: ExceptionItem[],
): ChartSeries[] => [
  {
    id: 'countByCategory',
    title: 'Counts by Category',
    data: [
      { label: 'Exact Matches', value: summary.exactMatches },
      { label: 'Probable Matches', value: summary.probableMatches },
      ...errorCategories
        .filter((category) => (summary.countsByCategory[category] ?? 0) > 0)
        .map((category) => ({
          label: errorCategoryDisplayNames[category],
          value: summary.countsByCategory[category] ?? 0,
        })),
    ],
  },
  {
    id: 'exposureByCategory',
    title: 'Dollar Exposure by Exception Category',
    data: Object.entries(summary.amountByCategory).map(([label, value]) => ({
      label: errorCategoryDisplayNames[label as keyof typeof errorCategoryDisplayNames] ?? label,
      value,
    })),
  },
  {
    id: 'outstandingCheckAging',
    title: 'Outstanding Check Aging',
    data: buildOutstandingCheckAgingData(exceptions),
  },
];
