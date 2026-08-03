import type {
  BusinessField,
  ChartIdentifier,
  ErrorCategory,
  ImportApprovalStatus,
  MappingProfileStatus,
  MatchConfidence,
  MatchDisposition,
  ReconciliationRunStatus,
  SeverityLevel,
  SourceSystem,
  StagedTransactionStatus,
  TransformKind,
  ValidationRuleScope,
  ValidationSeverity,
} from './enums';

/** Metadata registered for a single uploaded spreadsheet (bank or GL). */
export interface SourceFile {
  id: string;
  source: SourceSystem;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  worksheetName: string;
  headerRow: number;
  transactionStartRow: number;
  excludedRowNumbers: number[];
  uploadedAt: string;
}

/**
 * A single row read directly from a source spreadsheet before any normalization.
 * `rawValues` preserves the original cell values keyed by column header; the
 * typed `*Raw` fields are extracted from those values during parsing.
 */
export interface RawTransactionRow {
  id: string;
  sourceFileId: string;
  source: SourceSystem;
  spreadsheetFileName: string;
  worksheetName: string;
  lineNumber: number;
  rawValues: Record<string, string | number | boolean | Date | null | undefined>;
  transactionDateRaw?: string;
  postingDateRaw?: string;
  transactionTypeRaw?: string;
  checkNumberRaw?: string;
  serialNumberRaw?: string;
  referenceNumberRaw?: string;
  descriptionRaw?: string;
  merchantNameRaw?: string;
  payeeNameRaw?: string;
  amountRaw?: string;
  splitAmountRaw?: string;
  debitRaw?: string;
  creditRaw?: string;
  runningBalanceRaw?: string;
  excluded: boolean;
  exclusionReason?: string;
  parsingIssues: string[];
}

/**
 * A transaction row after parsing, type coercion, and text normalization.
 * `normalizedComparisonTokens` and `normalizedReferenceTokens` are the pre-built
 * token sets used by the matching engine's similarity scoring.
 * `contextFingerprint` is a hash of the row's identifying fields and is used to
 * detect duplicates within the same source file.
 */
export interface NormalizedTransaction {
  id: string;
  runId: string;
  rawRowId: string;
  sourceFileId: string;
  source: SourceSystem;
  spreadsheetFileName: string;
  worksheetName: string;
  lineNumber: number;
  transactionDate?: string;
  postingDate?: string;
  transactionType?: string;
  checkNumber?: string;
  serialNumber?: string;
  referenceNumber?: string;
  description?: string;
  merchantName?: string;
  payeeName?: string;
  amount: number | null;
  splitAmount: number | null;
  debit: number | null;
  credit: number | null;
  runningBalance: number | null;
  normalizedComparisonText: string;
  normalizedComparisonTokens: string[];
  normalizedReferenceTokens: string[];
  rawSourceValues: RawTransactionRow['rawValues'];
  dataQualityIssues: string[];
  isExcluded: boolean;
  exclusionReason?: string;
  isZeroAmount: boolean;
  contextFingerprint: string;
  accountIdentifier?: string;
  reviewerNotes?: string;
}

/** Outcome of a single matching rule applied to one bank/GL transaction pair candidate. */
export interface RuleEvaluation {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  score: number;
  reason: string;
  evidence: string[];
  candidateTransactionId?: string;
}

/** A proposed bank/GL pair produced by the scoring phase, before the highest-scoring candidate is selected. */
export interface MatchCandidate {
  bankTransactionId: string;
  glTransactionId: string;
  confidence: MatchConfidence;
  exceptionCategory?: ErrorCategory;
  score: number;
  ruleName: string;
  dateDifferenceDays: number | null;
  amountDifference: number;
  textSimilarity: number;
  referenceSimilarity: number;
  evidence: string[];
  evaluations: RuleEvaluation[];
}

/**
 * The final outcome of the matching engine for one bank/GL transaction pair (or an unmatched
 * singleton). Pairwise results have both `bankTransactionId` and `glTransactionId` set;
 * unmatched results have only one side populated.
 */
