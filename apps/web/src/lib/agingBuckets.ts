export type ReconciliationFrequency = 'Monthly' | 'Annual';

export interface AgingBucket {
  label: string;
  maxDays: number;
}

/** Base upper bounds (before the stale threshold is folded in) for each reconciliation frequency
 * -- Monthly runs review outstanding items on a shorter cadence than Annual runs, so their aging
 * bands start narrower. */
const BASE_AGING_BANDS: Record<ReconciliationFrequency, readonly [number, number]> = {
  Monthly: [5, 30],
  Annual: [30, 90],
};

/**
 * Deliberate duplicate of `packages/core/src/reporting/chartData.ts`'s `buildAgingBuckets` --
 * `apps/web` has no dependency on `@recon/core` (by design, the same one-directional layering
 * `packages/persistence`'s own doc comments describe: `packages/core` depends on
 * `packages/domain`, never the reverse, and `apps/web` sits on the `@recon/domain` side of that
 * boundary), so this can't just import the original. Keep the two in sync by hand if the
 * algorithm ever changes; `agingBuckets.test.ts` pins the exact band output for the same inputs
 * `chartData.test.ts` covers, as a tripwire for drift.
 *
 * Derives aging bands from a `staleOutstandingCheckDays`-shaped threshold instead of hardcoding
 * fixed bands: the final bucket is always exactly "at or past the stale threshold," so a policy
 * breach is never hidden inside a bucket that also contains compliant items, and labels are
 * generated from the bounds so an off-by-one in a hand-written label can't recur.
 */
export const buildAgingBuckets = (
  staleThresholdDays: number,
  reconciliationFrequency: ReconciliationFrequency,
): AgingBucket[] => {
  const stale = Math.max(Math.trunc(staleThresholdDays), 0);
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

/** Finds the label of the band an age falls into, matching `chartData.ts`'s private
 * `bucketLabelFor` helper of the same name/shape. */
export const agingBucketLabelFor = (buckets: AgingBucket[], ageInDays: number): string =>
  buckets.find((bucket) => ageInDays <= bucket.maxDays)?.label ?? (buckets.at(-1) as AgingBucket).label;
