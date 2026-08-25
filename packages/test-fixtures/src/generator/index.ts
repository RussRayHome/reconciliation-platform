/**
 * Deterministic multi-period scenario generator.
 *
 * Produces bank + GL files for N consecutive periods together with an **answer key** derived from
 * how the data was constructed -- never from running the engine over it. That separation is the
 * whole value: if the generator and the engine shared a grouping helper, a bug in that helper
 * would make both agree and the test would pass wrongly.
 *
 * Feeds three things at once:
 *   - T0.4 recall guard -- every true match is labelled
 *   - T0.2 perf harness -- `cleanPairs` scales to the 4k-9k workload
 *   - T0.3 Probe-1 -- the stolen-member fixture is a scenario, not a one-off file
 */
export { compose } from './compose';
export type { ComposeOptions, Dataset, PeriodFiles, ResolvedRow } from './compose';
export { createRng } from './rng';
export type { Rng } from './rng';
export { daysInMonth, periodBounds, periodDate, periodMonth } from './periods';
export type { PeriodAnchor } from './periods';
export type {
  BankRowSpec,
  Cardinality,
  Expectation,
  Fragment,
  GlRowSpec,
  PeriodIndex,
  Scenario,
  ScenarioContext,
} from './types';

export { cleanPairs } from './scenarios/cleanPairs';
export type { CleanPairsOptions } from './scenarios/cleanPairs';
export { nToOneBillSettlement } from './scenarios/nToOneBillSettlement';
export { outstandingCheck } from './scenarios/outstandingCheck';
export { probeOne } from './scenarios/probeOne';