export interface MatchResult {
  id: string;
  disposition: MatchDisposition;
  confidence: MatchConfidence;
  ruleId?: string;
  ruleName: string;
  reason?: string;
  score: number;
  bankTransactionId?: string;
  glTransactionId?: string;
  dateDifferenceDays: number | null;
  amountDifference: number;
  evidence: string[];
  likelyMatchingReference?: string;
  exceptionCategory?: ErrorCategory;
  reviewerNotes?: string;
}

/** Disposition assigned to a many-to-many grouped match result. */
export type GroupedMatchDisposition = 'GroupedExactMatch' | 'GroupedReviewMatch';

/** One transaction participant within a many-to-many grouped match, with display-level detail. */
export interface GroupedMatchMember {
  transactionId: string;
  source: SourceSystem;
  spreadsheetFileName: string;
  lineNumber: number;
  amount: number;
}

/**
 * A many-to-many match where multiple bank transactions together correspond to one or more GL
 * transactions (e.g. a single GL deposit that was split across several bank entries).
 * `bankMembers` and `glMembers` carry display-level detail for the workbook export.
 */
export interface GroupedMatchResult {
  id: string;
  disposition: GroupedMatchDisposition;
  confidence: MatchConfidence;
  category?:
    | 'DepositGroupingIssue'
    | 'LikelySplitCombineIssue'
    | 'FeeNettingMatch'
    | 'PartialPaymentMatch'
    | 'PayrollBatchMatch'
    | 'BankServiceChargeAmortization'
    | 'LoanPaymentSplit';
  bankTransactionIds: string[];
  glTransactionIds: string[];
  bankMembers: GroupedMatchMember[];
  glMembers: GroupedMatchMember[];
  totalAmount: number;
  dateDifferenceDays: number | null;
  score: number;
  ruleId: string;
  ruleName: string;
  reason: string;
  evidence: string[];
}

/** Minimal reference to a counterpart transaction stored in an exception trace for display. */
export interface CounterpartTrace {
  source?: SourceSystem;
  spreadsheetFileName?: string;
  lineNumber?: number;
  transactionId?: string;
  amount?: number | null;
  transactionDate?: string | null;
}

/** Diagnostic trace of the rule evaluation that produced a specific exception classification. */
export interface ExceptionRuleTrace {
  ruleId: string;
  ruleName: string;
  reason: string;
  evidence: string[];
  counterpart?: CounterpartTrace;
  counterparts?: CounterpartTrace[];
}

/**
 * A classified reconciliation exception — a transaction (or pair) that could not be
 * cleanly matched. `ruleTrace` is the winning rule; `priorRuleTraces` are rules that
 * were evaluated and rejected before the final classification was made.
 */
export interface ExceptionItem {
  id: string;
  runId: string;
  category: ErrorCategory;
  severity: SeverityLevel;
  source: SourceSystem;
  spreadsheetFileName: string;
  lineNumber: number;
  transactionDate?: string;
  amount: number | null;
  errorMessage: string;
  ruleTrace?: ExceptionRuleTrace;
  priorRuleTraces?: ExceptionRuleTrace[];
  recommendedNextActions: string[];
  likelyMatchingReference?: string;
  reviewerNotes?: string;
  matchConfidence?: MatchConfidence;
  normalizedComparisonTokens: string[];
  relatedTransactionIds: string[];
}

/** A single labelled value within a chart series. */
export interface ChartMetricDatum {
  label: string;
  value: number;
}

/** A named series of chart data points included in the reconciliation summary. */
export interface ChartSeries {
  id: ChartIdentifier;
  title: string;
  data: ChartMetricDatum[];
}

/**
 * Aggregate statistics computed after matching and exception classification.
 * `unresolvedExposure` is the net dollar amount of all unmatched items — the key
 * metric reviewers use to assess reconciliation completeness.
 */
export interface SummaryMetrics {
  totalRecordsReviewed: number;
  bankRecords: number;
  glRecords: number;
  exactMatches: number;
  probableMatches: number;
  unmatchedItems: number;
  duplicates: number;
  bankDuplicates: number;
  glDuplicates: number;
  dateVariances: number;
  timingDifferences: number;
  dataQualityIssues: number;
  amountMismatches: number;
  missingFromBank: number;
  missingFromGL: number;
  unmatchedBankNetAmount: number;
  unmatchedGlNetAmount: number;
  cleanMatchedAmount: number;
  unresolvedExposure: number;
  countsByCategory: Record<string, number>;
  amountByCategory: Record<string, number>;
  charts: ChartSeries[];
}

