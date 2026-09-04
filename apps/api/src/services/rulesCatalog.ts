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
 * TRUE since Issue #260. A run now resolves its organization's ACTIVE version
 * (`app.ts`, via `listMatchingConfigVersions`) and hands those overrides to
 * `executeReconciliationFromNormalized`, which merges them into the `MatchingConfig` the engine
 * receives. A request-body override for the same metric layers on top, being more specific.
 *
 * `run.appliedVarianceOverrides` is written from the same map the config was built from, so it
 * records what the engine actually used regardless of source -- it can no longer assert a
 * tolerance that was never applied. The version's id is threaded to the engine as well and lands
 * on every `MatchResult.matchingConfigVersionId` (the field #276 added for exactly this).
 */
export const OVERRIDES_APPLIED_TO_ENGINE = true;
