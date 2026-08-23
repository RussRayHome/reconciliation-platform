import type {
  ErrorCategory,
  MatchingConfig,
  RuleCatalogEntry,
  RuleCatalogResponse,
  RuleVarianceMetric,
  RuleVarianceMetricUnit,
} from '@recon/domain';
import { defaultReconciliationConfig } from '@recon/config';

import { MATCHING_RULE_NAMES, slugifyRuleName, type MatchingRuleName } from './engine';
import { GROUPED_RULES, type GroupedRuleId } from './groupedReservations';

type MetricRange = { unit: RuleVarianceMetricUnit; min: number; max: number };

/**
 * Safe adjustment range for every `MatchingConfig` field. `Record<keyof MatchingConfig, ...>`
 * forces an entry for every config field — add a field to `MatchingConfig` without adding its
 * range here and the build fails.
 */
const METRIC_RANGES: Record<keyof MatchingConfig, MetricRange> = {
  amountTolerance: { unit: 'USD', min: 0, max: 1 },
  dateToleranceDays: { unit: 'days', min: 0, max: 31 },
  timingDifferenceDays: { unit: 'days', min: 0, max: 90 },
  staleOutstandingCheckDays: { unit: 'days', min: 0, max: 120 },
  textSimilarityThreshold: { unit: 'percent', min: 0, max: 1 },
  probableTextSimilarityThreshold: { unit: 'percent', min: 0, max: 1 },
  referenceSimilarityThreshold: { unit: 'percent', min: 0, max: 1 },
  distinctiveAmountMaxOccurrences: { unit: 'count', min: 1, max: 10 },
  groupedCandidatePoolSize: { unit: 'count', min: 1, max: 20 },
  groupedMatchMaxSize: { unit: 'count', min: 1, max: 10 },
  duplicateDateWindowDays: { unit: 'days', min: 0, max: 31 },
  duplicateSimilarityThreshold: { unit: 'percent', min: 0, max: 1 },
  amountMismatchTextSimilarityThreshold: { unit: 'percent', min: 0, max: 1 },
  reversalWindowDays: { unit: 'days', min: 0, max: 30 },
  depositInTransitDays: { unit: 'days', min: 0, max: 30 },
  partialPaymentWindowDays: { unit: 'days', min: 0, max: 180 },
  wireFeeTolerance: { unit: 'USD', min: 0, max: 5000 },
  creditCardFeeTolerance: { unit: 'percent', min: 0, max: 0.15 },
};

const buildMetrics = (): RuleVarianceMetric[] =>
  (Object.keys(METRIC_RANGES) as Array<keyof MatchingConfig>).map((id) => ({
    id,
    ...METRIC_RANGES[id],
    default: defaultReconciliationConfig.matching[id],
  }));

type RuleMetadata = {
  description: string;
  varianceMetricIds: Array<keyof MatchingConfig>;
  risk?: 'elevated';
};

/**
 * Metadata for every one-to-one matching rule in `MATCHING_RULE_NAMES`. `Record<MatchingRuleName,
 * ...>` forces an entry per rule name — add a rule in `engine.ts` without describing it here and
 * the build fails.
 */
