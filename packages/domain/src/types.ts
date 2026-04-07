import type {
  ChartIdentifier,
  ErrorCategory,
  MatchConfidence,
  MatchDisposition,
  ReconciliationRunStatus,
  SeverityLevel,
  SourceSystem,
} from './enums';

export type BusinessField =
  | 'transactionDate'
  | 'postingDate'
  | 'transactionType'
  | 'checkNumber'
  | 'serialNumber'
  | 'referenceNumber'
  | 'description'
  | 'merchantName'
  | 'payeeName'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'runningBalance'
  | 'accountIdentifier';

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
  debitRaw?: string;
  creditRaw?: string;
  runningBalanceRaw?: string;
  excluded: boolean;
  exclusionReason?: string;
  parsingIssues: string[];
}

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

export interface RuleEvaluation {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  score: number;
  reason: string;
  evidence: string[];
  candidateTransactionId?: string;
}

export interface MatchCandidate {
  bankTransactionId: string;
  qboTransactionId: string;
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

export interface MatchResult {
  id: string;
  disposition: MatchDisposition;
  confidence: MatchConfidence;
  ruleId?: string;
  ruleName: string;
  reason?: string;
  score: number;
  bankTransactionId?: string;
  qboTransactionId?: string;
  dateDifferenceDays: number | null;
  amountDifference: number;
  evidence: string[];
  likelyMatchingReference?: string;
  exceptionCategory?: ErrorCategory;
  reviewerNotes?: string;
}

export type GroupedMatchDisposition = 'GroupedExactMatch' | 'GroupedReviewMatch';

export interface GroupedMatchMember {
  transactionId: string;
  source: SourceSystem;
  spreadsheetFileName: string;
  lineNumber: number;
  amount: number;
}

export interface GroupedMatchResult {
  id: string;
  disposition: GroupedMatchDisposition;
  confidence: MatchConfidence;
  category?: 'DepositGroupingIssue' | 'LikelySplitCombineIssue';
  bankTransactionIds: string[];
  qboTransactionIds: string[];
  bankMembers: GroupedMatchMember[];
  qboMembers: GroupedMatchMember[];
  totalAmount: number;
  dateDifferenceDays: number | null;
  score: number;
  ruleId: string;
  ruleName: string;
  reason: string;
  evidence: string[];
}

export interface CounterpartTrace {
  source?: SourceSystem;
  spreadsheetFileName?: string;
  lineNumber?: number;
  transactionId?: string;
}

export interface ExceptionRuleTrace {
  ruleId: string;
  ruleName: string;
  reason: string;
  evidence: string[];
  counterpart?: CounterpartTrace;
  counterparts?: CounterpartTrace[];
}

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

export interface ChartMetricDatum {
  label: string;
  value: number;
}

export interface ChartSeries {
  id: ChartIdentifier;
  title: string;
  data: ChartMetricDatum[];
}

export interface SummaryMetrics {
  totalRecordsReviewed: number;
  bankRecords: number;
  qboRecords: number;
  exactMatches: number;
  probableMatches: number;
  unmatchedItems: number;
  duplicates: number;
  bankDuplicates: number;
  qboDuplicates: number;
  dateVariances: number;
  timingDifferences: number;
  dataQualityIssues: number;
  amountMismatches: number;
  missingFromBank: number;
  missingFromQBO: number;
  unmatchedBankNetAmount: number;
  unmatchedQboNetAmount: number;
  cleanMatchedAmount: number;
  unresolvedExposure: number;
  countsByCategory: Record<string, number>;
  amountByCategory: Record<string, number>;
  charts: ChartSeries[];
}

export interface OutputWorkbook {
  fileName: string;
  generatedAt: string;
  tabNames: string[];
  binary: Uint8Array;
}

export type OutputWorkbookManifest = Omit<OutputWorkbook, 'binary'>;

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

export type ReviewerDecisionTargetType =
  | 'ProbableMatch'
  | 'AmbiguousReview'
  | 'ExceptionItem';

export type ReviewerDecisionOutcome =
  | 'ApprovedMatch'
  | 'RejectedMatch'
  | 'ConfirmedException'
  | 'ReclassifiedException';

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

export type ReconciliationFrequency = 'Monthly' | 'Annual';

export interface AuditEvent {
  timestamp: string;
  action: string;
  details: Record<string, string | number | boolean | null>;
}

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
}

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
}

export type ColumnAliasMap = Record<BusinessField, string[]>;

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

export interface TextNormalizationConfig {
  uppercase: boolean;
  stripPunctuation: boolean;
  collapseWhitespace: boolean;
  removeStopWords: boolean;
  stopWords: string[];
}

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
}

export interface ReportingConfig {
  exceptionSortOrder: Array<'severity' | 'source' | 'transactionDate' | 'lineNumber'>;
  severityByCategory: Record<ErrorCategory, SeverityLevel>;
}

type SourceConfigOverride = Omit<Partial<SourceReconciliationConfig>, 'columnAliases'> & {
  columnAliases?: Partial<ColumnAliasMap>;
};

export interface AccountOverrideConfig {
  accountIdentifier: string;
  bank?: SourceConfigOverride;
  qbo?: SourceConfigOverride;
  matching?: Partial<MatchingConfig>;
  reporting?: {
    exceptionSortOrder?: ReportingConfig['exceptionSortOrder'];
    severityByCategory?: Partial<Record<ErrorCategory, SeverityLevel>>;
  };
}

export interface ReconciliationConfig {
  bank: SourceReconciliationConfig;
  qbo: SourceReconciliationConfig;
  textNormalization: TextNormalizationConfig;
  matching: MatchingConfig;
  reporting: ReportingConfig;
  accountOverrides: AccountOverrideConfig[];
}

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
