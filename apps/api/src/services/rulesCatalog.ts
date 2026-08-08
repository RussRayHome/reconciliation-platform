import type { RuleCatalogResponse } from '@recon/domain';
import { buildRuleCatalog } from '@recon/core';

/**
 * Every rule the matching engine and exception classifier can emit, with the `MatchingConfig`
 * metrics that tune each one. Derived from `@recon/core`'s own rule/category identifiers, not a
 * hand-maintained duplicate — see `buildRuleCatalog` for how family coverage is guaranteed.
 */
export const RULES_CATALOG: RuleCatalogResponse = buildRuleCatalog();

/** The set of every tunable `MatchingConfig` field id — used to reject unknown metric ids in a submitted `varianceOverrides` map. */
export const RULES_CATALOG_METRIC_IDS: ReadonlySet<string> = new Set(
  RULES_CATALOG.metrics.map((metric) => metric.id),
);

/**
 * Whether `executeReconciliation` actually applies the active matching-config version's
 * `varianceOverrides` to a live reconciliation run. False until that Phase 0 engine-wiring work
 * ships — flip this once it does. Every consumer of `RuleVersionsResponse` treats this as the
 * single source of truth for whether an ACTIVE version's overrides are more than cosmetic.
 */
export const OVERRIDES_APPLIED_TO_ENGINE = false;