const MATCHING_RULE_METADATA: Record<MatchingRuleName, RuleMetadata> = {
  'Check Number Amount Mismatch': {
    description:
      'Flags a check-number match whose recorded amounts differ beyond tolerance as a likely posting error or partial payment.',
    varianceMetricIds: ['referenceSimilarityThreshold', 'timingDifferenceDays'],
  },
  'Check Number Date Variance': {
    description:
      'Flags a check-number match whose posting dates fall outside the primary tolerance but within the extended timing window.',
    varianceMetricIds: [
      'referenceSimilarityThreshold',
      'dateToleranceDays',
      'timingDifferenceDays',
    ],
  },
  'Reference + Amount Match': {
    description:
      'Pairs bank and GL transactions when amounts agree within tolerance and reference similarity meets the configured threshold.',
    varianceMetricIds: ['amountTolerance', 'referenceSimilarityThreshold'],
  },
  'Reference Match with Amount Variance': {
    description:
      'Pairs transactions on a strongly matching reference or document number even when recorded amounts differ, mirroring the check-number variance rule for non-check references.',
    varianceMetricIds: ['referenceSimilarityThreshold', 'timingDifferenceDays'],
  },
  'Historical Pattern Match': {
    description:
      'Pairs a bank transaction with a GL transaction when the bank description matches a learned payee alias pattern with sufficient confidence.',
    varianceMetricIds: ['textSimilarityThreshold', 'dateToleranceDays', 'timingDifferenceDays'],
  },
  'Month-End Transfer Review Match': {
    description:
      'Flags month-end transfer patterns as probable-review candidates when amount, month, and journal-entry context align but should not be forced into an exact match.',
    varianceMetricIds: ['amountTolerance'],
  },
  'Amount + Date + Text with Reference Variance': {
    description:
      'Creates a review candidate when amount, date, and description align but check or reference identifiers conflict.',
    varianceMetricIds: [
      'amountTolerance',
      'dateToleranceDays',
      'textSimilarityThreshold',
      'referenceSimilarityThreshold',
    ],
  },
  'Amount + Date + Text Match': {
    description:
      'Promotes transactions into a clean match when amount, date, and normalized text context align strongly enough for exact matching.',
    varianceMetricIds: [
      'amountTolerance',
      'dateToleranceDays',
      'textSimilarityThreshold',
      'referenceSimilarityThreshold',
    ],
  },
  'Amount + Date with Description Variance': {
    description:
      'Sends same-amount, same-window pairs with weaker narrative similarity into review instead of exact matching.',
    varianceMetricIds: [
      'amountTolerance',
      'dateToleranceDays',
      'textSimilarityThreshold',
      'probableTextSimilarityThreshold',
    ],
  },
  'Amount + Date Match, Weak Description': {
    description:
      'Second-pass fuzzy match: pairs a same-day, amount-distinctive bank/GL pair left unmatched by every stricter rule above, using only amount, same-day date equality, and a rarity check on the amount -- description similarity informs confidence only, never eligibility. Deliberately scoped to same-day (not the full date tolerance window) so a genuinely conflicting narrative on a >0-day gap is still routed to LikelyMiscoding review instead of being silently downgraded.',
    varianceMetricIds: ['amountTolerance', 'dateToleranceDays', 'distinctiveAmountMaxOccurrences'],
  },
  'Amount + Extended Date Window Match': {
    description:
      'Creates a date-variance candidate when amounts agree but date drift falls outside the primary tolerance and inside the extended review window.',
    varianceMetricIds: ['amountTolerance', 'timingDifferenceDays'],
  },
  'Wire Correspondent Fee Deduction': {
    description:
      'Flags a same-direction, strongly-matching pair with wire evidence (transaction type or narrative text) on one side, whose amount difference is within the wire-fee tolerance, as a likely correspondent-bank or processing fee deducted in transit.',
    varianceMetricIds: ['dateToleranceDays', 'wireFeeTolerance', 'textSimilarityThreshold'],
    risk: 'elevated',
  },
  'Credit Card Service Fee Deduction': {
    description:
      'Flags a same-direction, strongly-matching pair with card evidence (transaction type or narrative text) on one side, whose percentage amount difference is within the credit-card fee tolerance, as a likely card processor or merchant services fee.',
    varianceMetricIds: ['dateToleranceDays', 'creditCardFeeTolerance', 'textSimilarityThreshold'],
    risk: 'elevated',
  },
  'FX Rate Variance': {
    description:
      'Flags a same-direction, strongly-matching pair whose percentage amount difference is consistent with a foreign exchange rate difference or a processing discount.',
    varianceMetricIds: ['dateToleranceDays', 'textSimilarityThreshold'],
  },
  'Possible Amount Mismatch': {
    description:
      'Marks near-date, high-similarity pairs for amount-mismatch review when narrative context aligns but recorded amounts differ.',
    varianceMetricIds: ['dateToleranceDays', 'amountMismatchTextSimilarityThreshold'],
  },
};

/**
 * Metadata for every grouped (many-to-many) rule in `GROUPED_RULES`. `Record<GroupedRuleId, ...>`
 * forces an entry per grouped rule — add one in `groupedReservations.ts` without describing it
 * here and the build fails.
 */
