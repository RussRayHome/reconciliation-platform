import type { MatchingConfig, RuleCatalogEntry, RuleFamily, RuleVarianceMetric } from '@recon/domain';

/** URL-safe slug for each `RuleFamily`, used as the `family` query param on /mapping/rules. */
const RULE_FAMILY_SLUGS: Record<RuleFamily, string> = {
  Matching: 'matching',
  'Grouped roll-up': 'grouped-roll-up',
  Classifier: 'classifier',
};

const RULE_FAMILY_BY_SLUG: Record<string, RuleFamily> = Object.fromEntries(
  Object.entries(RULE_FAMILY_SLUGS).map(([family, slug]) => [slug, family as RuleFamily]),
);

/** Ordered list of every family slug, for rendering the family chip row. */
export const RULE_FAMILY_SLUG_ORDER: string[] = Object.values(RULE_FAMILY_SLUGS);

export const ruleFamilyToSlug = (family: RuleFamily): string => RULE_FAMILY_SLUGS[family];

/** Parses the `family` URL param into a real `RuleFamily`, or null for "All families" / an unrecognized value. */
export const parseRuleFamilyParam = (value: string | null): RuleFamily | null =>
  value ? (RULE_FAMILY_BY_SLUG[value] ?? null) : null;

/** Parses the `tunable` URL param into a tri-state filter value. Any value other than 'true'/'false' means "either." */
export const parseTunableParam = (value: string | null): boolean | null => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
};

export type RuleFilters = {
  search: string;
  family: RuleFamily | null;
  tunable: boolean | null;
};

const normalizeForSearch = (value: string): string => value.trim().toLowerCase();

const matchesSearch = (rule: RuleCatalogEntry, normalizedQuery: string): boolean => {
  if (!normalizedQuery) {
    return true;
  }
  return (
    rule.name.toLowerCase().includes(normalizedQuery) ||
    rule.description.toLowerCase().includes(normalizedQuery)
  );
};

/** Applies search + family + tunable filters together (composed, not mutually exclusive). */
export const filterRules = (rules: RuleCatalogEntry[], filters: RuleFilters): RuleCatalogEntry[] => {
  const normalizedQuery = normalizeForSearch(filters.search);

  return rules.filter((rule) => {
    if (filters.family && rule.family !== filters.family) {
      return false;
    }
    if (filters.tunable !== null && rule.tunable !== filters.tunable) {
      return false;
    }
    return matchesSearch(rule, normalizedQuery);
  });
};

/** Per-family rule counts, for the family chip row and NavRail sub-items. Zero-count families are omitted by the caller as needed, not here. */
export const countRulesByFamily = (rules: RuleCatalogEntry[]): Record<RuleFamily, number> => {
  const counts: Record<RuleFamily, number> = { Matching: 0, 'Grouped roll-up': 0, Classifier: 0 };
  for (const rule of rules) {
    counts[rule.family] += 1;
  }
  return counts;
};

/** Count of rules with no adjustable metric (`tunable: false`) -- the rail's "No adjustable metric" row. */
export const countFixedRules = (rules: RuleCatalogEntry[]): number =>
  rules.filter((rule) => !rule.tunable).length;

/** Builds a human sentence naming every currently-active filter, for the empty-result state. */
export const describeActiveFilters = (filters: RuleFilters): string => {
  const parts: string[] = [];
  if (filters.search.trim()) {
    parts.push(`matching "${filters.search.trim()}"`);
  }
  if (filters.family) {
    parts.push(`in ${filters.family}`);
  }
  if (filters.tunable !== null) {
    parts.push(filters.tunable ? 'that are tunable' : 'with no adjustable metric');
  }
  return parts.join(' ');
};

/** camelCase MatchingConfig field name -> a human label, e.g. "wireFeeTolerance" -> "Wire Fee Tolerance". */
export const formatMetricLabel = (id: keyof MatchingConfig): string =>
  id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());

/** Slider step size derived from a metric's unit and range -- fine-grained for fractional ranges, whole numbers otherwise. */
export const deriveMetricStep = (metric: RuleVarianceMetric): number => {
  if (metric.unit === 'percent') {
    return 0.01;
  }
  if (metric.unit === 'USD' && metric.max <= 10) {
    return 0.01;
  }
  return 1;
};

/** Formats a raw MatchingConfig value for display, given its metric's unit. */
export const formatVarianceMetricValue = (value: number, unit: RuleVarianceMetric['unit']): string => {
  if (unit === 'days') {
    return `${value} day${value === 1 ? '' : 's'}`;
  }
  if (unit === 'count') {
    return `${value}`;
  }
  if (unit === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: value < 1 ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(value);
  }
  // percent: stored as a raw 0-1 fraction
  const percent = value * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
};
