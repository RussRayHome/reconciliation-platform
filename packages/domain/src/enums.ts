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
  'WeakDescriptionMatch',
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

/** Identifiers for the pre-built chart series included in every reconciliation summary. */
export const chartIdentifiers = [
  'countByCategory',
  'exposureByCategory',
  'outstandingCheckAging',
] as const;
/** Union of the chart series identifiers included in every reconciliation summary. */
export type ChartIdentifier = (typeof chartIdentifiers)[number];

/** Lifecycle status of a mapping profile or one of its versions. */
export const mappingProfileStatuses = ['ACTIVE', 'DEPRECATED'] as const;
/** Union of valid mapping profile / version lifecycle statuses. */
export type MappingProfileStatus = (typeof mappingProfileStatuses)[number];

/**
 * Which source a validation rule applies to (H8, Issue #277, changeset 0074).
 *
 * Named here because it had no domain type: the values existed only as an inline union at
 * `core/fileValidation/types.ts:107` and as CHECK constraints on two tables, which is how the two
 * rule families drifted apart in the first place. BILLING covers the AP/AR document rules added by
 * changesets 0070/0071.
 */
export const validationSourceTypes = ['BANK', 'GL', 'BILLING'] as const;
/** Union of sources a validation rule may target. */
export type ValidationSourceType = (typeof validationSourceTypes)[number];

/**
 * The three subledger tabs a run may additionally carry, and the `import_file.source_type` each one
 * writes (Issue #463).
 *
 * Declared once, here, because the alternative is restating it at every seam -- the multer field
 * registration, the FormData builder, the run store -- and those drifting apart is exactly the
 * failure `source-system-two-vocabularies` records.
 *
 * **Why these values and not `AP`/`AR`.** Every one is already in changeset 0044's CHECK list, which
 * came from transaction-csv-spec.md v2 §0.5, so nothing here needs a migration. `AP` and `AR` were
 * deliberately not added: they would duplicate what `BILLING` (vendor bills) and `RECEIPT` (customer
 * receipts) already mean. The AP/AR distinction stays a *registry* concept -- changeset 0079 keys on
 * `kind` so one entity id may exist in both -- and does not need restating here, because BILLING and
 * RECEIPT already separate the two sides of the ledger.
 *
 * **A source type here is not a claim that rules exist for it.** `validationSourceTypes` above is
 * that claim, and it stays `BANK`/`GL`/`BILLING`: `RECEIPT` and `PAYROLL` transport and persist
 * correctly while validating against nothing until their rule content lands (AR deferred by the
 * product owner; payroll ships with #408). A screen must not present that silence as a passing
 * check.
 */
export const subledgerSourceTypeByTab = {
  ap: 'BILLING',
  ar: 'RECEIPT',
  payroll: 'PAYROLL',
} as const;

/** The subledger tab ids, as used by the import screen's `?source=` parameter. */
export type SubledgerTabId = keyof typeof subledgerSourceTypeByTab;

/** The `import_file.source_type` values a subledger upload can write. */
export type SubledgerSourceType = (typeof subledgerSourceTypeByTab)[SubledgerTabId];

/**
 * Multipart field name per subledger tab. Kept beside the source-type map so a new subledger cannot
 * be given a transport field without also being given the value it persists as.
 */
export const subledgerUploadFieldByTab = {
  ap: 'apFiles',
  ar: 'arFiles',
  payroll: 'payrollFiles',
} as const satisfies Record<SubledgerTabId, string>;

/** Upper bound per subledger, mirroring bank's 1-4. Zero is valid: subledgers are additive, and a
 * run carrying none of them is complete rather than degraded (product-owner ruling, #463). */
export const MAX_FILES_PER_SUBLEDGER = 4;

/**
 * Every `import_file.source_type` this build actually writes.
 *
 * Deliberately narrower than the column's CHECK constraint, which permits all fifteen values from
 * transaction-csv-spec.md v2 §0.5. The schema was widened ahead of the code (changeset 0044) so the
 * remaining source types need no migration when they arrive; this type is the subset that has a
 * transport path today. Widen it as those land, not before -- a value here is a claim that something
 * can produce it.
 */