const GROUPED_RULE_METADATA: Record<GroupedRuleId, RuleMetadata> = {
  'grouped-deposit-reserved': {
    description:
      'Reserves a balanced many-to-many deposit grouping — bank and GL totals agree within tolerance across multiple lines — before one-to-one review matching runs.',
    varianceMetricIds: [
      'amountTolerance',
      'timingDifferenceDays',
      'groupedCandidatePoolSize',
      'groupedMatchMaxSize',
    ],
  },
  'grouped-split-combine-reserved': {
    description:
      'Reserves a balanced many-to-many split/combine grouping — opposite-sign totals agree within tolerance — before one-to-one review matching runs.',
    varianceMetricIds: [
      'amountTolerance',
      'timingDifferenceDays',
      'groupedCandidatePoolSize',
      'groupedMatchMaxSize',
    ],
  },
  'fee-netting-reserved': {
    description:
      'Classifies grouped scenarios where a bank net receipt equals GL gross revenue minus one or more fee entries.',
    varianceMetricIds: ['amountTolerance', 'timingDifferenceDays'],
  },
  'partial-payment-reserved': {
    description:
      'Classifies grouped scenarios where multiple bank debits roll up to a single GL payable amount within the partial-payment window.',
    varianceMetricIds: ['amountTolerance', 'partialPaymentWindowDays'],
  },
  'payroll-batch-reserved': {
    description:
      'Classifies grouped payroll scenarios where one bank payroll debit corresponds to multiple GL payroll expense rows.',
    varianceMetricIds: ['amountTolerance', 'dateToleranceDays'],
  },
  'bank-service-charge-reserved': {
    description:
      'Classifies grouped fee scenarios where one bank service charge maps to multiple GL expense allocations.',
    varianceMetricIds: ['amountTolerance', 'dateToleranceDays'],
  },
  'loan-payment-split-reserved': {
    description:
      'Classifies grouped loan payment scenarios where one bank debit corresponds to principal and interest components in GL.',
    varianceMetricIds: ['amountTolerance', 'dateToleranceDays'],
  },
};

/**
 * `ErrorCategory` values the exception classifier (or the matching engine's own disposition
 * logic) can assign that aren't already represented by a `MATCHING_RULE_METADATA` or
 * `GROUPED_RULES` entry. The 7 grouped categories map 1:1 onto a `GROUPED_RULES` entry and are
 * intentionally excluded here — including them again under `Classifier` would just duplicate the
 * same rule under a second id. `ruleCatalog.test.ts` asserts this list plus the grouped
 * categories together cover every `ErrorCategory` exactly once.
 */
const CLASSIFIER_CATEGORIES = [
  'MissingFromBank',
  'MissingFromGL',
  'AmountMismatch',
  'DuplicateInBank',
  'DuplicateInGL',
  'LikelyMiscoding',
  'DateVariance',
  'TimingDifference',
  'CheckNumberMismatch',
  'ReferenceNumberMismatch',
  'DescriptionMerchantVariance',
  'WeakDescriptionMatch',
  'StaleOutstandingCheck',
  'OutstandingCheck',
  'NSFReturnedDeposit',
  'VoidedCheckCleared',
  'InvalidOrMissingData',
  'AmbiguousMatchRequiringReview',
  'ReversalVoid',
  'ACHReturn',
  'DepositInTransit',
  'ChargebackReturn',
  'InterestIncome',
  'IntercompanyMismatch',
] as const satisfies readonly ErrorCategory[];

type ClassifierCategory = (typeof CLASSIFIER_CATEGORIES)[number];

/**
 * Metadata for every classifier-only category in `CLASSIFIER_CATEGORIES`. `Record<
 * ClassifierCategory, ...>` forces an entry per category — add one to `CLASSIFIER_CATEGORIES`
 * without describing it here and the build fails.
 */
