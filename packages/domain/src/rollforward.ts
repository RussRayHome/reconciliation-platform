import { errorCategories, type ErrorCategory, type SourceSystem } from './enums';

/**
 * Whether an exception in this category is a genuine reconciling item that should survive into
 * the next period as an open item (Unreconciled Item Roll-Forward, §3.7) -- `Record<ErrorCategory,
 * boolean>`, exhaustive over `errorCategories`, the same technique `ruleCatalog.ts` uses for
 * `METRIC_RANGES`/`MATCHING_RULE_METADATA`: a new category added to `errorCategories` without a
 * carry decision here fails the build, not silently defaults to one behavior or the other.
 *
 * Carry (true) -- timing differences and genuine unreconciled items, the plan's own explicit
 * list: `OutstandingCheck`, `StaleOutstandingCheck`, `DepositInTransit`, `MissingFromBank`,
 * `MissingFromGL`, `TimingDifference`, `IntercompanyMismatch`, `NSFReturnedDeposit`, plus
 * `AmountMismatch` (the plan's own recommendation -- not a timing difference, so it will not
 * self-clear, but it is an unexplained residual that belongs on the support schedule with a
 * mandatory owner and due date so it cannot age silently).
 *
 * Never carry (false) -- two groups:
 *   - The plan's own explicit "data-quality and review artifacts, fixed at source, not aged"
 *     list: `DuplicateInBank`, `DuplicateInGL`, `InvalidOrMissingData`, `WeakDescriptionMatch`,
 *     `DescriptionMerchantVariance`, `AmbiguousMatchRequiringReview`, `LikelyMiscoding`.
 *   - Every remaining category the plan did not enumerate by name -- decided here by the same
 *     underlying test the plan applied to its own list, not left to guesswork:
 *       - Already-matched pairs carrying only a review flag (`DateVariance`,
 *         `CheckNumberMismatch`, `ReferenceNumberMismatch`, `ReversalVoid`, `ACHReturn`,
 *         `ChargebackReturn`) -- both sides of the transaction already found each other; nothing
 *         is left open to wait on next period.
 *       - Already-resolved grouped matches (`LikelySplitCombineIssue`, `DepositGroupingIssue`,
 *         `FeeNettingMatch`, `PartialPaymentMatch`, `PayrollBatchMatch`,
 *         `BankServiceChargeAmortization`, `LoanPaymentSplit`) -- the grouped-reservation stage
 *         already recognized the pattern; there is no unresolved counterpart pending.
 *       - Anomalies needing an immediate booking/investigation action this period, not a future
 *         counterpart to wait for (`VoidedCheckCleared` -- the check already cleared the bank, so
 *         there is nothing left to happen; `InterestIncome` -- the fix is to book the missing GL
 *         entry now, not wait for one to appear).
 *
 * This second group is a judgment call extending past the plan's own explicit §3.7 list, applying
 * its stated reasoning ("timing differences and genuine unreconciled items" carry; matched pairs
 * and resolved patterns do not) rather than the plan's own text. Worth a deliberate second look
 * before PR C.4 (the finalize projection that reads this map) ships.
 */
export const CARRY_ELIGIBLE_CATEGORIES: Record<ErrorCategory, boolean> = {
  // Carry
  OutstandingCheck: true,
  StaleOutstandingCheck: true,
  DepositInTransit: true,
  MissingFromBank: true,
  MissingFromGL: true,
  TimingDifference: true,
  IntercompanyMismatch: true,
  NSFReturnedDeposit: true,
  AmountMismatch: true,

  // Never carry -- plan's explicit list (data-quality / review artifacts, fixed at source)
  DuplicateInBank: false,
  DuplicateInGL: false,
  InvalidOrMissingData: false,
  WeakDescriptionMatch: false,
  DescriptionMerchantVariance: false,
  AmbiguousMatchRequiringReview: false,
  LikelyMiscoding: false,

  // Never carry -- already-matched pairs carrying only a review flag
  DateVariance: false,
  CheckNumberMismatch: false,
  ReferenceNumberMismatch: false,
  ReversalVoid: false,
  ACHReturn: false,
  ChargebackReturn: false,

  // Never carry -- already-resolved grouped matches
  LikelySplitCombineIssue: false,
  DepositGroupingIssue: false,
  FeeNettingMatch: false,
  PartialPaymentMatch: false,
  PayrollBatchMatch: false,
  BankServiceChargeAmortization: false,
  LoanPaymentSplit: false,

  // Never carry -- anomalies needing an immediate action this period, not a future counterpart
  VoidedCheckCleared: false,
  InterestIncome: false,
};

