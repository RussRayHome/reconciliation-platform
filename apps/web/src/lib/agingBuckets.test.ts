import { describe, expect, it } from 'vitest';

import { agingBucketLabelFor, buildAgingBuckets } from './agingBuckets';

// Pins the exact same outputs packages/core/src/reporting/chartData.test.ts covers for
// buildAgingBuckets -- a tripwire for this deliberate duplicate drifting from the original (see
// agingBuckets.ts's own doc comment on why apps/web can't just import it).
describe('buildAgingBuckets', () => {
  it('derives 0-5 / 6-30 / 31-44 / 45+ from the default 45-day Monthly stale threshold', () => {
    expect(buildAgingBuckets(45, 'Monthly').map((bucket) => bucket.label)).toEqual([
      '0-5 days',
      '6-30 days',
      '31-44 days',
      '45+ days',
    ]);
  });

  it('derives 0-30 / 31-90 / 91-119 / 120+ for an Annual account with a 120-day threshold', () => {
    expect(buildAgingBuckets(120, 'Annual').map((bucket) => bucket.label)).toEqual([
      '0-30 days',
      '31-90 days',
      '91-119 days',
      '120+ days',
    ]);
  });

  it('collapses to a single open bucket at a 0-day stale threshold, never an empty or inverted band set', () => {
    expect(buildAgingBuckets(0, 'Monthly').map((bucket) => bucket.label)).toEqual(['0+ days']);
  });

  it('collapses to two gap-free buckets at a small stale threshold (<= 6 days)', () => {
    expect(buildAgingBuckets(5, 'Monthly').map((bucket) => bucket.label)).toEqual([
      '0-4 days',
      '5+ days',
    ]);
    expect(buildAgingBuckets(6, 'Monthly').map((bucket) => bucket.label)).toEqual([
      '0-5 days',
      '6+ days',
    ]);
  });

  it('produces non-overlapping, gap-free bounds up to 120 days', () => {
    const buckets = buildAgingBuckets(120, 'Monthly');
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      '0-5 days',
      '6-30 days',
      '31-119 days',
      '120+ days',
    ]);
    const closed = buckets.slice(0, -1);
    for (let i = 1; i < closed.length; i += 1) {
      expect(closed[i]!.maxDays).toBeGreaterThan(closed[i - 1]!.maxDays);
    }
    expect(buckets.at(-1)?.maxDays).toBe(Infinity);
  });
});

describe('agingBucketLabelFor', () => {
  it('returns the label of the first band whose maxDays is at or past the given age', () => {
    const buckets = buildAgingBuckets(45, 'Monthly');
    expect(agingBucketLabelFor(buckets, 0)).toBe('0-5 days');
    expect(agingBucketLabelFor(buckets, 5)).toBe('0-5 days');
    expect(agingBucketLabelFor(buckets, 6)).toBe('6-30 days');
    expect(agingBucketLabelFor(buckets, 44)).toBe('31-44 days');
    expect(agingBucketLabelFor(buckets, 45)).toBe('45+ days');
    expect(agingBucketLabelFor(buckets, 900)).toBe('45+ days');
  });
});