export type ImportFileSourceType = 'BANK' | 'GL' | SubledgerSourceType;

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
/**
 * Severity of a validation rule / result (H8, Issue #277, changeset 0075).
 *
 * ERROR | WARNING | INFO -- the live File Validation engine's list plus INFO. The rival family
 * previously used FATAL|WARNING|INFO, disagreeing with the live one on two of three values. FATAL
 * was dropped as a synonym for ERROR rather than kept alongside it: two words for one severity is
 * how the divergence started. Choosing this direction left every existing severity valid, so none
 * of the 79 seeded rules was rewritten.
 *
 * INFO is the addition -- advisory checks that should not fail a run, which the accounting tier
 * needs and ERROR|WARNING could not express.
 */
export const validationSeverities = ['ERROR', 'WARNING', 'INFO'] as const;
/** Union of valid validation severities. */
export type ValidationSeverity = (typeof validationSeverities)[number];

/** Approval status of an uploaded import awaiting review before canonical promotion. */
export const importApprovalStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'OVERRIDDEN'] as const;
/** Union of valid import approval statuses. */
export type ImportApprovalStatus = (typeof importApprovalStatuses)[number];

/** The seven object types that flow through the unified Approvals surface (RailMenuMods design).
 * 'reconciliationRun' (File Imports & Validation, changeset 0042) is a third backing pattern,
 * neither the dedicated `reconciliation_import_approval` sidecar table 'import' uses nor the
 * generic polymorphic `reconciliation_approval_request` table the other five use -- the entity
 * already carries its own submitted_by/decided_by/decision_note columns and a DB-level
 * segregation-of-duty CHECK, so it's decided directly on reconciliation_run itself (see
 * PostgresImportValidationStore's recordRunApprovalDecision/claimRunApproval). It shares the
 * 'import' rail submenu (approvalGroupKeys below), not a submenu of its own -- both row types
 * render together on the same /approvals/imports page. */
export const approvableTypes = [
  'import',
  'reconciliationRun',
  'mappingProfile',
  'matchingRule',
  'varianceThreshold',
  'exceptionResolution',
  'reportDistribution',
  // #311: a payee alias proposed from a reviewer's confirmed probable match. Inserted inactive and
  // activated on approval; rides the 'matchingRule' rail submenu (it IS matching configuration),
  // so approvalGroupKeys below is deliberately unchanged -- same arrangement as varianceThreshold.
  'payeeAlias',
] as const;
/** Union of valid approvable types. */
export type ApprovableType = (typeof approvableTypes)[number];

/** The five Approvals rail submenus -- matchingRule and varianceThreshold share one submenu
 * ("Matching Rule & Variances"), since they're both fields on the same versioned object. */
export const approvalGroupKeys = [
  'import',
  'mappingProfile',
  'matchingRule',
  'exceptionResolution',
  'reportDistribution',
] as const;
/** Union of valid approval group keys. */
export type ApprovalGroupKey = (typeof approvalGroupKeys)[number];

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
 *  admin/superuser are not choosable there. See changeset 0034. `coo`/`ceo` were added by
 *  changeset 0075 as write-off approval authorities (Issue #283) and are likewise NOT
 *  self-serve-selectable -- an officer role is assigned, not claimed at signup. */
export const userRoles = [
  'financial-analyst',
  'senior-analyst',
  'staff-accountant',
  'controller',
  'vp-finance',
  'cfo',
  'coo',
  'ceo',
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
  canApprove: boolean;
  /** File Imports & Validation: who may submit a reconciliation_run (upload Bank/GL files and
   *  start a run). Restricted to senior-analyst per an explicit product decision ("file
   *  reconciliation should stay with the senior Financial analyst") plus the two platform-operator
   *  roles, which hold every other capability in this table unconditionally. Approver roles
   *  (controller/vp-finance/cfo) are deliberately excluded -- they sit on the other side of this
   *  workflow's segregation of duty (reconciliation_run_segregation_of_duty_check, changeset 0042). */
  canSubmitImportRuns: boolean;
  /** A-D1 (Issue #338): who may register, rename or deactivate a bank account. Bank accounts are
   *  master data -- a statement can only be assigned to one that already exists -- so this tracks
   *  `canSubmitImportRuns` exactly: whoever submits runs must be able to register the accounts
   *  those runs reconcile, and nobody on the approval side of the segregation-of-duty boundary
   *  gains a way to alter what a run is measured against. Reading the registry is deliberately not
   *  gated: every role with application access needs account labels to interpret a run. */
  canManageAccounts: boolean;
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
    canApprove: false,
    canSubmitImportRuns: false,
    canManageAccounts: false,
  },
  'senior-analyst': {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
    canApprove: false,
    canSubmitImportRuns: true,
    canManageAccounts: true,
  },
  'staff-accountant': {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
    canApprove: false,
    canSubmitImportRuns: false,
    canManageAccounts: false,
  },
  controller: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
    canApprove: true,
    canSubmitImportRuns: false,
    canManageAccounts: false,
  },
  'vp-finance': {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
    canApprove: true,
    canSubmitImportRuns: false,
    canManageAccounts: false,
  },
  cfo: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
    canApprove: true,
    canSubmitImportRuns: false,
    canManageAccounts: false,
  },
  coo: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
    canApprove: true,
    canSubmitImportRuns: false,
    canManageAccounts: false,
  },
  ceo: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
    canApprove: true,
    canSubmitImportRuns: false,
    canManageAccounts: false,
  },
  admin: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: true,
    canAccessRunBook: true,
    canApprove: true,
    canSubmitImportRuns: true,
    canManageAccounts: true,
  },
  superuser: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAdjustSliderDefaults: true,
    canAccessRunBook: true,
    canApprove: true,
    canSubmitImportRuns: true,
    canManageAccounts: true,
  },
};