const CLASSIFIER_RULE_METADATA: Record<ClassifierCategory, { name: string } & RuleMetadata> = {
  MissingFromBank: {
    name: 'Missing from Bank',
    description:
      'Classifies unmatched GL-side transactions as missing from bank activity after exact, review, and variance matching rules are exhausted.',
    varianceMetricIds: [],
  },
  MissingFromGL: {
    name: 'Missing from GL',
    description:
      'Classifies unmatched bank-side transactions as missing from GL after exact, review, and variance matching rules are exhausted.',
    varianceMetricIds: [],
  },
  AmountMismatch: {
    name: 'Amount Mismatch',
    description:
      'Generic bucket for unmatched or mismatched pairs whose recorded amounts differ beyond tolerance; specific rules like Wire Correspondent Fee Deduction and Possible Amount Mismatch refine this into a more precise reason where possible.',
    varianceMetricIds: ['amountTolerance'],
  },
  DuplicateInBank: {
    name: 'Duplicate in Bank',
    description:
      'Classifies a bank-side transaction as a same-source duplicate of an earlier bank row with matching amount, a close date, and similar description or reference context.',
    varianceMetricIds: [
      'amountTolerance',
      'duplicateDateWindowDays',
      'duplicateSimilarityThreshold',
    ],
  },
  DuplicateInGL: {
    name: 'Duplicate in GL',
    description:
      'Classifies a GL-side transaction as a same-source duplicate of an earlier GL row with matching amount, a close date, and similar description or reference context.',
    varianceMetricIds: [
      'amountTolerance',
      'duplicateDateWindowDays',
      'duplicateSimilarityThreshold',
    ],
  },
  LikelyMiscoding: {
    name: 'Likely Miscoding',
    description:
      'Promotes same-amount, near-date pairs with a distinctive (rarely repeated) amount into a miscoding exception when descriptive or reference context conflicts too strongly for an ordinary variance.',
    varianceMetricIds: ['amountTolerance', 'dateToleranceDays', 'distinctiveAmountMaxOccurrences'],
  },
  DateVariance: {
    name: 'Date Variance',
    description:
      'Classifies same-amount candidate pairs that reconcile narratively but exceed the primary posting-date tolerance window.',
    varianceMetricIds: ['amountTolerance', 'dateToleranceDays', 'timingDifferenceDays'],
  },
  TimingDifference: {
    name: 'Timing Difference',
    description:
      'Classifies residual same-amount, distinctive-amount pairs that fall outside the primary date tolerance but inside the extended timing window.',
    varianceMetricIds: [
      'dateToleranceDays',
      'timingDifferenceDays',
      'distinctiveAmountMaxOccurrences',
    ],
  },
  CheckNumberMismatch: {
    name: 'Check Number Mismatch',
    description:
      'Escalates high-confidence candidates into review when amount and date align but check identifiers conflict materially.',
    varianceMetricIds: ['amountTolerance', 'dateToleranceDays'],
  },
  ReferenceNumberMismatch: {
    name: 'Reference Number Mismatch',
    description:
      'Escalates high-confidence candidates into review when amount and date align but reference identifiers conflict materially.',
    varianceMetricIds: ['amountTolerance', 'dateToleranceDays'],
  },
  DescriptionMerchantVariance: {
    name: 'Description / Merchant Variance',
    description:
      'Escalates same-amount, same-window candidates into review when merchant or narrative similarity is below exact-match confidence.',
    varianceMetricIds: ['amountTolerance', 'dateToleranceDays', 'textSimilarityThreshold'],
  },
  WeakDescriptionMatch: {
    name: 'Weak Description Match',
    description:
      'Escalates second-pass fuzzy amount+date matches into review, since description similarity was too weak to corroborate the pairing on its own.',
    varianceMetricIds: ['amountTolerance', 'dateToleranceDays', 'distinctiveAmountMaxOccurrences'],
  },
  StaleOutstandingCheck: {
    name: 'Stale Outstanding Check',
    description:
      'Promotes unmatched aged GL check-like disbursements into a dedicated stale-check exception instead of generic missing-from-bank treatment.',
    varianceMetricIds: ['staleOutstandingCheckDays'],
  },
  OutstandingCheck: {
    name: 'Outstanding Check',
    description:
      'Classifies unmatched recent check-like GL disbursements as outstanding checks before broader missing-item fallback logic.',
    varianceMetricIds: ['staleOutstandingCheckDays'],
  },
  NSFReturnedDeposit: {
    name: 'NSF Returned Deposit',
    description:
      'Classifies unmatched bank debits with returned-check indicators after ACH return detection so paired return events are not double-classified.',
    varianceMetricIds: ['reversalWindowDays'],
  },
  VoidedCheckCleared: {
    name: 'Voided Check Cleared',
    description:
      'Classifies unmatched bank check-like debits with no GL counterpart after grouped and timing stages complete.',
    varianceMetricIds: [],
  },
  InvalidOrMissingData: {
    name: 'Invalid or Missing Data',
    description:
      'Classifies rows with malformed or missing critical fields as data-quality exceptions so they do not participate in automated matching.',
    varianceMetricIds: [],
  },
  AmbiguousMatchRequiringReview: {
    name: 'Ambiguous Match Requiring Review',
    description:
      'Holds back low-certainty top candidates when multiple close-scoring alternatives exist, preserving them for reviewer choice instead of forcing a weak match.',
    varianceMetricIds: ['textSimilarityThreshold', 'referenceSimilarityThreshold'],
  },
  ReversalVoid: {
    name: 'Reversal / Void Pair',
    description:
      'Identifies same-amount, opposite-sign unmatched bank pairs inside the reversal window and classifies both as reversal or void events.',
    varianceMetricIds: ['amountTolerance', 'reversalWindowDays'],
  },
  ACHReturn: {
    name: 'ACH Return Detection',
    description:
      'Detects offsetting debit-credit bank pairs with ACH or NSF indicators within the reversal window and classifies both sides as ACH returns.',
    varianceMetricIds: ['amountTolerance', 'reversalWindowDays'],
  },
  DepositInTransit: {
    name: 'Deposit in Transit',
    description:
      'Classifies unmatched near-period-end GL credits as deposits in transit before generic missing-item fallback applies.',
    varianceMetricIds: ['depositInTransitDays'],
  },
  ChargebackReturn: {
    name: 'Chargeback / Returned Item',
    description:
      'Classifies unmatched bank debits with chargeback indicators when offsetting same-amount return patterns are present.',
    varianceMetricIds: ['amountTolerance'],
  },
  InterestIncome: {
    name: 'Interest Income Classification',
    description:
      'Classifies unmatched bank credits containing interest-income indicators so they are separated from generic missing-item categories.',
    varianceMetricIds: [],
  },
  IntercompanyMismatch: {
    name: 'Intercompany Mismatch',
    description:
      'Classifies unmatched transactions containing intercompany or entity-transfer indicators that require cross-entity reconciliation review.',
    varianceMetricIds: [],
  },
};

