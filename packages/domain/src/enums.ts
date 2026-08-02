/** The two transaction sources the reconciliation engine compares. */
export const sourceSystems = ['bank', 'qbo'] as const;
/** Union of the two transaction source identifiers: `'bank'` or `'qbo'`. */
export type SourceSystem = (typeof sourceSystems)[number];

/** Lifecycle status of a reconciliation run stored in the database. */
export const runStatuses = ['Pending', 'Running', 'Completed', 'Failed'] as const;
/** Union of valid reconciliation run lifecycle statuses. */
export type ReconciliationRunStatus = (typeof runStatuses)[number];

/**
 * How confident the matching engine is that a bank/GL transaction pair is the same event.
 * Ordered from strongest to weakest:
 * - `Exact` — amount, date, and text all match within tolerances
 * - `Probable` — strong text/amount match with a date variance
 * - `DateVariance` — same amount and description but posting dates differ by a small window
 * - `TimingDifference` — amount matches but the date gap exceeds the date-tolerance threshold
 * - `AmountMismatch` — text matches but amounts differ beyond tolerance
 * - `Ambiguous` — cannot confidently pair; sent to reviewer queue
 * - `Unmatched` — no candidate found
 */
export const matchConfidenceLevels = [
  'Exact',
  'Probable',
  'DateVariance',
  'TimingDifference',
  'AmountMismatch',
  'Ambiguous',
  'Unmatched',
] as const;
/** Union of all match confidence level strings ordered from strongest to weakest. */
export type MatchConfidence = (typeof matchConfidenceLevels)[number];

/**
 * The outcome disposition assigned to each pairwise match result.
 * Dispositions map to confidence levels but are stored separately so they
 * can be updated by reviewer decisions without re-running the engine.
 */
export const matchDispositions = [
  'ExactMatch',
  'ProbableMatch',
  'DateVariance',
  'TimingDifference',
  'AmountMismatch',
  'MissingFromBank',
  'MissingFromQBO',
  'DuplicateTransaction',
  'InvalidData',
  'AmbiguousReview',
] as const;
/** Union of all match disposition strings stored on each pairwise result. */
export type MatchDisposition = (typeof matchDispositions)[number];

/** Risk rating assigned to each exception item; drives sort order in the exception report. */
export const severityLevels = ['Critical', 'High', 'Medium', 'Low'] as const;
/** Union of risk rating strings assigned to exception items. */
export type SeverityLevel = (typeof severityLevels)[number];

/**
 * All exception categories the classifier can assign to an unmatched or problematic transaction.
 * Each category has a default severity defined in `ReportingConfig.severityByCategory`.
 */
export const errorCategories = [
  'MissingFromBank',
  'MissingFromQBO',
  'AmountMismatch',
  'DuplicateInBank',
  'DuplicateInQBO',
  'LikelySplitCombineIssue',
  'DepositGroupingIssue',
  'LikelyMiscoding',
  'DateVariance',
  'TimingDifference',
  'CheckNumberMismatch',
  'ReferenceNumberMismatch',
  'DescriptionMerchantVariance',
  'StaleOutstandingCheck',
  'OutstandingCheck',
  'FeeNettingMatch',
  'PartialPaymentMatch',
  'PayrollBatchMatch',
  'BankServiceChargeAmortization',
  'LoanPaymentSplit',
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
] as const;
/** Union of all assignable exception category strings. */
export type ErrorCategory = (typeof errorCategories)[number];

/** Identifiers for the two pre-built chart series included in every reconciliation summary. */
export const chartIdentifiers = ['countByCategory', 'exposureByCategory'] as const;
/** Union of the two chart series identifiers included in every reconciliation summary. */
export type ChartIdentifier = (typeof chartIdentifiers)[number];

/** Lifecycle status of a mapping profile or one of its versions. */
export const mappingProfileStatuses = ['ACTIVE', 'DEPRECATED'] as const;
/** Union of valid mapping profile / version lifecycle statuses. */
export type MappingProfileStatus = (typeof mappingProfileStatuses)[number];

/** Lifecycle status of an uploaded source file's staged (pre-canonical) transactions. */
export const stagedTransactionStatuses = [
  'PENDING_VALIDATION',
  'VALID',
  'INVALID',
  'PROMOTED',
] as const;
/** Union of valid staged-transaction lifecycle statuses. */
export type StagedTransactionStatus = (typeof stagedTransactionStatuses)[number];

/** Scope a validation rule operates over. */
export const validationRuleScopes = [
  'FILE',
  'SCHEMA',
  'ROW',
  'CROSS_ROW',
  'PERIOD',
  'ACCOUNTING',
] as const;
/** Union of valid validation rule scopes. */
export type ValidationRuleScope = (typeof validationRuleScopes)[number];

/** Severity of a validation rule and the results it produces. */
export const validationSeverities = ['FATAL', 'WARNING', 'INFO'] as const;
/** Union of valid validation severities. */
export type ValidationSeverity = (typeof validationSeverities)[number];

/** Approval status of an uploaded import awaiting review before canonical promotion. */
export const importApprovalStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'OVERRIDDEN'] as const;
/** Union of valid import approval statuses. */
export type ImportApprovalStatus = (typeof importApprovalStatuses)[number];

/** Approval status surfaced on a source file before/while it moves through the approval workflow. */
export const sourceFileApprovalStatuses = [
  'NOT_SUBMITTED',
  'PENDING',
  'APPROVED',
  'REJECTED',
] as const;
/** Union of valid source-file approval statuses. */
export type SourceFileApprovalStatus = (typeof sourceFileApprovalStatuses)[number];