/** True when `category` is a genuine reconciling item that should be projected into an open item
 * at finalize (PR C.4) rather than left to expire with the run that detected it. */
export const isCarryEligible = (category: ErrorCategory): boolean =>
  CARRY_ELIGIBLE_CATEGORIES[category];

/** Build-time self-check that `CARRY_ELIGIBLE_CATEGORIES` covers every category exactly once --
 * redundant with the `Record<ErrorCategory, boolean>` type itself (which already fails to compile
 * on a missing key), kept as a cheap runtime assertion for anything that reads the map dynamically
 * (e.g. a future admin/debug endpoint) without going through the type-checked literal. */
export const assertCarryEligibilityIsExhaustive = (): void => {
  const missing = errorCategories.filter(
    (category) => !(category in CARRY_ELIGIBLE_CATEGORIES),
  );
  if (missing.length > 0) {
    throw new Error(`CARRY_ELIGIBLE_CATEGORIES is missing: ${missing.join(', ')}`);
  }
};

/** Which tier of `deriveNaturalKey` (packages/core/src/rollforward/naturalKey.ts) produced a
 * candidate's natural key -- recorded alongside the key itself so a Tier-3 (fingerprint-only)
 * match can be flagged for manual review differently than a Tier-1 (check-number) match. Defined
 * here, not in packages/core, so both packages/core (which derives it) and packages/persistence
 * (which persists it) can share the same type without persistence taking on a dependency on core
 * -- persistence only ever depends on domain. */
export type NaturalKeyTier = 1 | 2 | 3;

/**
 * One carry-eligible exception, reduced to exactly what's needed to project (or re-confirm) an
 * open item -- the output of packages/core's `buildOpenItemCandidates` and the input to
 * packages/persistence's `PostgresOpenItemStore.projectOpenItems` (PR C.4). `accountIdentifier`
 * is still the raw free-text value at this point (from the underlying `NormalizedTransaction`) --
 * resolving it to a real `reconciliation_account.id` (find-or-create) is the persistence layer's
 * job, not core's, since core has no database access.
 */
export interface OpenItemCandidate {
  accountIdentifier: string;
  sourceSystem: SourceSystem;
  category: ErrorCategory;
  naturalKey: string;
  naturalKeyTier: NaturalKeyTier;
  originalTransactionDate: string;
  amount: number;
  checkNumber?: string;
  referenceNumber?: string;
  descriptionSnapshot?: string;
}

/** Why carry-forward is or isn't active for a given run -- the two reasons are ordered by which
 * one wins: the env var is the ops kill switch, checked first, so it can disable carry-forward
 * deployment-wide during an incident regardless of any organization's own setting. */
export type CarryForwardSkipReason = 'ENV_DISABLED' | 'ORG_NOT_ENABLED';

export type CarryForwardDecision =
  | { enabled: true }
  | { enabled: false; reason: CarryForwardSkipReason };

/**
 * Whether carry-forward should apply to this run -- PR C.5 (see
 * docs/PR-D-Gating-Change-Document.pdf), gating PR D's carry-forward-into-matching mechanism.
 * Deliberately NOT read from `reconciliation_matching_config_version.variance_overrides`: that
 * column is `Partial<Record<keyof MatchingConfig, number>>`, every `MatchingConfig` field is
 * numeric, and the whole versioning stack isn't wired to the engine yet
 * (`OVERRIDES_APPLIED_TO_ENGINE = false`) -- a value stored there would be silently ignored.
 * Enablement is a rollout property (closer to a subscription flag than a tuned threshold), read
 * directly from `reconciliation_organization.carry_forward_enabled` instead.
 *
 * Pure decision logic only -- `envEnabled` (the `ENABLE_CARRY_FORWARD` kill switch, default on)
 * and `orgEnabled` (the organization's own column) are both resolved by the caller, which has the
 * environment and database access this function deliberately doesn't need.
 */
export const resolveCarryForwardDecision = (input: {
  envEnabled: boolean;
  orgEnabled: boolean;
}): CarryForwardDecision => {
  if (!input.envEnabled) {
    return { enabled: false, reason: 'ENV_DISABLED' };
  }
  if (!input.orgEnabled) {
    return { enabled: false, reason: 'ORG_NOT_ENABLED' };
  }
  return { enabled: true };
};
