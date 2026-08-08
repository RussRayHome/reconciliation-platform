/** The two transaction sources the reconciliation engine compares. */
export const sourceSystems = ['bank', 'gl'] as const;
/** Union of the two transaction source identifiers: `'bank'` or `'gl'`. */
export type SourceSystem = (typeof sourceSystems)[number];

/** Canonical field names the engine recognises in uploaded spreadsheets. */
export const businessFields = [
  'transactionDate',
  'postingDate',
  'transactionType',
  'checkNumber',
  'serialNumber',
  'referenceNumber',
  'description',
  'merchantName',
  'payeeName',
  'amount',
  'splitAmount',
  'debit',
  'credit',
  'runningBalance',
  'accountIdentifier',
] as const;
/** Union of all canonical business field identifiers. */
export type BusinessField = (typeof businessFields)[number];

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
  'MissingFromGL',
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
  'MissingFromGL',
  'AmountMismatch',
  'DuplicateInBank',
  'DuplicateInGL',
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

/** Authentication event kinds recorded in `reconciliation_login_event` (ISSUE-050.2). */
export const loginEventTypes = ['LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT'] as const;
/** Union of valid login-event kinds. */
export type LoginEventType = (typeof loginEventTypes)[number];

/**
 * Lifecycle status of a matching-config version (a named, published snapshot of
 * `MatchingConfig` variance overrides). At most one version per organization is `ACTIVE` and at
 * most one is `DRAFT` at a time; publishing a `DRAFT` moves it to `ACTIVE` and moves the
 * previously `ACTIVE` version to `SUPERSEDED` in the same transaction.
 */
export const matchingConfigVersionStatuses = ['DRAFT', 'ACTIVE', 'SUPERSEDED'] as const;
/** Union of valid matching-config version lifecycle statuses. */
export type MatchingConfigVersionStatus = (typeof matchingConfigVersionStatuses)[number];

/** A per-column data transform applied between a mapped source value and its canonical field. */
export const transformKinds = [
  'none',
  'trim',
  'dateReformat',
  'parseNumber',
  'negate',
  'deriveDirection',
  'uppercase',
  'accountLookup',
] as const;
/** Union of all supported mapping-column transform kinds. */
export type TransformKind = (typeof transformKinds)[number];

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

/** The application user roles (ADR-0002, DECIDE 2 = a single role column). 'developer' was
 *  removed once the in-app Developer Dashboard it existed solely to gate was replaced by a fully
 *  separate application (apps/developer-dashboard-api/web) with its own GitHub-OAuth login,
 *  unreachable from and unaware of this product's own auth. See changeset 0033. The six business
 *  roles (financial-analyst through cfo) are the self-serve-selectable roles offered at signup;
 *  admin/superuser are not choosable there. See changeset 0034. */
export const userRoles = [
  'financial-analyst',
  'senior-analyst',
  'staff-accountant',
  'controller',
  'vp-finance',
  'cfo',
  'admin',
  'superuser',
] as const;
/** Union of valid user roles. */
export type UserRole = (typeof userRoles)[number];

/** Per-role feature access, shared by the API (route-level enforcement) and the web app (UI gating). */
export interface RolePermissions {
  canAccessApplication: boolean;
  canAccessDocumentation: boolean;
  canAdjustSliderDefaults: boolean;
  canAccessRunBook: boolean;
}

/**
 * Single source of truth for role -> permission mapping. Previously duplicated between
 * apps/web/src/App.tsx (UI gating only) and nothing on the server (ADR-0002 found zero
 * server-side enforcement); both now import this instead of maintaining their own copy, so the
 * two can no longer drift out of sync with each other.
 */
export const rolePermissionsByRole: Record<UserRole, RolePermissions> = {
  'financial-analyst': {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
  },
  'senior-analyst': {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
  },
  'staff-accountant': {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
  },
  controller: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
  },
  'vp-finance': {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
  },
  cfo: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
  },
  admin: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: true,
    canAccessRunBook: true,
  },
  superuser: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: true,
    canAccessRunBook: true,
  },
};

/** Status of the outside-source Secretary of State entity/filing-number check, tracked per
 *  organization. 'pending' until the check resolves; 'failed' is retryable, not terminal. */
export const entityVerificationStatuses = ['pending', 'verified', 'failed'] as const;
/** Union of valid entity-verification statuses. */
export type EntityVerificationStatus = (typeof entityVerificationStatuses)[number];

/** Status of a signup user's email/SMS code confirmation. A wrong code doesn't move this to a
 *  terminal 'failed' state -- the user just resends and retries. */
export const identityVerificationStatuses = ['pending', 'verified'] as const;
/** Union of valid identity-verification statuses. */
export type IdentityVerificationStatus = (typeof identityVerificationStatuses)[number];