/** Generated reconciliation workbook including the binary XLSX buffer. */
export interface OutputWorkbook {
  fileName: string;
  generatedAt: string;
  tabNames: string[];
  binary: Uint8Array;
}

/** Workbook metadata without the binary payload, used in API list responses. */
export type OutputWorkbookManifest = Omit<OutputWorkbook, 'binary'>;

/** A system-generated or rule-triggered observation attached to a reconciliation run for reviewer attention. */
export interface ReviewerObservation {
  id: string;
  runId: string;
  category: 'System' | 'Review' | 'DataQuality' | 'Accounting';
  title: string;
  message: string;
  severity: SeverityLevel;
  createdAt: string;
  relatedTransactionIds: string[];
}

/** The kind of item a reviewer decision targets. */
export type ReviewerDecisionTargetType = 'ProbableMatch' | 'AmbiguousReview' | 'ExceptionItem';

/** The verdict a reviewer records for the targeted item. */
export type ReviewerDecisionOutcome =
  | 'ApprovedMatch'
  | 'RejectedMatch'
  | 'ConfirmedException'
  | 'ReclassifiedException'
  | 'DismissedException'
  | 'ResearchException';

/** A human reviewer's recorded decision for a probable match, ambiguous review item, or exception. */
export interface ReviewerDecision {
  id: string;
  runId: string;
  targetType: ReviewerDecisionTargetType;
  targetId: string;
  outcome: ReviewerDecisionOutcome;
  finalCategory?: ErrorCategory;
  notes?: string;
  reviewerId?: string;
  reviewerName?: string;
  createdAt: string;
  updatedAt: string;
}

/** Reporting period cadence used to interpret date-tolerance and stale-check thresholds. */
export type ReconciliationFrequency = 'Monthly' | 'Annual';

/** An immutable audit trail entry attached to a reconciliation run. */
export interface AuditEvent {
  timestamp: string;
  action: string;
  details: Record<string, string | number | boolean | null>;
}

/** Full in-memory reconciliation run object including all processing artifacts. */
export interface ReconciliationRun {
  id: string;
  correlationId: string;
  accountIdentifier?: string;
  periodLabel?: string;
  reconciliationFrequency?: ReconciliationFrequency;
  status: ReconciliationRunStatus;
  startedAt: string;
  completedAt?: string;
  sourceFiles: SourceFile[];
  rawRows: RawTransactionRow[];
  normalizedTransactions: NormalizedTransaction[];
  matchResults: MatchResult[];
  groupedMatchResults: GroupedMatchResult[];
  probableMatches: MatchResult[];
  exceptions: ExceptionItem[];
  summary: SummaryMetrics;
  reviewerObservations: ReviewerObservation[];
  reviewerDecisions: ReviewerDecision[];
  outputWorkbook?: OutputWorkbook;
  auditEvents: AuditEvent[];
  /** Variance threshold overrides applied to this run, keyed by rule metric id. */
  appliedVarianceOverrides?: Record<string, number>;
}

/** API-facing report view of a completed reconciliation run, omitting raw/normalized transaction arrays. */
export interface ReconciliationRunReport {
  id: string;
  correlationId: string;
  accountIdentifier?: string;
  periodLabel?: string;
  reconciliationFrequency?: ReconciliationFrequency;
  status: ReconciliationRunStatus;
  startedAt: string;
  completedAt?: string;
  sourceFiles: SourceFile[];
  groupedMatchResults: GroupedMatchResult[];
  probableMatches: MatchResult[];
  exceptions: ExceptionItem[];
  summary: SummaryMetrics;
  reviewerObservations: ReviewerObservation[];
  reviewerDecisions: ReviewerDecision[];
  outputWorkbook?: OutputWorkbookManifest;
  /** Variance threshold overrides applied to this run, keyed by rule metric id. */
  appliedVarianceOverrides?: Record<string, number>;
}

/** Maps each canonical business field to the list of accepted spreadsheet column header aliases. */
export type ColumnAliasMap = Record<BusinessField, string[]>;