const buildMatchingRules = (): RuleCatalogEntry[] =>
  MATCHING_RULE_NAMES.map((name) => {
    const metadata = MATCHING_RULE_METADATA[name];
    return {
      id: slugifyRuleName(name),
      name,
      family: 'Matching',
      description: metadata.description,
      varianceMetricIds: metadata.varianceMetricIds,
      tunable: metadata.varianceMetricIds.length > 0,
      risk: metadata.risk,
    };
  });

const buildGroupedRules = (): RuleCatalogEntry[] =>
  GROUPED_RULES.map(({ ruleId, ruleName }) => {
    const metadata = GROUPED_RULE_METADATA[ruleId];
    return {
      id: ruleId,
      name: ruleName,
      family: 'Grouped roll-up',
      description: metadata.description,
      varianceMetricIds: metadata.varianceMetricIds,
      tunable: metadata.varianceMetricIds.length > 0,
      risk: metadata.risk,
    };
  });

const buildClassifierRules = (): RuleCatalogEntry[] =>
  CLASSIFIER_CATEGORIES.map((category) => {
    const metadata = CLASSIFIER_RULE_METADATA[category];
    return {
      id: category,
      name: metadata.name,
      family: 'Classifier',
      description: metadata.description,
      varianceMetricIds: metadata.varianceMetricIds,
      tunable: metadata.varianceMetricIds.length > 0,
      risk: metadata.risk,
    };
  });

/**
 * Derives the full rule catalog from the matching engine's own rule/category identifiers — see
 * `MATCHING_RULE_NAMES`, `GROUPED_RULES`, and `CLASSIFIER_CATEGORIES` — rather than a
 * hand-maintained duplicate list that can drift from what the engine actually emits.
 */
export const buildRuleCatalog = (): RuleCatalogResponse => ({
  rules: [...buildMatchingRules(), ...buildGroupedRules(), ...buildClassifierRules()],
  metrics: buildMetrics(),
});

export { CLASSIFIER_CATEGORIES };
export type { ClassifierCategory };