/**
 * Write-off approval authority bands (Issue #283, B5).
 *
 * Deliberately a separate axis from `canApprove`, which governs the import/run approval workflow.
 * A write-off is not the same act as approving a run: it erases a reconciling item outright -- for
 * AP, a vendor liability -- so the authority required scales with the amount rather than being one
 * yes/no capability. Keeping the axes separate is what lets a financial-analyst clear small items
 * without also gaining run-approval rights, and what stops a controller approving an unbounded
 * write-off simply because they may approve runs.
 *
 * Two consequences worth being explicit about, because both change today's behaviour:
 *   - financial-analyst/senior-analyst/staff-accountant GAIN write-off up to the first threshold
 *     (`canApprove` is false for all three, so the route 403s them today).
 *   - controller/vp-finance are NARROWED: they may approve runs at any size but write off only up
 *     to the first threshold, where previously `canApprove` let them write off any amount.
 *
 * Ranks, not role lists, so a band comparison is a single integer test and adding a role is one
 * entry rather than an edit to every band.
 */
export const writeOffAuthorityRankByRole: Record<UserRole, number> = {
  'financial-analyst': 1,
  'senior-analyst': 1,
  'staff-accountant': 1,
  controller: 1,
  'vp-finance': 1,
  cfo: 2,
  coo: 3,
  ceo: 4,
  // Platform-operator roles, which hold every other capability in `rolePermissionsByRole`
  // unconditionally; giving them a lower rank here would be the only capability they lack.
  admin: 4,
  superuser: 4,
};

/**
 * Bands are keyed on the *absolute* amount. An open item's `amount` is signed -- a credit carries a
 * negative value -- and a -$50,000 write-off is exactly as material as a +$50,000 one, so comparing
 * the raw signed value would route every credit into the lowest band regardless of size.
 *
 * `maxAmount` is inclusive: exactly $20,000 needs rank 1, $20,000.01 needs rank 2. `null` is the
 * open-ended top band.
 */
export const writeOffApprovalBands: ReadonlyArray<{
  maxAmount: number | null;
  requiredRank: number;
  requiredRoleLabel: string;
}> = [
  { maxAmount: 20000, requiredRank: 1, requiredRoleLabel: 'Financial Analyst' },
  { maxAmount: 40000, requiredRank: 2, requiredRoleLabel: 'CFO' },
  { maxAmount: 75000, requiredRank: 3, requiredRoleLabel: 'COO' },
  { maxAmount: null, requiredRank: 4, requiredRoleLabel: 'CEO' },
];

/** The band governing `amount`. Never undefined -- the final band is open-ended. */
export const writeOffBandForAmount = (amount: number): (typeof writeOffApprovalBands)[number] => {
  const magnitude = Math.abs(amount);
  return (
    writeOffApprovalBands.find((band) => band.maxAmount !== null && magnitude <= band.maxAmount) ??
    writeOffApprovalBands[writeOffApprovalBands.length - 1]!
  );
};

/** Whether `role` carries enough authority to write off `amount`. */
export const canApproveWriteOff = (role: UserRole, amount: number): boolean =>
  writeOffAuthorityRankByRole[role] >= writeOffBandForAmount(amount).requiredRank;

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