/** Per-source (bank or GL) parsing and column-mapping configuration for a reconciliation run. */
export interface SourceReconciliationConfig {
  headerRow: number;
  transactionStartRow: number;
  excludedRows: number[];
  excludeBeginningBalance: boolean;
  beginningBalancePatterns: string[];
  amountSignConvention: 'signedAmount' | 'debitCreditColumns';
  allowZeroAmount: boolean;
  columnAliases: ColumnAliasMap;
}

/** Controls how raw description and merchant text is normalized before similarity scoring. */
export interface TextNormalizationConfig {
  uppercase: boolean;
  stripPunctuation: boolean;
  collapseWhitespace: boolean;
  removeStopWords: boolean;
  stopWords: string[];
}

/** Numeric thresholds and window sizes that control the matching engine's scoring and classification decisions. */
export interface MatchingConfig {
  amountTolerance: number;
  dateToleranceDays: number;
  timingDifferenceDays: number;
  staleOutstandingCheckDays: number;
  textSimilarityThreshold: number;
  probableTextSimilarityThreshold: number;
  referenceSimilarityThreshold: number;
  distinctiveAmountMaxOccurrences: number;
  groupedCandidatePoolSize: number;
  groupedMatchMaxSize: number;
  duplicateDateWindowDays: number;
  duplicateSimilarityThreshold: number;
  amountMismatchTextSimilarityThreshold: number;
  reversalWindowDays: number;
  depositInTransitDays: number;
  partialPaymentWindowDays: number;
  wireFeeTolerance: number;
}

/** Controls exception sort order and the severity level assigned to each exception category. */
export interface ReportingConfig {
  exceptionSortOrder: Array<'severity' | 'source' | 'transactionDate' | 'lineNumber'>;
  severityByCategory: Record<ErrorCategory, SeverityLevel>;
}

type SourceConfigOverride = Omit<Partial<SourceReconciliationConfig>, 'columnAliases'> & {
  columnAliases?: Partial<ColumnAliasMap>;
};

/** Per-account config overrides applied on top of the base config when the account identifier matches. */
export interface AccountOverrideConfig {
  accountIdentifier: string;
  bank?: SourceConfigOverride;
  gl?: SourceConfigOverride;
  matching?: Partial<MatchingConfig>;
  reporting?: {
    exceptionSortOrder?: ReportingConfig['exceptionSortOrder'];
    severityByCategory?: Partial<Record<ErrorCategory, SeverityLevel>>;
  };
}

/**
 * Top-level configuration for a reconciliation run.
 * `accountOverrides` can selectively override bank, GL, matching, or reporting
 * sub-config for a specific account identifier without changing the base config.
 */
export interface ReconciliationConfig {
  bank: SourceReconciliationConfig;
  gl: SourceReconciliationConfig;
  textNormalization: TextNormalizationConfig;
  matching: MatchingConfig;
  reporting: ReportingConfig;
  accountOverrides: AccountOverrideConfig[];
}

/** Everything needed to start a reconciliation run — passed directly to `runReconciliation`. */
export interface ReconciliationInput {
  runId: string;
  correlationId: string;
  sourceFiles: SourceFile[];
  rawRows: RawTransactionRow[];
  config: ReconciliationConfig;
  accountIdentifier?: string;
  periodLabel?: string;
  reconciliationFrequency?: ReconciliationFrequency;
}

/** Full output produced by `runReconciliation`; persisted to PostgreSQL by the lifecycle store. */
/**
 * A learned mapping from a bank description pattern to a canonical GL payee name.
 * Stored in the `reconciliation_payee_alias` table and loaded at runtime to boost matching for
 * bank entries whose raw text similarity to the GL payee would otherwise be low.
 */
export interface PayeeAlias {
  id: string;
  accountIdentifier?: string;
  bankPattern: string;
  canonicalPayeeName: string;
  normalizedTokens: string[];
  sourceDirection: 'bank_to_gl' | 'bidirectional';
  matchConfidence: number;
  isActive: boolean;
}

export interface ReconciliationOutput {
  normalizedTransactions: NormalizedTransaction[];
  matchResults: MatchResult[];
  groupedMatchResults: GroupedMatchResult[];
  probableMatches: MatchResult[];
  exceptions: ExceptionItem[];
  summary: SummaryMetrics;
  reviewerObservations: ReviewerObservation[];
  reviewerDecisions: ReviewerDecision[];
  outputWorkbook: OutputWorkbook;
  auditEvents: AuditEvent[];
}

