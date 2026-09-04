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
 * Whether the reconciliation pipeline applies the **active matching-config version's**
 * `varianceOverrides` to a live reconciliation run. Every consumer of `RuleVersionsResponse`
 * treats this as the single source of truth for whether an ACTIVE version's overrides are more
 * than cosmetic.
 *
 * STILL FALSE, deliberately. Issue #260 has two halves and only one is done:
 *
 *  - DONE: request-body `varianceOverrides` now reach the engine.
 *    `executeReconciliationFromNormalized` merges them into the `MatchingConfig` it hands the
 *    engine and records only the metrics that landed as `run.appliedVarianceOverrides`. Before
 *    that the engine ran on `defaultReconciliationConfig` and the override was stamped onto the
 *    finished run -- asserting a tolerance never applied.
 *
 *  - NOT DONE: nothing loads an ACTIVE version's `variance_overrides` for a run. The only source
 *    is the request body (`app.ts:491`). An approver can still publish a version through the full
 *    maker-checker workflow, see it ACTIVE, and have the engine never see it.
 *
 * This flag describes the second half, so it stays false until a run resolves the ACTIVE version
 * for its organization. Flipping it now would be the same class of false claim #260 exists to
 * remove.
 */
export const OVERRIDES_APPLIED_TO_ENGINE = false;
