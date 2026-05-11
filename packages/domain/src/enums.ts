/** The two transaction sources the reconciliation engine compares. */
export const sourceSystems = ['bank', 'qbo'] as const;
export type SourceSystem = (typeof sourceSystems)[number];

/** Lifecycle status of a reconciliation run stored in the database. */
export const runStatuses = ['Pending', 'Running', 'Completed', 'Failed'] as const;
export type ReconciliationRunStatus = (typeof runStatuses)[number];

/**
 * How confident the matching engine is that a bank/QBO transaction pair is the same event.
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
export type MatchDisposition = (typeof matchDispositions)[number];

/** Risk rating assigned to each exception item; drives sort order in the exception report. */
export const severityLevels = ['Critical', 'High', 'Medium', 'Low'] as const;
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
  'InvalidOrMissingData',
  'AmbiguousMatchRequiringReview',
] as const;
export type ErrorCategory = (typeof errorCategories)[number];

/** Identifiers for the two pre-built chart series included in every reconciliation summary. */
export const chartIdentifiers = ['countByCategory', 'exposureByCategory'] as const;
export type ChartIdentifier = (typeof chartIdentifiers)[number];
