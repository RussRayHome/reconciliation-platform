import { describe, expect, it } from 'vitest';

import { errorCategories } from '@recon/domain';

import { CLASSIFIER_CATEGORIES, buildRuleCatalog } from './ruleCatalog';
import { MATCHING_RULE_NAMES } from './engine';
import { GROUPED_RULES } from './groupedReservations';

describe('buildRuleCatalog', () => {
  it('covers every ErrorCategory exactly once across the grouped and classifier families', () => {
    const groupedCategories = GROUPED_RULES.map((rule) => rule.category);
    const covered = [...groupedCategories, ...CLASSIFIER_CATEGORIES];

    // Every ErrorCategory must be covered by exactly one of the two axes -- a category present
    // in neither means a rule the engine can emit is missing from the catalog; present in both
    // means the same rule would appear twice under different ids.
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual([...errorCategories].sort());
  });

  it('returns one rule entry per matching rule name and per grouped rule id', () => {
    const catalog = buildRuleCatalog();
    const matchingEntries = catalog.rules.filter((rule) => rule.family === 'Matching');
    const groupedEntries = catalog.rules.filter((rule) => rule.family === 'Grouped roll-up');
    const classifierEntries = catalog.rules.filter((rule) => rule.family === 'Classifier');

    expect(matchingEntries).toHaveLength(MATCHING_RULE_NAMES.length);
    expect(groupedEntries).toHaveLength(GROUPED_RULES.length);
    expect(classifierEntries).toHaveLength(CLASSIFIER_CATEGORIES.length);
    expect(catalog.rules).toHaveLength(
      MATCHING_RULE_NAMES.length + GROUPED_RULES.length + CLASSIFIER_CATEGORIES.length,
    );
  });

  it('gives every rule a unique id', () => {
    const catalog = buildRuleCatalog();
    const ids = catalog.rules.map((rule) => rule.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks rules with no variance metrics as tunable:false rather than omitting them', () => {
    const catalog = buildRuleCatalog();
    const untunable = catalog.rules.filter((rule) => rule.varianceMetricIds.length === 0);

    expect(untunable.length).toBeGreaterThan(0);
    for (const rule of untunable) {
      expect(rule.tunable).toBe(false);
    }
    for (const rule of catalog.rules) {
      expect(rule.tunable).toBe(rule.varianceMetricIds.length > 0);
    }
  });

  it('only flags the wire-fee and credit-card-fee rules as elevated risk', () => {
    const catalog = buildRuleCatalog();
    const elevated = catalog.rules.filter((rule) => rule.risk === 'elevated');

    expect(elevated).toHaveLength(2);
    expect(elevated.map((rule) => rule.name)).toEqual(
      expect.arrayContaining(['Wire Correspondent Fee Deduction', 'Credit Card Service Fee Deduction']),
    );
  });

  it('returns all 18 MatchingConfig fields as metrics, each referenced by at least one rule', () => {
    const catalog = buildRuleCatalog();

    expect(catalog.metrics).toHaveLength(18);

    const referencedMetricIds = new Set(catalog.rules.flatMap((rule) => rule.varianceMetricIds));
    const metricIds = new Set(catalog.metrics.map((metric) => metric.id));

    for (const id of referencedMetricIds) {
      expect(metricIds.has(id)).toBe(true);
    }

    for (const knob of [
      'distinctiveAmountMaxOccurrences',
      'groupedCandidatePoolSize',
      'groupedMatchMaxSize',
      'wireFeeTolerance',
      'creditCardFeeTolerance',
    ] as const) {
      expect(metricIds.has(knob)).toBe(true);
    }
  });
});
