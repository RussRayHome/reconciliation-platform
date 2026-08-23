import {
  errorCategories,
  errorCategoryDisplayNames,
  type ChartSeries,
  type ExceptionItem,
  type ReconciliationFrequency,
  type SummaryMetrics,
} from '@recon/domain';

type AgingBucket = { label: string; maxDays: number };

/** Base upper bounds (before the stale threshold is folded in) for each reconciliation frequency
 * -- Monthly runs review outstanding checks on a shorter cadence than Annual runs, so their aging
 * bands start narrower. */
const BASE_AGING_BANDS: Record<ReconciliationFrequency, readonly [number, number]> = {
  Monthly: [5, 30],
  Annual: [30, 90],
};

/**
 * Derives the Outstanding Check aging bands from the account's own `staleOutstandingCheckDays`
 * threshold (R-8), instead of hardcoding `0-5 / 6-30 / 31-60 / 60+` regardless of policy: the
 * final bucket is always exactly "at or past the stale threshold," so a policy breach is never
 * hidden inside a bucket that also contains compliant checks (BUG-4), and labels are generated
 * from the bounds so an off-by-one in a hand-written label (BUG-5) cannot recur.
 *
 * Builds ascending upper bounds from the frequency's base bands, plus the day just before the
 * stale threshold when that threshold falls past the base bands' range, drops any bound at or
 * past the threshold (or not strictly increasing), and always closes the gap up to
 * `staleOutstandingCheckDays - 1` so no age is ever left outside every bucket -- guards the
 * degenerate small-threshold cases (an account configured with a 0- or single-digit-day
 * threshold) by naturally collapsing to fewer, still gap-free bands.
 */
export const buildAgingBuckets = (
  staleOutstandingCheckDays: number,
  reconciliationFrequency: ReconciliationFrequency,
): AgingBucket[] => {
  const stale = Math.max(Math.trunc(staleOutstandingCheckDays), 0);
  const baseBands = BASE_AGING_BANDS[reconciliationFrequency];
  const lastBaseBand = baseBands.at(-1) as number;
  const candidates: number[] = stale - 1 > lastBaseBand ? [...baseBands, stale - 1] : [...baseBands];

  const bounds: number[] = [];
  let previous = -1;
  for (const candidate of candidates) {
    if (candidate >= stale || candidate <= previous) {
      continue;
    }
    bounds.push(candidate);
    previous = candidate;
  }
  if (stale > 0 && stale - 1 > previous) {
    bounds.push(stale - 1);
  }

  const closedBuckets = bounds.map((bound, index) => {
    const min = index === 0 ? 0 : (bounds.at(index - 1) as number) + 1;
    return { label: min === bound ? `${min} days` : `${min}-${bound} days`, maxDays: bound };
  });

  return [...closedBuckets, { label: `${stale}+ days`, maxDays: Infinity }];
};

const bucketLabelFor = (buckets: AgingBucket[], ageInDays: number): string =>
  buckets.find((bucket) => ageInDays <= bucket.maxDays)?.label ?? (buckets.at(-1) as AgingBucket).label;

/**
 * Buckets every OutstandingCheck/StaleOutstandingCheck exception by age into the account's own
 * aging bands (see `buildAgingBuckets`), preserving band order regardless of which ages are
 * actually present (so the chart always shows every band, including zero-count ones, rather than
 * only the bands that happen to have data this run).
 */
const buildOutstandingCheckAgingData = (
  exceptions: ExceptionItem[],
  staleOutstandingCheckDays: number,
  reconciliationFrequency: ReconciliationFrequency,
): { label: string; value: number }[] => {
  const buckets = buildAgingBuckets(staleOutstandingCheckDays, reconciliationFrequency);
  const counts = new Map<string, number>(buckets.map((bucket) => [bucket.label, 0]));

  for (const exception of exceptions) {
    if (
      (exception.category !== 'OutstandingCheck' && exception.category !== 'StaleOutstandingCheck') ||
      exception.ageInDays === undefined
    ) {
      continue;
    }

    const label = bucketLabelFor(buckets, exception.ageInDays);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return buckets.map((bucket) => ({ label: bucket.label, value: counts.get(bucket.label) ?? 0 }));
};

/**
 * Builds the chart series (count-by-category, dollar-exposure-by-category, and outstanding-check
 * aging) from the summary metrics and the run's own exceptions, filtering out zero-count
 * categories (except the aging buckets, which always show every band for a stable axis).
 */
export const buildChartSeries = (
  summary: SummaryMetrics,
  exceptions: ExceptionItem[],
  staleOutstandingCheckDays: number,
  reconciliationFrequency: ReconciliationFrequency,
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
    data: buildOutstandingCheckAgingData(
      exceptions,
      staleOutstandingCheckDays,
      reconciliationFrequency,
    ),
  },
];