/** An organization that owns imports, mapping profiles, and accounts. Stored in `reconciliation_organization`. */
export interface Organization {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

/** A named, reusable source-column-to-canonical-field mapping. Stored in `reconciliation_mapping_profile`. */
export interface MappingProfile {
  id: string;
  organizationId: string;
  name: string;
  sourceType: SourceSystem;
  status: MappingProfileStatus;
  createdAt: string;
}

/**
 * An immutable, numbered version of a mapping profile's column mapping and transformation
 * rules. Stored in `reconciliation_mapping_profile_version`; a new row is inserted for every
 * edit rather than mutating an existing version, so imports already processed with a given
 * version remain reproducible.
 */
export interface MappingProfileVersion {
  id: string;
  profileId: string;
  versionNumber: number;
  columnMapping: Record<string, string>;
  transformationRules: unknown[];
  status: MappingProfileStatus;
  createdBy: string;
  createdAt: string;
}

/** A canonical transaction field the mapping canvas can target, derived from `BusinessField`. */
export interface CanonicalField {
  id: BusinessField;
  type: 'text' | 'date' | 'numeric' | 'enum';
  required: boolean;
  note: string;
}

/** A single mapped source column, keyed to the canonical field it feeds. */
export interface MappingProfilePair {
  col: string;
  db: BusinessField;
  transform?: TransformKind;
}

/** Client-submitted payload for saving a combined GL + Bank mapping profile in one action. */
export interface MappingProfileSavePayload {
  name: string;
  gl: MappingProfilePair[];
  bank: MappingProfilePair[];
  createdBy: string;
}

/** Response returned after saving a mapping profile: the (possibly newly-created) profile row and new version on each side. */
export interface MappingProfileSaveResult {
  glProfile: MappingProfile;
  glVersion: MappingProfileVersion;
  bankProfile: MappingProfile;
  bankVersion: MappingProfileVersion;
}

/** A parsed, mapped transaction awaiting validation and approval before canonical promotion. Stored in `reconciliation_staged_transaction`. */
export interface StagedTransaction {
  id: string;
  rawRowId: string;
  sourceFileId: string;
  mappingProfileVersionId: string;
  status: StagedTransactionStatus;
  normalizedFields: Record<string, string | number | boolean | null>;
  validationSummary: Record<string, unknown>;
  controlTotalAmount?: string;
  createdAt: string;
}

/** A versioned, reproducible validation rule definition. Stored in `reconciliation_validation_rule_version`. */
export interface ValidationRuleVersion {
  id: string;
  ruleCode: string;
  versionNumber: number;
  scope: ValidationRuleScope;
  severity: ValidationSeverity;
  description: string;
  status: MappingProfileStatus;
  createdAt: string;
}

/** The outcome of evaluating one validation rule version against a staged transaction or whole file. Stored in `reconciliation_validation_result`. */
export interface ValidationResult {
  id: string;
  stagedTransactionId?: string;
  sourceFileId?: string;
  ruleVersionId: string;
  severity: ValidationSeverity;
  passed: boolean;
  message: string;
  createdAt: string;
}

/** The approve/reject gate an uploaded file must pass before its staged transactions are promoted to canonical. Stored in `reconciliation_import_approval`. */
export interface ImportApproval {
  id: string;
  sourceFileId: string;
  status: ImportApprovalStatus;
  uploadedBy: string;
  approvedBy?: string;
  rationale?: string;
  requestedAt: string;
  decidedAt?: string;
}

/** An append-only audit trail entry for one status transition of an `ImportApproval`. Stored in `reconciliation_approval_history`. */
export interface ApprovalHistoryEntry {
  id: string;
  approvalId: string;
  fromStatus?: ImportApprovalStatus;
  toStatus: ImportApprovalStatus;
  actor: string;
  note?: string;
  createdAt: string;
}

/** A versioned bank/GL upload template. Stored in `reconciliation_template_definition`. */
export interface TemplateDefinition {
  id: string;
  templateType: SourceSystem;
  version: number;
  headers: string[];
  instructions?: string;
  status: MappingProfileStatus;
  createdAt: string;
}
