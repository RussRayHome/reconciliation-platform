import { errorCategories, type ErrorCategory } from './enums';

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
