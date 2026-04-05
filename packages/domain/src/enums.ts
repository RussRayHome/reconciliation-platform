export const sourceSystems = ['bank', 'qbo'] as const;
export type SourceSystem = (typeof sourceSystems)[number];

export const runStatuses = ['Pending', 'Running', 'Completed', 'Failed'] as const;
export type ReconciliationRunStatus = (typeof runStatuses)[number];

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

export const severityLevels = ['Critical', 'High', 'Medium', 'Low'] as const;
export type SeverityLevel = (typeof severityLevels)[number];

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

export const chartIdentifiers = ['countByCategory', 'exposureByCategory'] as const;
export type ChartIdentifier = (typeof chartIdentifiers)[number];
