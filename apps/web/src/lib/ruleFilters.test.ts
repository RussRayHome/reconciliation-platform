import { describe, expect, it } from 'vitest';
import type { RuleCatalogEntry } from '@recon/domain';

import {
  countFixedRules,
  countRulesByFamily,
  deriveMetricStep,
  describeActiveFilters,
  filterRules,
  formatMetricLabel,
  formatVarianceMetricValue,
  parseRuleFamilyParam,
  parseTunableParam,
  ruleFamilyToSlug,
} from './ruleFilters';

const RULES: RuleCatalogEntry[] = [
  {
    id: 'reference-amount-match',
    name: 'Reference + Amount Match',
    family: 'Matching',
    description: 'Pairs bank and GL transactions when amounts agree within tolerance.',
    varianceMetricIds: ['amountTolerance'],
    tunable: true,
  },
  {
    id: 'fee-netting-reserved',
    name: 'Fee Netting Candidate',
    family: 'Grouped roll-up',
    description: 'Bank net receipt equals GL gross revenue minus fees.',
    varianceMetricIds: ['amountTolerance', 'timingDifferenceDays'],
    tunable: true,
  },
  {
    id: 'MissingFromBank',
    name: 'Missing from Bank',
    family: 'Classifier',
    description: 'Classifies unmatched GL-side transactions as missing from bank activity.',
    varianceMetricIds: [],
    tunable: false,
  },
];

describe('parseRuleFamilyParam / ruleFamilyToSlug', () => {
  it('round-trips every family through its slug', () => {
    for (const family of ['Matching', 'Grouped roll-up', 'Classifier'] as const) {
      expect(parseRuleFamilyParam(ruleFamilyToSlug(family))).toBe(family);
    }
  });

  it('treats null/unknown values as "All families"', () => {
    expect(parseRuleFamilyParam(null)).toBeNull();
    expect(parseRuleFamilyParam('not-a-real-family')).toBeNull();
  });
});

describe('parseTunableParam', () => {
  it('parses true/false and treats anything else as "either"', () => {
    expect(parseTunableParam('true')).toBe(true);
    expect(parseTunableParam('false')).toBe(false);
    expect(parseTunableParam(null)).toBeNull();
    expect(parseTunableParam('garbage')).toBeNull();
  });
});

describe('filterRules', () => {
  it('returns everything with no filters active', () => {
    expect(filterRules(RULES, { search: '', family: null, tunable: null })).toHaveLength(3);
  });

  it('filters by family alone', () => {
    const result = filterRules(RULES, { search: '', family: 'Matching', tunable: null });
    expect(result.map((r) => r.id)).toEqual(['reference-amount-match']);
  });

  it('filters by tunable alone', () => {
    const result = filterRules(RULES, { search: '', family: null, tunable: false });
    expect(result.map((r) => r.id)).toEqual(['MissingFromBank']);
  });

  it('composes family and tunable rather than replacing each other', () => {
    const result = filterRules(RULES, { search: '', family: 'Grouped roll-up', tunable: true });
    expect(result.map((r) => r.id)).toEqual(['fee-netting-reserved']);

    // A combination matching nothing (Classifier + tunable) returns empty, not a fallback list.
    expect(filterRules(RULES, { search: '', family: 'Classifier', tunable: true })).toEqual([]);
  });

  it('searches name and description, case-insensitively', () => {
    expect(
      filterRules(RULES, { search: 'FEE NETTING', family: null, tunable: null }).map((r) => r.id),
    ).toEqual(['fee-netting-reserved']);
    expect(
      filterRules(RULES, { search: 'gross revenue', family: null, tunable: null }).map((r) => r.id),
    ).toEqual(['fee-netting-reserved']);
    expect(filterRules(RULES, { search: 'no such rule', family: null, tunable: null })).toEqual([]);
  });
});

describe('countRulesByFamily / countFixedRules', () => {
  it('counts each family and the fixed-rule total independently of any active filter', () => {
    expect(countRulesByFamily(RULES)).toEqual({
      Matching: 1,
      'Grouped roll-up': 1,
      Classifier: 1,
    });
    expect(countFixedRules(RULES)).toBe(1);
  });
});

describe('describeActiveFilters', () => {
  it('names every active filter dimension', () => {
    expect(describeActiveFilters({ search: '', family: null, tunable: null })).toBe('');
    expect(
      describeActiveFilters({ search: 'wire', family: 'Matching', tunable: true }),
    ).toBe('matching "wire" in Matching that are tunable');
    expect(describeActiveFilters({ search: '', family: null, tunable: false })).toBe(
      'with no adjustable metric',
    );
  });
});

describe('formatMetricLabel', () => {
  it('splits camelCase MatchingConfig field names into title case', () => {
    expect(formatMetricLabel('wireFeeTolerance')).toBe('Wire Fee Tolerance');
    expect(formatMetricLabel('amountTolerance')).toBe('Amount Tolerance');
    expect(formatMetricLabel('groupedCandidatePoolSize')).toBe('Grouped Candidate Pool Size');
  });
});

describe('deriveMetricStep', () => {
  it('uses fine steps for percent and small USD ranges, whole steps otherwise', () => {
    expect(deriveMetricStep({ id: 'textSimilarityThreshold', unit: 'percent', default: 0.7, min: 0, max: 1 })).toBe(
      0.01,
    );
    expect(deriveMetricStep({ id: 'amountTolerance', unit: 'USD', default: 0.01, min: 0, max: 1 })).toBe(0.01);
    expect(deriveMetricStep({ id: 'wireFeeTolerance', unit: 'USD', default: 500, min: 0, max: 5000 })).toBe(1);
    expect(deriveMetricStep({ id: 'dateToleranceDays', unit: 'days', default: 5, min: 0, max: 31 })).toBe(1);
    expect(
      deriveMetricStep({ id: 'groupedCandidatePoolSize', unit: 'count', default: 6, min: 1, max: 20 }),
    ).toBe(1);
  });
});

describe('formatVarianceMetricValue', () => {
  it('formats each unit distinctly', () => {
    expect(formatVarianceMetricValue(5, 'days')).toBe('5 days');
    expect(formatVarianceMetricValue(1, 'days')).toBe('1 day');
    expect(formatVarianceMetricValue(6, 'count')).toBe('6');
    expect(formatVarianceMetricValue(0.01, 'USD')).toBe('$0.01');
    expect(formatVarianceMetricValue(500, 'USD')).toBe('$500');
    expect(formatVarianceMetricValue(0.7, 'percent')).toBe('70%');
    expect(formatVarianceMetricValue(0.625, 'percent')).toBe('62.50%');
  });
});
