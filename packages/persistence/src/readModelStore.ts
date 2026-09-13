import type {
  ApprovableType,
  ApprovalCounts,
  ApprovalHistoryEntry,
  ErrorCategory,
  ExceptionItem,
  ExceptionRuleTrace,
  GroupedMatchMember,
  GroupedMatchResult,
  ImportApproval,
  ImportApprovalStatus,
  LoginEvent,
  LoginEventType,
  MappingProfile,
  MappingProfileDetail,
  MappingProfileVersion,
  MatchingConfig,
  MatchingConfigVersion,
  MatchResult,
  OutputWorkbookManifest,
  NormalizedTransaction,
  PayeeAlias,
  ReplayEstimate,
  ReconciliationRunReport,
  ReviewerDecision,
  ReviewerObservation,
  SeverityLevel,
  SourceFile,
  SourceSystem,
  SummaryMetrics,
} from '@recon/domain';

import type { Pool, PoolClient } from 'pg';

import { runInTenantScope, runInTenantScopeAsUser } from './postgres';

type ReconciliationJobRow = {
  id: string;
  correlation_id: string;
  account_identifier: string | null;
  period_label: string | null;
  reconciliation_frequency: 'Monthly' | 'Annual' | null;
  current_state: string;
  started_at: string;
  completed_at: string | null;
};

type SourceFileRow = {
  id: string;
  source_system: SourceSystem;
  file_name: string;
  mime_type: string;
  size_bytes: string | number;
  worksheet_name: string | null;
  header_row: number | null;
  transaction_start_row: number | null;
  excluded_row_numbers: unknown;
  uploaded_at: string;
};

type GroupedMatchRow = {
  id: string;
  disposition: GroupedMatchResult['disposition'];
  confidence: GroupedMatchResult['confidence'];
  category: GroupedMatchResult['category'] | null;
  bank_transaction_ids: unknown;
  gl_transaction_ids: unknown;
  bank_members_json: unknown;
  gl_members_json: unknown;
  total_amount: string | number;
  date_difference_days: number | null;
  score: number;
  rule_id: string;
  rule_name: string;
  reason: string;
  evidence_json: unknown;
};

type MatchResultRow = {
  id: string;
  bank_transaction_id: string | null;
  gl_transaction_id: string | null;
  disposition: MatchResult['disposition'];
  confidence: MatchResult['confidence'];
  rule_id: string | null;
  rule_name: string;
  reason: string | null;
  score: number;
  amount_difference: string | number;
  date_difference_days: number | null;
  evidence_json: unknown;
  likely_matching_reference: string | null;
  exception_category: MatchResult['exceptionCategory'] | null;
  applied_amount_tolerance: string | number | null;
  matching_config_version_id: string | null;
};

type ExceptionRow = {
  id: string;
  category: ExceptionItem['category'];
  severity: ExceptionItem['severity'];
  source_system: SourceSystem;
  spreadsheet_file_name: string;
  line_number: number;
  transaction_date: string | null;
  amount: string | number | null;
  error_message: string;
  rule_trace_json: unknown;
  prior_rule_traces_json: unknown;
  recommended_next_actions: unknown;
  likely_matching_reference: string | null;
  reviewer_notes: string | null;
  match_confidence: ExceptionItem['matchConfidence'] | null;
  normalized_comparison_tokens: unknown;
  related_transaction_ids: unknown;
  age_in_days: number | null;
};

type ReviewerObservationRow = {
  id: string;
  category: ReviewerObservation['category'];
  title: string;
  message: string;
  severity: ReviewerObservation['severity'];
  related_transaction_ids: unknown;
  created_at: string;
};

type ReviewerDecisionRow = {
  id: string;
  target_type: ReviewerDecision['targetType'];
  target_id: string;
  outcome: ReviewerDecision['outcome'];
  final_category: ReviewerDecision['finalCategory'] | null;
  notes: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  created_at: string;
  updated_at: string;
};

type SummaryRow = {
  total_records_reviewed: number;
  bank_records: number;
  gl_records: number;
  exact_matches: number;
  probable_matches: number;
  unmatched_items: number;
  duplicates: number;
  bank_duplicates: number;
  gl_duplicates: number;
  date_variances: number;
  timing_differences: number;
  data_quality_issues: number;
  amount_mismatches: number;
  missing_from_bank: number;
  missing_from_gl: number;
  unmatched_bank_net_amount: string | number;
  unmatched_gl_net_amount: string | number;
  clean_matched_amount: string | number;
  unresolved_exposure: string | number;
  counts_by_category_json: unknown;
  amount_by_category_json: unknown;
  charts_json: unknown;
};

type ExportRow = {
  file_name: string;
  generated_at: string;
  tab_names_json: unknown;
};

/** Page of exception items with total count and pagination cursor for the exceptions list endpoint. */
export type PaginatedExceptionsResult = {
  items: ExceptionItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

/** Optional server-side filters applied to the paginated exceptions query. */
export type ExceptionPageFilters = {
  category?: ErrorCategory;
  severity?: SeverityLevel;
};

const asNumber = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'number' ? value : Number(value);
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
};

const asTraceArray = (value: unknown): ExceptionRuleTrace[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value as ExceptionRuleTrace[];
};

const asObject = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) {
    return fallback;
  }

  return value as T;
};

const mapSourceFile = (row: SourceFileRow): SourceFile => ({
  id: row.id,
  source: row.source_system,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  worksheetName: row.worksheet_name ?? 'Unknown',
  headerRow: row.header_row ?? 1,
  transactionStartRow: row.transaction_start_row ?? 1,
  excludedRowNumbers: asObject<number[]>(row.excluded_row_numbers, []),
  uploadedAt: row.uploaded_at,
});

const mapGroupedMembers = (value: unknown): GroupedMatchMember[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value as GroupedMatchMember[];
};

const mapGroupedMatch = (row: GroupedMatchRow): GroupedMatchResult => ({
  id: row.id,
  disposition: row.disposition,
  confidence: row.confidence,
  category: row.category ?? undefined,
  bankTransactionIds: asStringArray(row.bank_transaction_ids),
  glTransactionIds: asStringArray(row.gl_transaction_ids),
  bankMembers: mapGroupedMembers(row.bank_members_json),
  glMembers: mapGroupedMembers(row.gl_members_json),
  totalAmount: asNumber(row.total_amount) ?? 0,
  dateDifferenceDays: row.date_difference_days,
  score: row.score,
  ruleId: row.rule_id,
  ruleName: row.rule_name,
  reason: row.reason,
  evidence: asStringArray(row.evidence_json),
});

const mapMatchResult = (row: MatchResultRow): MatchResult => ({
  id: row.id,
  bankTransactionId: row.bank_transaction_id ?? undefined,
  glTransactionId: row.gl_transaction_id ?? undefined,
  disposition: row.disposition,
  confidence: row.confidence,
  ruleId: row.rule_id ?? undefined,
  ruleName: row.rule_name,
  reason: row.reason ?? undefined,
  score: row.score,
  amountDifference: asNumber(row.amount_difference) ?? 0,
  dateDifferenceDays: row.date_difference_days,
  evidence: asStringArray(row.evidence_json),
  likelyMatchingReference: row.likely_matching_reference ?? undefined,
  exceptionCategory: row.exception_category ?? undefined,
  // H7 (#276): NULL survives as null rather than falling back to a default. A row written before
  // changeset 0072 has no recorded tolerance, and substituting the current default here would
  // present a guess as the value the engine actually applied.
  appliedAmountTolerance: asNumber(row.applied_amount_tolerance),
  matchingConfigVersionId: row.matching_config_version_id ?? undefined,
});

const mapException = (runId: string, row: ExceptionRow): ExceptionItem => ({
  id: row.id,
  runId,
  category: row.category,
  severity: row.severity,
  source: row.source_system,
  spreadsheetFileName: row.spreadsheet_file_name,
  lineNumber: row.line_number,
  transactionDate: row.transaction_date ?? undefined,
  amount: asNumber(row.amount),
  errorMessage: row.error_message,
  ruleTrace: row.rule_trace_json ? (row.rule_trace_json as ExceptionRuleTrace) : undefined,
  priorRuleTraces: asTraceArray(row.prior_rule_traces_json),
  recommendedNextActions: asStringArray(row.recommended_next_actions),
  likelyMatchingReference: row.likely_matching_reference ?? undefined,
  reviewerNotes: row.reviewer_notes ?? undefined,
  matchConfidence: row.match_confidence ?? undefined,
  normalizedComparisonTokens: asStringArray(row.normalized_comparison_tokens),
  relatedTransactionIds: asStringArray(row.related_transaction_ids),
  ageInDays: row.age_in_days ?? undefined,
});

const mapReviewerObservation = (
  runId: string,
  row: ReviewerObservationRow,
): ReviewerObservation => ({
  id: row.id,
  runId,
  category: row.category,
  title: row.title,
  message: row.message,
  severity: row.severity,
  createdAt: row.created_at,
  relatedTransactionIds: asStringArray(row.related_transaction_ids),
});

const mapReviewerDecision = (runId: string, row: ReviewerDecisionRow): ReviewerDecision => ({
  id: row.id,
  runId,
  targetType: row.target_type,
  targetId: row.target_id,
  outcome: row.outcome,
  finalCategory: row.final_category ?? undefined,
  notes: row.notes ?? undefined,
  reviewerId: row.reviewer_id ?? undefined,
  reviewerName: row.reviewer_name ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapSummary = (row: SummaryRow): SummaryMetrics => ({
  totalRecordsReviewed: row.total_records_reviewed,
  bankRecords: row.bank_records,
  glRecords: row.gl_records,
  exactMatches: row.exact_matches,
  probableMatches: row.probable_matches,
  unmatchedItems: row.unmatched_items,
  duplicates: row.duplicates,
  bankDuplicates: row.bank_duplicates,
  glDuplicates: row.gl_duplicates,
  dateVariances: row.date_variances,
  timingDifferences: row.timing_differences,
  dataQualityIssues: row.data_quality_issues,
  amountMismatches: row.amount_mismatches,
  missingFromBank: row.missing_from_bank,
  missingFromGL: row.missing_from_gl,
  unmatchedBankNetAmount: asNumber(row.unmatched_bank_net_amount) ?? 0,
  unmatchedGlNetAmount: asNumber(row.unmatched_gl_net_amount) ?? 0,
  cleanMatchedAmount: asNumber(row.clean_matched_amount) ?? 0,
  unresolvedExposure: asNumber(row.unresolved_exposure) ?? 0,
  countsByCategory: asObject<Record<string, number>>(row.counts_by_category_json, {}),
  amountByCategory: asObject<Record<string, number>>(row.amount_by_category_json, {}),
  charts: asObject<SummaryMetrics['charts']>(row.charts_json, []),
  // Not persisted here -- `reconciliation_job_summary` has no roll-forward columns yet.
  // PR D's rollForward figures live only on the in-flight run (export workbook, HTTP response);
  // `reconciliation_period_rollforward` (PR B, unused until PR E's close operation writes it) is
  // the intended persisted source of truth, not a retrofit of this per-run summary row.
  rollForward: {
    openingCount: 0,
    openingAmount: 0,
    newCount: 0,
    newAmount: 0,
    clearedCount: 0,
    clearedAmount: 0,
    writtenOffCount: 0,
    writtenOffAmount: 0,
    closingCount: 0,
    closingAmount: 0,
  },
});

const mapOutputWorkbook = (row?: ExportRow): OutputWorkbookManifest | undefined => {
  if (!row) {
    return undefined;
  }

  return {
    fileName: row.file_name,
    generatedAt: row.generated_at,
    tabNames: asStringArray(row.tab_names_json),
  };
};

const mapRunStatus = (row: ReconciliationJobRow): ReconciliationRunReport['status'] => {
  if (row.current_state === 'FAILED') {
    return 'Failed';
  }

  if (row.completed_at) {
    return 'Completed';
  }

  return 'Running';
};

const fetchSummaryRow = async (
  client: PoolClient,
  runId: string,
): Promise<SummaryMetrics | undefined> => {
  const result = await client.query<SummaryRow>(
    `SELECT total_records_reviewed, bank_records, gl_records, exact_matches, probable_matches,
            unmatched_items, duplicates, bank_duplicates, gl_duplicates, date_variances,
            timing_differences, data_quality_issues, amount_mismatches, missing_from_bank,
            missing_from_gl, unmatched_bank_net_amount, unmatched_gl_net_amount,
            clean_matched_amount, unresolved_exposure, counts_by_category_json,
            amount_by_category_json, charts_json
       FROM reconciliation_job_summary
      WHERE job_id = $1`,
    [runId],
  );

  const row = result.rows[0];
  return row ? mapSummary(row) : undefined;
};

const fetchExceptions = async (client: PoolClient, runId: string): Promise<ExceptionItem[]> => {
  const result = await client.query<ExceptionRow>(
    `SELECT id, category, severity, source_system, spreadsheet_file_name, line_number,
            transaction_date, amount, error_message, rule_trace_json, prior_rule_traces_json,
            recommended_next_actions, likely_matching_reference, reviewer_notes,
            match_confidence, normalized_comparison_tokens, related_transaction_ids, age_in_days
       FROM reconciliation_exception
      WHERE job_id = $1
      ORDER BY line_number ASC, id ASC`,
    [runId],
  );

  return result.rows.map((row) => mapException(runId, row));
};

const fetchReviewerDecisions = async (
  client: PoolClient,
  runId: string,
): Promise<ReviewerDecision[]> => {
  const result = await client.query<ReviewerDecisionRow>(
    `SELECT id, target_type, target_id, outcome, final_category, notes, reviewer_id, reviewer_name, created_at, updated_at
       FROM reconciliation_review_decision
      WHERE job_id = $1
      ORDER BY created_at ASC, id ASC`,
    [runId],
  );

  return result.rows.map((row) => mapReviewerDecision(runId, row));
};

const fetchSourceFiles = async (client: PoolClient, runId: string): Promise<SourceFile[]> => {
  const result = await client.query<SourceFileRow>(
    `SELECT id, source_system, file_name, mime_type, size_bytes, worksheet_name,
            header_row, transaction_start_row, excluded_row_numbers, uploaded_at
       FROM reconciliation_source_file
      WHERE job_id = $1
      ORDER BY uploaded_at ASC, id ASC`,
    [runId],
  );

  return result.rows.map(mapSourceFile);
};

const fetchGroupedMatchResults = async (
  client: PoolClient,
  runId: string,
): Promise<GroupedMatchResult[]> => {
  const result = await client.query<GroupedMatchRow>(
    `SELECT id, disposition, confidence, category, bank_transaction_ids, gl_transaction_ids,
            bank_members_json, gl_members_json, total_amount, date_difference_days,
            score, rule_id, rule_name, reason, evidence_json
       FROM reconciliation_match_group
      WHERE job_id = $1
      ORDER BY created_at ASC, id ASC`,
    [runId],
  );

  return result.rows.map(mapGroupedMatch);
};

const fetchProbableMatches = async (client: PoolClient, runId: string): Promise<MatchResult[]> => {
  const result = await client.query<MatchResultRow>(
    `SELECT id, bank_transaction_id, gl_transaction_id, disposition, confidence, rule_id,
            rule_name, reason, score, amount_difference, date_difference_days,
            evidence_json, likely_matching_reference, exception_category,
            applied_amount_tolerance, matching_config_version_id
       FROM reconciliation_match_result
      WHERE job_id = $1
        AND result_bucket = 'PROBABLE'
      ORDER BY created_at ASC, id ASC`,
    [runId],
  );

  return result.rows.map(mapMatchResult);
};

const fetchReviewerObservations = async (
  client: PoolClient,
  runId: string,
): Promise<ReviewerObservation[]> => {
  const result = await client.query<ReviewerObservationRow>(
    `SELECT id, category, title, message, severity, related_transaction_ids, created_at
       FROM reconciliation_review_observation
      WHERE job_id = $1
      ORDER BY created_at ASC, id ASC`,
    [runId],
  );

  return result.rows.map((row) => mapReviewerObservation(runId, row));
};

const fetchOutputWorkbook = async (
  client: PoolClient,
  runId: string,
): Promise<OutputWorkbookManifest | undefined> => {
  const result = await client.query<ExportRow>(
    `SELECT file_name, generated_at, tab_names_json
       FROM reconciliation_export
      WHERE job_id = $1
        AND export_type = 'workbook'
      LIMIT 1`,
    [runId],
  );

  return mapOutputWorkbook(result.rows[0]);
};

/** Loads the full report for `runId` using an already tenant-scoped client (GUC already set by
 * the caller's `runInTenantScope`). Shared by `findRunReportById` and `findLatestRunReport` so
 * the latter doesn't open a second, nested transaction to load the run it just found. */
const loadFullReportWithClient = async (
  client: PoolClient,
  runId: string,
): Promise<ReconciliationRunReport | undefined> => {
  const jobResult = await client.query<ReconciliationJobRow>(
    `SELECT id, correlation_id, account_identifier, period_label, reconciliation_frequency, current_state, started_at, completed_at
       FROM reconciliation_job
      WHERE id = $1`,
    [runId],
  );

  const job = jobResult.rows[0];
  if (!job) {
    return undefined;
  }

  // Sequential, not Promise.all: these all run over the same tenant-scoped client, and a single
  // pg Client/PoolClient can't have more than one query in flight at once -- issuing several
  // concurrently on one connection is deprecated in node-postgres and becomes a hard error in
  // pg@9. Promise.all was safe when these used this.pool.query() (the pool round-robins across
  // distinct connections); on a shared client it's not.
  const sourceFiles = await fetchSourceFiles(client, runId);
  const groupedMatchResults = await fetchGroupedMatchResults(client, runId);
  const probableMatches = await fetchProbableMatches(client, runId);
  const exceptions = await fetchExceptions(client, runId);
  const summary = await fetchSummaryRow(client, runId);
  const reviewerObservations = await fetchReviewerObservations(client, runId);
  const reviewerDecisions = await fetchReviewerDecisions(client, runId);
  const outputWorkbook = await fetchOutputWorkbook(client, runId);

  return {
    id: job.id,
    correlationId: job.correlation_id,
    accountIdentifier: job.account_identifier ?? undefined,
    periodLabel: job.period_label ?? undefined,
    reconciliationFrequency: job.reconciliation_frequency ?? undefined,
    status: mapRunStatus(job),
    startedAt: job.started_at,
    completedAt: job.completed_at ?? undefined,
    sourceFiles,
    groupedMatchResults,
    probableMatches,
    exceptions,
    summary: summary ?? {
      totalRecordsReviewed: 0,
      bankRecords: 0,
      glRecords: 0,
      exactMatches: 0,
      probableMatches: 0,
      unmatchedItems: 0,
      duplicates: 0,
      bankDuplicates: 0,
      glDuplicates: 0,
      dateVariances: 0,
      timingDifferences: 0,
      dataQualityIssues: 0,
      amountMismatches: 0,
      missingFromBank: 0,
      missingFromGL: 0,
      unmatchedBankNetAmount: 0,
      unmatchedGlNetAmount: 0,
      cleanMatchedAmount: 0,
      unresolvedExposure: 0,
      countsByCategory: {},
      amountByCategory: {},
      charts: [],
      rollForward: {
        openingCount: 0,
        openingAmount: 0,
        newCount: 0,
        newAmount: 0,
        clearedCount: 0,
        clearedAmount: 0,
        writtenOffCount: 0,
        writtenOffAmount: 0,
        closingCount: 0,
        closingAmount: 0,
      },
    },
    reviewerObservations,
    reviewerDecisions,
    outputWorkbook,
  };
};

/**
 * PostgreSQL-backed read-model store for reconciliation runs, exceptions, exports, and
 * reviewer decisions. Used by the API to serve report and dashboard queries.
 *
 * ADR-0001 step 6: every method takes `organizationId` and runs through `runInTenantScope`,
 * which sets `app.current_organization_id` for the transaction before issuing any query -- RLS
 * policies (changeset 0030) key off that GUC, so a runId belonging to a different tenant than
 * `organizationId` resolves as "not found" rather than leaking another customer's data.
 */
export class PostgresReconciliationReadModelStore {
  /**
   * Creates a read-model store backed by a PostgreSQL connection pool.
   */
  constructor(private readonly pool: Pool) {}

  /**
   * Returns the most recently completed reconciliation run report.
   */
  async findLatestRunReport(organizationId: string): Promise<ReconciliationRunReport | undefined> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id
           FROM reconciliation_job
          WHERE completed_at IS NOT NULL
          ORDER BY completed_at DESC, created_at DESC
          LIMIT 1`,
      );

      const runId = result.rows[0]?.id;
      if (!runId) {
        return undefined;
      }

      return loadFullReportWithClient(client, runId);
    });
  }

  /**
   * Loads a full reconciliation report, including files, matches, exceptions, and summary.
   */
  async findRunReportById(
    organizationId: string,
    runId: string,
  ): Promise<ReconciliationRunReport | undefined> {
    return runInTenantScope(this.pool, organizationId, (client) =>
      loadFullReportWithClient(client, runId),
    );
  }

  /**
   * Loads summary metrics for a specific reconciliation run.
   */
  async findRunSummaryById(
    organizationId: string,
    runId: string,
  ): Promise<SummaryMetrics | undefined> {
    return runInTenantScope(this.pool, organizationId, (client) => fetchSummaryRow(client, runId));
  }

  /**
   * Lists all exceptions captured for the given run in deterministic line/id order.
   */
  async listRunExceptions(organizationId: string, runId: string): Promise<ExceptionItem[]> {
    return runInTenantScope(this.pool, organizationId, (client) => fetchExceptions(client, runId));
  }

  /**
   * Lists a paginated slice of exceptions and total count metadata.
   * Optional category/severity filters narrow both the page and the total count.
   */
  async listRunExceptionsPage(
    organizationId: string,
    runId: string,
    limit: number,
    offset: number,
    filters: ExceptionPageFilters = {},
  ): Promise<PaginatedExceptionsResult> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const conditions = ['job_id = $1'];
      const filterParams: unknown[] = [runId];

      if (filters.category) {
        filterParams.push(filters.category);
        conditions.push(`category = $${filterParams.length}`);
      }

      if (filters.severity) {
        filterParams.push(filters.severity);
        conditions.push(`severity = $${filterParams.length}`);
      }

      const whereClause = conditions.join(' AND ');

      // Sequential, not Promise.all -- see loadFullReportWithClient's comment: one client can't
      // have two queries in flight at once.
      const itemsResult = await client.query<ExceptionRow>(
        `SELECT id, category, severity, source_system, spreadsheet_file_name, line_number,
                transaction_date, amount, error_message, rule_trace_json, prior_rule_traces_json,
                recommended_next_actions, likely_matching_reference, reviewer_notes,
                match_confidence, normalized_comparison_tokens, related_transaction_ids, age_in_days
           FROM reconciliation_exception
          WHERE ${whereClause}
          ORDER BY line_number ASC, id ASC
          LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
        [...filterParams, limit, offset],
      );
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM reconciliation_exception WHERE ${whereClause}`,
        filterParams,
      );

      const total = Number(countResult.rows[0]?.count ?? '0');
      const items = itemsResult.rows.map((row) => mapException(runId, row));

      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      };
    });
  }

  /**
   * Lists reviewer decisions for the given run ordered by creation time.
   */
  async listReviewerDecisions(organizationId: string, runId: string): Promise<ReviewerDecision[]> {
    return runInTenantScope(this.pool, organizationId, (client) =>
      fetchReviewerDecisions(client, runId),
    );
  }
}

type PayeeAliasRow = {
  id: string;
  account_identifier: string | null;
  bank_pattern: string;
  canonical_payee_name: string;
  normalized_tokens: string[] | null;
  source_direction: 'bank_to_gl' | 'bidirectional';
  match_confidence: number;
  is_active: boolean;
};

const mapPayeeAlias = (row: PayeeAliasRow): PayeeAlias => ({
  id: row.id,
  accountIdentifier: row.account_identifier ?? undefined,
  bankPattern: row.bank_pattern,
  canonicalPayeeName: row.canonical_payee_name,
  normalizedTokens: row.normalized_tokens ?? [],
  sourceDirection: row.source_direction,
  matchConfidence: row.match_confidence,
  isActive: row.is_active,
});

/** Input fields accepted when creating a new payee alias. */
export interface CreatePayeeAliasInput {
  /** ADR-0001: payee aliases have no job/profile to derive tenancy from, so the caller (the API
   * route, from the authenticated principal) must supply it directly. */
  organizationId: string;
  accountIdentifier?: string;
  bankPattern: string;
  canonicalPayeeName: string;
  normalizedTokens: string[];
  sourceDirection?: 'bank_to_gl' | 'bidirectional';
  matchConfidence?: number;
}

/** Fields that may be patched on an existing payee alias. */
export type UpdatePayeeAliasInput = Partial<
  Pick<
    CreatePayeeAliasInput,
    | 'bankPattern'
    | 'canonicalPayeeName'
    | 'normalizedTokens'
    | 'sourceDirection'
    | 'matchConfidence'
  >
>;

/** Creates a new active payee alias and returns the persisted record. */
export const createPayeeAlias = async (
  pool: Pool,
  input: CreatePayeeAliasInput,
): Promise<PayeeAlias> => {
  return runInTenantScope(pool, input.organizationId, async (client) => {
    const result = await client.query<PayeeAliasRow>(
      `INSERT INTO reconciliation_payee_alias
         (organization_id, account_identifier, bank_pattern, canonical_payee_name, normalized_tokens, source_direction, match_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, account_identifier, bank_pattern, canonical_payee_name, normalized_tokens, source_direction, match_confidence, is_active`,
      [
        input.organizationId,
        input.accountIdentifier ?? null,
        input.bankPattern,
        input.canonicalPayeeName,
        input.normalizedTokens,
        input.sourceDirection ?? 'bank_to_gl',
        input.matchConfidence ?? 1,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('createPayeeAlias: INSERT returned no row');
    }
    return mapPayeeAlias(row);
  });
};

/**
 * Updates writable fields on an existing payee alias. Returns the updated record, or
 * `undefined` when no alias with the given id was found.
 */
export const updatePayeeAlias = async (
  pool: Pool,
  organizationId: string,
  id: string,
  input: UpdatePayeeAliasInput,
): Promise<PayeeAlias | undefined> => {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.bankPattern !== undefined) {
    setClauses.push(`bank_pattern = $${paramIndex++}`);
    values.push(input.bankPattern);
  }
  if (input.canonicalPayeeName !== undefined) {
    setClauses.push(`canonical_payee_name = $${paramIndex++}`);
    values.push(input.canonicalPayeeName);
  }
  if (input.normalizedTokens !== undefined) {
    setClauses.push(`normalized_tokens = $${paramIndex++}`);
    values.push(input.normalizedTokens);
  }
  if (input.sourceDirection !== undefined) {
    setClauses.push(`source_direction = $${paramIndex++}`);
    values.push(input.sourceDirection);
  }
  if (input.matchConfidence !== undefined) {
    setClauses.push(`match_confidence = $${paramIndex++}`);
    values.push(input.matchConfidence);
  }

  if (setClauses.length === 0) {
    return undefined;
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(id);

  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<PayeeAliasRow>(
      `UPDATE reconciliation_payee_alias
          SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
    RETURNING id, account_identifier, bank_pattern, canonical_payee_name, normalized_tokens, source_direction, match_confidence, is_active`,
      values,
    );
    return result.rows[0] ? mapPayeeAlias(result.rows[0]) : undefined;
  });
};

/**
 * Soft-deletes an alias by setting `is_active = false`. Returns `true` when the alias
 * was found and deactivated, `false` when no row matched.
 */
export const deactivatePayeeAlias = async (
  pool: Pool,
  organizationId: string,
  id: string,
): Promise<boolean> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query(
      `UPDATE reconciliation_payee_alias SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  });
};

/**
 * Loads active payee aliases from the database, optionally scoped to an account identifier.
 * Global aliases (no `account_identifier`) are always included alongside account-specific ones.
 */
export const loadPayeeAliases = async (
  pool: Pool,
  organizationId: string,
  accountIdentifier?: string,
): Promise<PayeeAlias[]> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<PayeeAliasRow>(
      `SELECT id, account_identifier, bank_pattern, canonical_payee_name,
              normalized_tokens, source_direction, match_confidence, is_active
         FROM reconciliation_payee_alias
        WHERE is_active = TRUE
          AND (account_identifier IS NULL OR account_identifier = $1)
        ORDER BY account_identifier NULLS LAST, canonical_payee_name ASC`,
      [accountIdentifier ?? null],
    );

    return result.rows.map(mapPayeeAlias);
  });
};

/** Input fields accepted when creating a new, immutable mapping profile version. */
export interface CreateMappingProfileVersionInput {
  id: string;
  profileId: string;
  versionNumber: number;
  columnMapping: Record<string, string>;
  transformationRules: unknown[];
  createdBy: string;
}

type MappingProfileVersionRow = {
  id: string;
  profile_id: string;
  version_number: number;
  column_mapping: Record<string, string>;
  transformation_rules: unknown[];
  status: 'ACTIVE' | 'DEPRECATED';
  created_by: string;
  created_at: string;
};

const mapMappingProfileVersion = (row: MappingProfileVersionRow): MappingProfileVersion => ({
  id: row.id,
  profileId: row.profile_id,
  versionNumber: row.version_number,
  columnMapping: row.column_mapping,
  transformationRules: row.transformation_rules,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

/**
 * Inserts a new mapping profile version. Versions are append-only by convention — there is no
 * `updatePayeeAlias`-style update function here — and the `UNIQUE (profile_id, version_number)`
 * constraint on `reconciliation_mapping_profile_version` rejects any attempt to reuse a version
 * number, which is what actually enforces immutability once a version has been referenced by an
 * import.
 */
export const createMappingProfileVersion = async (
  pool: Pool,
  organizationId: string,
  input: CreateMappingProfileVersionInput,
): Promise<MappingProfileVersion> => {
  // organization_id is derived from the parent profile via subquery rather than added to
  // CreateMappingProfileVersionInput -- every version already belongs to exactly one profile, so
  // there is no independent value a caller could legitimately supply here. `organizationId` is
  // taken as a separate parameter purely to set the RLS tenant GUC before this runs; if it
  // doesn't match the profile's actual organization, RLS hides the profile row from the SELECT
  // subquery and the INSERT affects zero rows.
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<MappingProfileVersionRow>(
      `INSERT INTO reconciliation_mapping_profile_version
         (id, profile_id, organization_id, version_number, column_mapping, transformation_rules, created_by)
       SELECT $1, $2, mp.organization_id, $3, $4::jsonb, $5::jsonb, $6
         FROM reconciliation_mapping_profile mp
        WHERE mp.id = $2
       RETURNING id, profile_id, version_number, column_mapping, transformation_rules, status, created_by, created_at`,
      [
        input.id,
        input.profileId,
        input.versionNumber,
        JSON.stringify(input.columnMapping),
        JSON.stringify(input.transformationRules),
        input.createdBy,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('createMappingProfileVersion: INSERT returned no row');
    }
    return mapMappingProfileVersion(row);
  });
};

/** All immutable versions of a mapping profile, newest first — used to compute the next version number. */
export const listMappingProfileVersions = async (
  pool: Pool,
  organizationId: string,
  profileId: string,
): Promise<MappingProfileVersion[]> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<MappingProfileVersionRow>(
      `SELECT id, profile_id, version_number, column_mapping, transformation_rules, status, created_by, created_at
       FROM reconciliation_mapping_profile_version
       WHERE profile_id = $1
       ORDER BY version_number DESC`,
      [profileId],
    );
    return result.rows.map(mapMappingProfileVersion);
  });
};

type MappingProfileRow = {
  id: string;
  organization_id: string;
  name: string;
  source_type: SourceSystem;
  status: 'ACTIVE' | 'DEPRECATED';
  created_at: string;
};

const mapMappingProfile = (row: MappingProfileRow): MappingProfile => ({
  id: row.id,
  organizationId: row.organization_id,
  name: row.name,
  sourceType: row.source_type,
  status: row.status,
  createdAt: row.created_at,
});

/** The mapping profile row for one side (`source_type`) of a named profile, or `null` if it hasn't been saved yet. */
export const findMappingProfile = async (
  pool: Pool,
  organizationId: string,
  name: string,
  sourceType: SourceSystem,
): Promise<MappingProfile | null> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<MappingProfileRow>(
      `SELECT id, organization_id, name, source_type, status, created_at
       FROM reconciliation_mapping_profile
       WHERE organization_id = $1 AND name = $2 AND source_type = $3`,
      [organizationId, name, sourceType],
    );
    const row = result.rows[0];
    return row ? mapMappingProfile(row) : null;
  });
};

/** Input fields accepted when creating a new mapping profile (one row per side — see `findMappingProfile`). */
export interface CreateMappingProfileInput {
  id: string;
  organizationId: string;
  name: string;
  sourceType: SourceSystem;
}

export const createMappingProfile = async (
  pool: Pool,
  input: CreateMappingProfileInput,
): Promise<MappingProfile> => {
  return runInTenantScope(pool, input.organizationId, async (client) => {
    const result = await client.query<MappingProfileRow>(
      `INSERT INTO reconciliation_mapping_profile (id, organization_id, name, source_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, organization_id, name, source_type, status, created_at`,
      [input.id, input.organizationId, input.name, input.sourceType],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('createMappingProfile: INSERT returned no row');
    }
    return mapMappingProfile(row);
  });
};

/**
 * Distinct ACTIVE mapping profile names for an organization. Saving one named profile creates
 * two rows (one per `source_type`, see `createMappingProfile`) -- `DISTINCT name` collapses that
 * gl/bank pairing back into the single named entity a user thinks of as "the profile."
 */
export const listMappingProfiles = async (
  pool: Pool,
  organizationId: string,
): Promise<string[]> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<{ name: string }>(
      `SELECT DISTINCT name
         FROM reconciliation_mapping_profile
        WHERE organization_id = $1 AND status = 'ACTIVE'
        ORDER BY name`,
      [organizationId],
    );
    return result.rows.map((row) => row.name);
  });
};

/** Shared by `getMappingProfileDetail` and `retireMappingProfile` -- fetches a profile's full
 * version history over an already-open, already-tenant-scoped client (never opens its own
 * transaction, so it composes safely inside either caller's `runInTenantScope*`). */
const fetchMappingProfileVersionsWithClient = async (
  client: PoolClient,
  profileId: string,
): Promise<MappingProfileVersion[]> => {
  const result = await client.query<MappingProfileVersionRow>(
    `SELECT id, profile_id, version_number, column_mapping, transformation_rules, status, created_by, created_at
       FROM reconciliation_mapping_profile_version
      WHERE profile_id = $1
      ORDER BY version_number DESC`,
    [profileId],
  );
  return result.rows.map(mapMappingProfileVersion);
};

/**
 * Full detail for a named mapping profile -- both sides (gl/bank), each with its complete
 * version history. `null` if neither side exists (either because it was never saved, or because
 * RLS hides it for a caller in the wrong organization -- the two are indistinguishable by
 * design, same as every other route in this API).
 *
 * `readAs` is the requesting user, threaded through to `runInTenantScopeAsUser` so a DB-level
 * audit trail (pgaudit, or any future per-user RLS policy) can attribute this read to a real
 * person, not just the pooled `app_user` role (ISSUE-050.2). The caller (the API route handler)
 * is still responsible for the actual read/access log event this issue asks for -- that's an
 * application-level concern, not a persistence-layer one.
 */
export const getMappingProfileDetail = async (
  pool: Pool,
  organizationId: string,
  name: string,
  readAs: string,
): Promise<MappingProfileDetail | null> => {
  return runInTenantScopeAsUser(pool, organizationId, readAs, async (client) => {
    const result = await client.query<MappingProfileRow>(
      `SELECT id, organization_id, name, source_type, status, created_at
         FROM reconciliation_mapping_profile
        WHERE organization_id = $1 AND name = $2`,
      [organizationId, name],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const bySide = new Map(result.rows.map((row) => [row.source_type, mapMappingProfile(row)]));
    const glProfile = bySide.get('gl');
    const bankProfile = bySide.get('bank');

    const [glVersions, bankVersions] = await Promise.all([
      glProfile ? fetchMappingProfileVersionsWithClient(client, glProfile.id) : Promise.resolve([]),
      bankProfile
        ? fetchMappingProfileVersionsWithClient(client, bankProfile.id)
        : Promise.resolve([]),
    ]);

    return {
      name,
      gl: glProfile ? { profile: glProfile, versions: glVersions } : null,
      bank: bankProfile ? { profile: bankProfile, versions: bankVersions } : null,
    };
  });
};

/**
 * Retires a named mapping profile: flips both sides (gl/bank, whichever exist) from ACTIVE to
 * DEPRECATED. Returns the rows actually updated -- empty if the name doesn't exist or was
 * already fully retired, which the route handler treats as 404 rather than a silent no-op.
 *
 * `retiredBy` is server-derived from `request.auth!.username` at the call site (never
 * client-supplied -- same reasoning as `createdBy` on create, ISSUE-008), and is threaded
 * through `runInTenantScopeAsUser` for the same DB-level attribution reasoning as
 * `getMappingProfileDetail` above.
 */
export const retireMappingProfile = async (
  pool: Pool,
  organizationId: string,
  name: string,
  retiredBy: string,
): Promise<MappingProfile[]> => {
  return runInTenantScopeAsUser(pool, organizationId, retiredBy, async (client) => {
    const result = await client.query<MappingProfileRow>(
      `UPDATE reconciliation_mapping_profile
          SET status = 'DEPRECATED'
        WHERE organization_id = $1 AND name = $2 AND status = 'ACTIVE'
      RETURNING id, organization_id, name, source_type, status, created_at`,
      [organizationId, name],
    );
    return result.rows.map(mapMappingProfile);
  });
};

type MatchingConfigVersionRow = {
  id: string;
  organization_id: string;
  version_number: number;
  status: MatchingConfigVersion['status'];
  variance_overrides: Partial<Record<keyof MatchingConfig, number>>;
  created_by: string;
  created_at: string;
  published_by: string | null;
  published_at: string | null;
  effective_at: string | null;
  pending_approval_owner: string | null;
  draft_reason: string | null;
  rejection_note: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
};

/**
 * A closed period an approver may replay a draft rule version against (ADR-0018, #532).
 *
 * `matchingJobId` is carried deliberately rather than derived by the caller: canonical rows key on
 * the matching job while the period an approver picks is a run, and conflating the two returns zero
 * rows -- indistinguishable from a period whose rows were never retained.
 */
export interface ReplayablePeriod {
  runId: string;
  matchingJobId: string;
  label: string;
  accountIdentifier: string | null;
  frequency: string;
  periodYear: number;
  periodMonth: number | null;
  closedAt: string | null;
}

const REPLAYABLE_PERIOD_SELECT = `
  SELECT r.id, r.matching_job_id, r.label, r.account_identifier, r.frequency,
         r.period_year, r.period_month, r.closed_at
    FROM reconciliation_run r
   WHERE r.organization_id = $1
     AND r.status = 'CLOSED'
     AND r.matching_job_id IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM reconciliation_canonical_row c
            WHERE c.organization_id = r.organization_id AND c.job_id = r.matching_job_id
         )`;

interface ReplayablePeriodRow {
  id: string;
  matching_job_id: string;
  label: string;
  account_identifier: string | null;
  frequency: string;
  period_year: number;
  period_month: number | null;
  closed_at: string | null;
}

const mapReplayablePeriod = (row: ReplayablePeriodRow): ReplayablePeriod => ({
  runId: row.id,
  matchingJobId: row.matching_job_id,
  label: row.label,
  accountIdentifier: row.account_identifier,
  frequency: row.frequency,
  periodYear: row.period_year,
  periodMonth: row.period_month,
  closedAt: row.closed_at,
});

/**
 * The closed periods this organization can replay against, newest close first.
 *
 * Only periods that can ACTUALLY be replayed are listed: the EXISTS clause requires retained
 * canonical rows, so an approver is never offered a period that would then fail. A period whose
 * rows have aged out is absent from the list rather than present and broken.
 */
export const listReplayablePeriods = async (
  pool: Pool,
  organizationId: string,
): Promise<ReplayablePeriod[]> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<ReplayablePeriodRow>(
      `${REPLAYABLE_PERIOD_SELECT} ORDER BY r.closed_at DESC NULLS LAST, r.id`,
      [organizationId],
    );
    return result.rows.map(mapReplayablePeriod);
  });
};

/** One replayable period by its run id, or null when it is not closed, not linked to a matching
 * job, or has no retained rows -- the three ways a period can exist and still not be replayable. */
export const getReplayablePeriod = async (
  pool: Pool,
  organizationId: string,
  runId: string,
): Promise<ReplayablePeriod | null> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<ReplayablePeriodRow>(
      `${REPLAYABLE_PERIOD_SELECT} AND r.id = $2`,
      [organizationId, runId],
    );
    const row = result.rows[0];
    return row ? mapReplayablePeriod(row) : null;
  });
};

/** One `reconciliation_canonical_row`, as node-postgres returns it. */
interface CanonicalRowRecord {
  id: string;
  raw_row_id: string;
  source_file_id: string;
  source_system: string;
  spreadsheet_file_name: string;
  worksheet_name: string;
  line_number: number;
  transaction_date: string | null;
  posting_date: string | null;
  transaction_type: string | null;
  check_number: string | null;
  serial_number: string | null;
  reference_number: string | null;
  description: string | null;
  merchant_name: string | null;
  payee_name: string | null;
  /** NUMERIC columns arrive as strings; Number() is applied at the mapping boundary. */
  amount: string | number | null;
  debit: string | number | null;
  credit: string | number | null;
  running_balance: string | number | null;
  normalized_comparison_text: string | null;
  normalized_comparison_tokens: string[] | null;
  normalized_reference_tokens: string[] | null;
  raw_source_values_json: unknown;
  data_quality_issues_json: unknown;
  is_excluded: boolean;
  exclusion_reason: string | null;
  is_zero_amount: boolean;
  context_fingerprint: string | null;
  account_identifier: string | null;
  reviewer_notes: string | null;
}

/**
 * Every normalized transaction a run matched on, rebuilt from `reconciliation_canonical_row`.
 *
 * This is the input side of the replay estimate (ADR-0018, #531): to show an approver what a DRAFT
 * rule version would have produced against a closed period, the engine has to be handed exactly
 * what that period was matched on, twice.
 *
 * `reconciliation_canonical_row` is the right source and two nearby tables are not, which is worth
 * recording because all three sound plausible:
 *
 *   - `canonical_record` (formerly `normalized_record`, renamed by changeset 0046) is the FILE
 *     IMPORT projection. It has no checkNumber, serialNumber, merchantName, payeeName or
 *     transactionType columns -- all of which the engine matches on -- so rebuilding from it would
 *     make a replay diverge from the original run for reasons unrelated to the proposed rule.
 *   - `reconciliation_staged_transaction` is pre-promotion and keyed to a mapping version.
 *
 * This table is written by `persistNormalizedRows` from the `NormalizedTransaction[]` the engine
 * was actually given, so it round-trips rather than approximates.
 *
 * **Keyed by the MATCHING JOB, not the reconciliation run.** `reconciliationService` passes its own
 * `runId` through as `jobId` (see `jobId: runId` there), so `job_id` here is
 * `reconciliation_run.matching_job_id`. A caller holding a closed period's run id must resolve that
 * column first -- passing the run id straight in returns zero rows, which reads identically to a
 * period whose rows were never retained.
 */
export const listNormalizedTransactionsForJob = async (
  pool: Pool,
  organizationId: string,
  matchingJobId: string,
): Promise<NormalizedTransaction[]> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<CanonicalRowRecord>(
      `SELECT id, raw_row_id, source_file_id, source_system, spreadsheet_file_name, worksheet_name,
              line_number, transaction_date, posting_date, transaction_type, check_number,
              serial_number, reference_number, description, merchant_name, payee_name, amount,
              debit, credit, running_balance, normalized_comparison_text,
              normalized_comparison_tokens, normalized_reference_tokens, raw_source_values_json,
              data_quality_issues_json, is_excluded, exclusion_reason, is_zero_amount,
              context_fingerprint, account_identifier, reviewer_notes
         FROM reconciliation_canonical_row
        WHERE organization_id = $1 AND job_id = $2
        ORDER BY line_number ASC, id ASC`,
      [organizationId, matchingJobId],
    );

    const text = (value: string | null): string | undefined => value ?? undefined;
    const num = (value: string | number | null): number | null =>
      value === null ? null : Number(value);

    return result.rows.map((row) => ({
      id: row.id,
      runId: matchingJobId,
      rawRowId: row.raw_row_id,
      sourceFileId: row.source_file_id,
      source: row.source_system as NormalizedTransaction['source'],
      spreadsheetFileName: row.spreadsheet_file_name,
      worksheetName: row.worksheet_name,
      lineNumber: Number(row.line_number),
      transactionDate: text(row.transaction_date),
      postingDate: text(row.posting_date),
      transactionType: text(row.transaction_type),
      checkNumber: text(row.check_number),
      serialNumber: text(row.serial_number),
      referenceNumber: text(row.reference_number),
      description: text(row.description),
      merchantName: text(row.merchant_name),
      payeeName: text(row.payee_name),
      amount: num(row.amount),
      // Never persisted, and never populated on this path either: the File-Validation adapter sets
      // splitAmount to null unconditionally (toNormalizedTransactions.ts), and nothing in the
      // matching engine reads it. Null here is the value the run itself carried, not a loss.
      splitAmount: null,
      debit: num(row.debit),
      credit: num(row.credit),
      runningBalance: num(row.running_balance),
      normalizedComparisonText: row.normalized_comparison_text ?? '',
      normalizedComparisonTokens: row.normalized_comparison_tokens ?? [],
      normalizedReferenceTokens: row.normalized_reference_tokens ?? [],
      rawSourceValues: (row.raw_source_values_json ?? {}) as Record<string, unknown>,
      dataQualityIssues: (row.data_quality_issues_json ??
        []) as NormalizedTransaction['dataQualityIssues'],
      isExcluded: Boolean(row.is_excluded),
      exclusionReason: text(row.exclusion_reason),
      isZeroAmount: Boolean(row.is_zero_amount),
      contextFingerprint: row.context_fingerprint ?? '',
      accountIdentifier: text(row.account_identifier),
      reviewerNotes: text(row.reviewer_notes),
    })) as NormalizedTransaction[];
  });
};

interface ReplayEstimateRow {
  id: string;
  organization_id: string;
  matching_config_version_id: string;
  reconciliation_run_id: string;
  exceptions_delta: number;
  probable_matches_delta: number;
  unresolved_exposure_delta: string;
  engine_build: string;
  draft_overrides_fingerprint: string;
  computed_at: string;
}

const REPLAY_ESTIMATE_COLUMNS =
  'id, organization_id, matching_config_version_id, reconciliation_run_id, exceptions_delta, ' +
  'probable_matches_delta, unresolved_exposure_delta, engine_build, ' +
  'draft_overrides_fingerprint, computed_at';

const mapReplayEstimate = (row: ReplayEstimateRow): ReplayEstimate => ({
  id: row.id,
  organizationId: row.organization_id,
  matchingConfigVersionId: row.matching_config_version_id,
  replayedRunId: row.reconciliation_run_id,
  // node-postgres returns INTEGER as a number and NUMERIC as a string. The counts are genuinely
  // numbers; the amount stays a string deliberately -- see ReplayEstimate.unresolvedExposureDelta.
  exceptionsDelta: Number(row.exceptions_delta),
  probableMatchesDelta: Number(row.probable_matches_delta),
  unresolvedExposureDelta: row.unresolved_exposure_delta,
  engineBuild: row.engine_build,
  draftOverridesFingerprint: row.draft_overrides_fingerprint,
  computedAt: row.computed_at,
});

/**
 * The estimate for one (draft version, replayed period) pair, or null if it has not been computed.
 *
 * The caller compares `draftOverridesFingerprint` against the draft's current overrides before
 * displaying it -- a stale estimate is not returned as an error here, because "stale" is a question
 * about the draft, which this store does not read.
 */
export const getReplayEstimate = async (
  pool: Pool,
  organizationId: string,
  matchingConfigVersionId: string,
  replayedRunId: string,
): Promise<ReplayEstimate | null> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<ReplayEstimateRow>(
      `SELECT ${REPLAY_ESTIMATE_COLUMNS}
         FROM reconciliation_replay_estimate
        WHERE organization_id = $1
          AND matching_config_version_id = $2
          AND reconciliation_run_id = $3`,
      [organizationId, matchingConfigVersionId, replayedRunId],
    );
    const row = result.rows[0];
    return row ? mapReplayEstimate(row) : null;
  });
};

/** Every estimate computed for one draft, newest first -- the approver sheet's period list. */
export const listReplayEstimatesForVersion = async (
  pool: Pool,
  organizationId: string,
  matchingConfigVersionId: string,
): Promise<ReplayEstimate[]> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<ReplayEstimateRow>(
      `SELECT ${REPLAY_ESTIMATE_COLUMNS}
         FROM reconciliation_replay_estimate
        WHERE organization_id = $1 AND matching_config_version_id = $2
        ORDER BY computed_at DESC`,
      [organizationId, matchingConfigVersionId],
    );
    return result.rows.map(mapReplayEstimate);
  });
};

/**
 * Records an estimate, replacing any earlier one for the same (version, period).
 *
 * Upsert rather than insert-or-fail: recomputation is expected. A draft's overrides can change,
 * which invalidates the estimate that described them, and the honest response is to replace the
 * row rather than accumulate rows a reader has to date-sort to interpret. `computed_at` is reset
 * on replace so staleness stays truthful.
 */
export const upsertReplayEstimate = async (
  pool: Pool,
  input: Readonly<{
    id: string;
    organizationId: string;
    matchingConfigVersionId: string;
    replayedRunId: string;
    exceptionsDelta: number;
    probableMatchesDelta: number;
    unresolvedExposureDelta: string;
    engineBuild: string;
    draftOverridesFingerprint: string;
  }>,
): Promise<ReplayEstimate> => {
  return runInTenantScope(pool, input.organizationId, async (client) => {
    const result = await client.query<ReplayEstimateRow>(
      `INSERT INTO reconciliation_replay_estimate (
         id, organization_id, matching_config_version_id, reconciliation_run_id,
         exceptions_delta, probable_matches_delta, unresolved_exposure_delta,
         engine_build, draft_overrides_fingerprint
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (organization_id, matching_config_version_id, reconciliation_run_id)
       DO UPDATE SET
         exceptions_delta = EXCLUDED.exceptions_delta,
         probable_matches_delta = EXCLUDED.probable_matches_delta,
         unresolved_exposure_delta = EXCLUDED.unresolved_exposure_delta,
         engine_build = EXCLUDED.engine_build,
         draft_overrides_fingerprint = EXCLUDED.draft_overrides_fingerprint,
         computed_at = NOW()
       RETURNING ${REPLAY_ESTIMATE_COLUMNS}`,
      [
        input.id,
        input.organizationId,
        input.matchingConfigVersionId,
        input.replayedRunId,
        input.exceptionsDelta,
        input.probableMatchesDelta,
        input.unresolvedExposureDelta,
        input.engineBuild,
        input.draftOverridesFingerprint,
      ],
    );

    const row = result.rows[0];
    // RLS makes a mis-scoped write match zero rows and report success. An upsert that returns
    // nothing means the tenant scope did not take, not that the row is merely unchanged.
    if (!row) {
      throw new Error('upsertReplayEstimate: wrote no row -- tenant scope did not apply');
    }
    return mapReplayEstimate(row);
  });
};

const MATCHING_CONFIG_VERSION_COLUMNS =
  'id, organization_id, version_number, status, variance_overrides, created_by, created_at, ' +
  'published_by, published_at, effective_at, pending_approval_owner, draft_reason, ' +
  'rejection_note, rejected_by, rejected_at';

const mapMatchingConfigVersion = (row: MatchingConfigVersionRow): MatchingConfigVersion => ({
  id: row.id,
  organizationId: row.organization_id,
  versionNumber: row.version_number,
  status: row.status,
  varianceOverrides: row.variance_overrides,
  createdBy: row.created_by,
  createdAt: row.created_at,
  publishedBy: row.published_by,
  publishedAt: row.published_at,
  effectiveAt: row.effective_at,
  pendingApprovalOwner: row.pending_approval_owner,
  draftReason: row.draft_reason,
  rejectionNote: row.rejection_note,
  rejectedBy: row.rejected_by,
  rejectedAt: row.rejected_at,
});

/**
 * Declines a pending DRAFT, terminally (#404).
 *
 * The row is UPDATED, never deleted, and that is what makes "a rejected version's number is not
 * reused" true: `createMatchingConfigVersionDraft` takes `MAX(version_number) + 1` across every row
 * for the organization, so a kept REJECTED row permanently occupies its number. Deleting it would
 * hand the number back and let v13 mean two different proposals to two different readers.
 *
 * Scoped to `status = 'DRAFT'` in the WHERE clause rather than checked first, so two approvers
 * racing cannot both reject: the second matches no row and gets null, which the caller reports as
 * "no longer pending" instead of silently overwriting the first decision.
 */
export const rejectMatchingConfigVersionDraft = async (
  pool: Pool,
  input: Readonly<{
    organizationId: string;
    versionId: string;
    rejectedBy: string;
    rejectionNote: string;
  }>,
): Promise<MatchingConfigVersion | null> => {
  return runInTenantScope(pool, input.organizationId, async (client) => {
    const result = await client.query<MatchingConfigVersionRow>(
      `UPDATE reconciliation_matching_config_version
          SET status = 'REJECTED',
              rejection_note = $3,
              rejected_by = $4,
              rejected_at = NOW(),
              pending_approval_owner = NULL
        WHERE organization_id = $1 AND id = $2 AND status = 'DRAFT'
       RETURNING ${MATCHING_CONFIG_VERSION_COLUMNS}`,
      [input.organizationId, input.versionId, input.rejectionNote, input.rejectedBy],
    );

    const row = result.rows[0];
    return row ? mapMatchingConfigVersion(row) : null;
  });
};

/** Input fields accepted when drafting a new matching-config version. */
export interface CreateMatchingConfigVersionDraftInput {
  id: string;
  organizationId: string;
  varianceOverrides: Partial<Record<keyof MatchingConfig, number>>;
  createdBy: string;
  pendingApprovalOwner?: string | null;
  /** Why this version is being proposed. Required by the API (#404) -- an approver deciding a draft
   * needs the proposer's own account of it, not only a diff they must interpret unaided. */
  draftReason: string;
}

/**
 * Inserts a new DRAFT matching-config version, one past the organization's highest existing
 * version number (draft or otherwise). The partial unique index
 * `reconciliation_matching_config_version_one_draft_idx` rejects a second concurrent draft for
 * the same organization -- callers should catch a unique-violation (Postgres error code 23505)
 * and surface it as "a draft is already pending" rather than a generic 500.
 */
export const createMatchingConfigVersionDraft = async (
  pool: Pool,
  input: CreateMatchingConfigVersionDraftInput,
): Promise<MatchingConfigVersion> => {
  return runInTenantScope(pool, input.organizationId, async (client) => {
    const result = await client.query<MatchingConfigVersionRow>(
      `INSERT INTO reconciliation_matching_config_version
         (id, organization_id, version_number, variance_overrides, created_by,
          pending_approval_owner, draft_reason)
       SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, $3::jsonb, $4, $5, $6
         FROM reconciliation_matching_config_version
        WHERE organization_id = $2
       RETURNING ${MATCHING_CONFIG_VERSION_COLUMNS}`,
      [
        input.id,
        input.organizationId,
        JSON.stringify(input.varianceOverrides),
        input.createdBy,
        input.pendingApprovalOwner ?? null,
        input.draftReason,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('createMatchingConfigVersionDraft: INSERT returned no row');
    }
    return mapMatchingConfigVersion(row);
  });
};

/**
 * Publishes a DRAFT matching-config version: moves it to ACTIVE (stamping publishedBy/
 * publishedAt/effectiveAt) and, in the same transaction, moves the organization's previous
 * ACTIVE version (if any) to SUPERSEDED. Throws if `versionId` does not identify a DRAFT version
 * belonging to `organizationId`.
 */
export const publishMatchingConfigVersion = async (
  pool: Pool,
  organizationId: string,
  versionId: string,
  input: { publishedBy: string; effectiveAt?: string },
): Promise<MatchingConfigVersion> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    // Supersede the current ACTIVE row *before* activating the draft -- the reverse order (as
    // this originally shipped) briefly asserts a second ACTIVE row for the organization while
    // both UPDATEs are pending, which reconciliation_matching_config_version_one_active_idx
    // (a partial unique index, checked immediately, not deferred) correctly rejects. If
    // versionId turns out not to be a real DRAFT, the "no matching DRAFT" throw below rolls this
    // supersede back too, via runInTenantScope's catch -- so it's never left half-applied.
    await client.query(
      `UPDATE reconciliation_matching_config_version
          SET status = 'SUPERSEDED'
        WHERE organization_id = $1 AND status = 'ACTIVE' AND id <> $2`,
      [organizationId, versionId],
    );

    const activated = await client.query<MatchingConfigVersionRow>(
      `UPDATE reconciliation_matching_config_version
          SET status = 'ACTIVE',
              published_by = $3,
              published_at = NOW(),
              effective_at = COALESCE($4::timestamptz, NOW()),
              pending_approval_owner = NULL
        WHERE id = $1 AND organization_id = $2 AND status = 'DRAFT'
        RETURNING ${MATCHING_CONFIG_VERSION_COLUMNS}`,
      [versionId, organizationId, input.publishedBy, input.effectiveAt ?? null],
    );
    const row = activated.rows[0];
    if (!row) {
      throw new Error('publishMatchingConfigVersion: no matching DRAFT version to publish');
    }

    return mapMatchingConfigVersion(row);
  });
};

/** Every matching-config version for an organization, newest first — includes ACTIVE, the DRAFT if one exists, and all SUPERSEDED history. */
export const listMatchingConfigVersions = async (
  pool: Pool,
  organizationId: string,
): Promise<MatchingConfigVersion[]> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<MatchingConfigVersionRow>(
      `SELECT ${MATCHING_CONFIG_VERSION_COLUMNS}
         FROM reconciliation_matching_config_version
        WHERE organization_id = $1
        ORDER BY version_number DESC`,
      [organizationId],
    );
    return result.rows.map(mapMatchingConfigVersion);
  });
};

/** Input fields accepted when requesting approval for an uploaded source file. */
export interface CreateImportApprovalInput {
  id: string;
  sourceFileId: string;
  uploadedBy: string;
}

/** Input to `recordApprovalDecision` — approves, rejects, or overrides a pending import. */
export interface RecordApprovalDecisionInput {
  approvalId: string;
  toStatus: Extract<ImportApprovalStatus, 'APPROVED' | 'REJECTED' | 'OVERRIDDEN'>;
  actor: string;
  rationale?: string;
}

type ImportApprovalRow = {
  id: string;
  source_file_id: string;
  status: ImportApprovalStatus;
  uploaded_by: string;
  approved_by: string | null;
  rationale: string | null;
  requested_at: string;
  decided_at: string | null;
};

const mapImportApproval = (row: ImportApprovalRow): ImportApproval => ({
  id: row.id,
  sourceFileId: row.source_file_id,
  status: row.status,
  uploadedBy: row.uploaded_by,
  approvedBy: row.approved_by ?? undefined,
  rationale: row.rationale ?? undefined,
  requestedAt: row.requested_at,
  decidedAt: row.decided_at ?? undefined,
});

/**
 * Opens the approval gate for an uploaded source file. `reconciliation_source_file.approval_status`
 * should be moved to `'PENDING'` by the caller in the same transaction (see
 * `PostgresReconciliationLifecycleStore` for the transactional job-lifecycle pattern this mirrors);
 * this function only owns the `reconciliation_import_approval` row itself.
 */
export const createImportApproval = async (
  pool: Pool,
  organizationId: string,
  input: CreateImportApprovalInput,
): Promise<ImportApproval> => {
  // organization_id derives from the source file being approved, same reasoning as
  // createMappingProfileVersion above -- organizationId here only sets the RLS tenant GUC.
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<ImportApprovalRow>(
      `INSERT INTO reconciliation_import_approval (id, source_file_id, organization_id, uploaded_by)
       SELECT $1, $2, sf.organization_id, $3
         FROM reconciliation_source_file sf
        WHERE sf.id = $2
       RETURNING id, source_file_id, status, uploaded_by, approved_by, rationale, requested_at, decided_at`,
      [input.id, input.sourceFileId, input.uploadedBy],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('createImportApproval: INSERT returned no row');
    }
    return mapImportApproval(row);
  });
};

/**
 * Records an approve/reject/override decision and appends the transition to
 * `reconciliation_approval_history` — the append-only audit trail the target work plan requires
 * (mirrors `insertAuditEvent` in `reconciliationLifecycleStore.ts`, scoped to approvals instead of
 * job state). Both writes happen in one transaction so the audit trail can never diverge from the
 * approval's current status.
 */
export const recordApprovalDecision = async (
  pool: Pool,
  organizationId: string,
  input: RecordApprovalDecisionInput,
): Promise<ImportApproval> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const current = await client.query<ImportApprovalRow>(
      'SELECT status FROM reconciliation_import_approval WHERE id = $1 FOR UPDATE',
      [input.approvalId],
    );
    const currentRow = current.rows[0];
    if (!currentRow) {
      throw new Error(`reconciliation_import_approval not found: ${input.approvalId}`);
    }

    const updated = await client.query<ImportApprovalRow>(
      `UPDATE reconciliation_import_approval
          SET status = $2, approved_by = $3, rationale = $4, decided_at = NOW()
        WHERE id = $1
    RETURNING id, source_file_id, status, uploaded_by, approved_by, rationale, requested_at, decided_at`,
      [input.approvalId, input.toStatus, input.actor, input.rationale ?? null],
    );

    await client.query(
      `INSERT INTO reconciliation_approval_history (id, approval_id, organization_id, from_status, to_status, actor, note)
       SELECT gen_random_uuid(), $1, ia.organization_id, $2, $3, $4, $5
         FROM reconciliation_import_approval ia
        WHERE ia.id = $1`,
      [input.approvalId, currentRow.status, input.toStatus, input.actor, input.rationale ?? null],
    );

    const row = updated.rows[0];
    if (!row) {
      throw new Error('recordApprovalDecision: UPDATE returned no row');
    }
    return mapImportApproval(row);
  });
};

/** Loads the full append-only approval history for one import approval, oldest first. */
export const loadApprovalHistory = async (
  pool: Pool,
  organizationId: string,
  approvalId: string,
): Promise<ApprovalHistoryEntry[]> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<{
      id: string;
      approval_id: string;
      from_status: ImportApprovalStatus | null;
      to_status: ImportApprovalStatus;
      actor: string;
      note: string | null;
      created_at: string;
    }>(
      `SELECT id, approval_id, from_status, to_status, actor, note, created_at
         FROM reconciliation_approval_history
        WHERE approval_id = $1
        ORDER BY created_at ASC`,
      [approvalId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      approvalId: row.approval_id,
      fromStatus: row.from_status ?? undefined,
      toStatus: row.to_status,
      actor: row.actor,
      note: row.note ?? undefined,
      createdAt: row.created_at,
    }));
  });
};

/** One `reconciliation_import_approval` row joined with its source file, for the Approvals list. */
export interface ImportApprovalListItem extends ImportApproval {
  fileName: string;
  sourceSystem: SourceSystem;
}

/**
 * Filters for `listImportApprovals`. `routedToOrUnassigned` implements the approver Pending queue
 * scoping rule from the RailMenuMods design ("everything routed to me + unassigned"); submitters
 * instead pass `uploadedBy` to scope every tab to only what they submitted.
 */
export interface ListImportApprovalsFilter {
  status?: ImportApprovalStatus;
  uploadedBy?: string;
  routedToOrUnassigned?: string;
}

export const listImportApprovals = async (
  pool: Pool,
  organizationId: string,
  filter: ListImportApprovalsFilter,
): Promise<ImportApprovalListItem[]> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<ImportApprovalRow & { file_name: string; source_system: SourceSystem }>(
      `SELECT ia.id, ia.source_file_id, ia.status, ia.uploaded_by, ia.approved_by, ia.rationale,
              ia.requested_at, ia.decided_at, sf.file_name, sf.source_system
         FROM reconciliation_import_approval ia
         JOIN reconciliation_source_file sf ON sf.id = ia.source_file_id
        WHERE ($1::text IS NULL OR ia.status = $1)
          AND ($2::text IS NULL OR ia.uploaded_by = $2)
          AND ($3::text IS NULL OR ia.approved_by = $3 OR ia.approved_by IS NULL)
        ORDER BY ia.requested_at DESC`,
      [filter.status ?? null, filter.uploadedBy ?? null, filter.routedToOrUnassigned ?? null],
    );

    return result.rows.map((row) => ({
      ...mapImportApproval(row),
      fileName: row.file_name,
      sourceSystem: row.source_system,
    }));
  });
};

/** Assigns `actor` as the approver on an unclaimed pending import approval, without deciding it. */
export const claimImportApproval = async (
  pool: Pool,
  organizationId: string,
  approvalId: string,
  actor: string,
): Promise<ImportApproval> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<ImportApprovalRow>(
      `UPDATE reconciliation_import_approval
          SET approved_by = $2
        WHERE id = $1 AND status = 'PENDING' AND approved_by IS NULL
    RETURNING id, source_file_id, status, uploaded_by, approved_by, rationale, requested_at, decided_at`,
      [approvalId, actor],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`claimImportApproval: no unclaimed pending approval ${approvalId}`);
    }
    return mapImportApproval(row);
  });
};

/**
 * Approval counts for the Approvals rail badge and tab labels. Scope differs by privilege
 * (RailMenuMods "Rows visible" rule): an approver's approved/rejected counts are org-wide (their
 * tabs list everything decided), a submitter's are scoped to only what they submitted.
 */
export const getImportApprovalCounts = async (
  pool: Pool,
  organizationId: string,
  username: string,
  canApprove: boolean,
): Promise<ApprovalCounts> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<{
      pending: string;
      approved: string;
      rejected: string;
      my_submissions: string;
    }>(
      canApprove
        ? `SELECT
             COUNT(*) FILTER (WHERE status = 'PENDING' AND (approved_by = $1 OR approved_by IS NULL)) AS pending,
             COUNT(*) FILTER (WHERE status = 'APPROVED') AS approved,
             COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected,
             COUNT(*) FILTER (WHERE uploaded_by = $1) AS my_submissions
           FROM reconciliation_import_approval`
        : `SELECT
             COUNT(*) FILTER (WHERE status = 'PENDING' AND uploaded_by = $1) AS pending,
             COUNT(*) FILTER (WHERE status = 'APPROVED' AND uploaded_by = $1) AS approved,
             COUNT(*) FILTER (WHERE status = 'REJECTED' AND uploaded_by = $1) AS rejected,
             COUNT(*) FILTER (WHERE uploaded_by = $1) AS my_submissions
           FROM reconciliation_import_approval`,
      [username],
    );
    const row = result.rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      approved: Number(row?.approved ?? 0),
      rejected: Number(row?.rejected ?? 0),
      mySubmissions: Number(row?.my_submissions ?? 0),
    };
  });
};

/** The five `ApprovableType`s backed by the generic `reconciliation_approval_request` table --
 * everything except 'import' (its own dedicated sidecar table) and 'reconciliationRun' (decided
 * directly on reconciliation_run itself, see PostgresImportValidationStore). */
export type GenericApprovableType = Exclude<ApprovableType, 'import' | 'reconciliationRun'>;

export interface CreateApprovalRequestInput {
  id: string;
  subjectType: GenericApprovableType;
  subjectId: string;
  submittedBy: string;
}

export interface ApprovalRequestRecord {
  id: string;
  subjectType: GenericApprovableType;
  subjectId: string;
  status: ImportApprovalStatus;
  submittedBy: string;
  decidedBy?: string;
  rationale?: string;
  requestedAt: string;
  decidedAt?: string;
}

export interface RecordApprovalRequestDecisionInput {
  approvalRequestId: string;
  toStatus: Extract<ImportApprovalStatus, 'APPROVED' | 'REJECTED' | 'OVERRIDDEN'>;
  actor: string;
  rationale?: string;
}

export interface ListApprovalRequestsFilter {
  subjectType: GenericApprovableType;
  status?: ImportApprovalStatus;
  submittedBy?: string;
  routedToOrUnassigned?: string;
}

type ApprovalRequestRow = {
  id: string;
  subject_type: GenericApprovableType;
  subject_id: string;
  status: ImportApprovalStatus;
  submitted_by: string;
  decided_by: string | null;
  rationale: string | null;
  requested_at: string;
  decided_at: string | null;
};

const mapApprovalRequest = (row: ApprovalRequestRow): ApprovalRequestRecord => ({
  id: row.id,
  subjectType: row.subject_type,
  subjectId: row.subject_id,
  status: row.status,
  submittedBy: row.submitted_by,
  decidedBy: row.decided_by ?? undefined,
  rationale: row.rationale ?? undefined,
  requestedAt: row.requested_at,
  decidedAt: row.decided_at ?? undefined,
});

/** Opens the approval gate for a mapping-profile / matching-rule / variance-threshold / exception-resolution / report-distribution subject. */
export const createApprovalRequest = async (
  pool: Pool,
  organizationId: string,
  input: CreateApprovalRequestInput,
): Promise<ApprovalRequestRecord> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<ApprovalRequestRow>(
      `INSERT INTO reconciliation_approval_request (id, organization_id, subject_type, subject_id, submitted_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, subject_type, subject_id, status, submitted_by, decided_by, rationale, requested_at, decided_at`,
      [input.id, organizationId, input.subjectType, input.subjectId, input.submittedBy],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('createApprovalRequest: INSERT returned no row');
    }
    return mapApprovalRequest(row);
  });
};

/** Records an approve/reject/override decision on a generic approval request, appending to `reconciliation_approval_request_history` in the same transaction (mirrors `recordApprovalDecision`). */
export const recordApprovalRequestDecision = async (
  pool: Pool,
  organizationId: string,
  input: RecordApprovalRequestDecisionInput,
): Promise<ApprovalRequestRecord> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const current = await client.query<ApprovalRequestRow>(
      'SELECT status FROM reconciliation_approval_request WHERE id = $1 FOR UPDATE',
      [input.approvalRequestId],
    );
    const currentRow = current.rows[0];
    if (!currentRow) {
      throw new Error(`reconciliation_approval_request not found: ${input.approvalRequestId}`);
    }

    const updated = await client.query<ApprovalRequestRow>(
      `UPDATE reconciliation_approval_request
          SET status = $2, decided_by = $3, rationale = $4, decided_at = NOW()
        WHERE id = $1
    RETURNING id, subject_type, subject_id, status, submitted_by, decided_by, rationale, requested_at, decided_at`,
      [input.approvalRequestId, input.toStatus, input.actor, input.rationale ?? null],
    );

    await client.query(
      `INSERT INTO reconciliation_approval_request_history (id, approval_request_id, organization_id, from_status, to_status, actor, note)
       SELECT gen_random_uuid(), $1, ar.organization_id, $2, $3, $4, $5
         FROM reconciliation_approval_request ar
        WHERE ar.id = $1`,
      [input.approvalRequestId, currentRow.status, input.toStatus, input.actor, input.rationale ?? null],
    );

    const row = updated.rows[0];
    if (!row) {
      throw new Error('recordApprovalRequestDecision: UPDATE returned no row');
    }
    return mapApprovalRequest(row);
  });
};

/** Assigns `actor` as the approver on an unclaimed pending generic approval request, without deciding it. */
export const claimApprovalRequest = async (
  pool: Pool,
  organizationId: string,
  approvalRequestId: string,
  actor: string,
): Promise<ApprovalRequestRecord> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<ApprovalRequestRow>(
      `UPDATE reconciliation_approval_request
          SET decided_by = $2
        WHERE id = $1 AND status = 'PENDING' AND decided_by IS NULL
    RETURNING id, subject_type, subject_id, status, submitted_by, decided_by, rationale, requested_at, decided_at`,
      [approvalRequestId, actor],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`claimApprovalRequest: no unclaimed pending approval request ${approvalRequestId}`);
    }
    return mapApprovalRequest(row);
  });
};

export const listApprovalRequests = async (
  pool: Pool,
  organizationId: string,
  filter: ListApprovalRequestsFilter,
): Promise<ApprovalRequestRecord[]> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<ApprovalRequestRow>(
      `SELECT id, subject_type, subject_id, status, submitted_by, decided_by, rationale, requested_at, decided_at
         FROM reconciliation_approval_request
        WHERE subject_type = $1
          AND ($2::text IS NULL OR status = $2)
          AND ($3::text IS NULL OR submitted_by = $3)
          AND ($4::text IS NULL OR decided_by = $4 OR decided_by IS NULL)
        ORDER BY requested_at DESC`,
      [filter.subjectType, filter.status ?? null, filter.submittedBy ?? null, filter.routedToOrUnassigned ?? null],
    );
    return result.rows.map(mapApprovalRequest);
  });
};

/** Approval-request counts scoped to one or more generic subject types (e.g. matchingRule + varianceThreshold combined for the "Matching Rule & Variances" rail submenu), scoped by privilege like `getImportApprovalCounts`. */
export const getApprovalRequestCounts = async (
  pool: Pool,
  organizationId: string,
  username: string,
  canApprove: boolean,
  subjectTypes: GenericApprovableType[],
): Promise<ApprovalCounts> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<{
      pending: string;
      approved: string;
      rejected: string;
      my_submissions: string;
    }>(
      canApprove
        ? `SELECT
             COUNT(*) FILTER (WHERE status = 'PENDING' AND (decided_by = $1 OR decided_by IS NULL)) AS pending,
             COUNT(*) FILTER (WHERE status = 'APPROVED') AS approved,
             COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected,
             COUNT(*) FILTER (WHERE submitted_by = $1) AS my_submissions
           FROM reconciliation_approval_request
          WHERE subject_type = ANY($2)`
        : `SELECT
             COUNT(*) FILTER (WHERE status = 'PENDING' AND submitted_by = $1) AS pending,
             COUNT(*) FILTER (WHERE status = 'APPROVED' AND submitted_by = $1) AS approved,
             COUNT(*) FILTER (WHERE status = 'REJECTED' AND submitted_by = $1) AS rejected,
             COUNT(*) FILTER (WHERE submitted_by = $1) AS my_submissions
           FROM reconciliation_approval_request
          WHERE subject_type = ANY($2)`,
      [username, subjectTypes],
    );
    const row = result.rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      approved: Number(row?.approved ?? 0),
      rejected: Number(row?.rejected ?? 0),
      mySubmissions: Number(row?.my_submissions ?? 0),
    };
  });
};

type LoginEventRow = {
  id: string;
  organization_id: string | null;
  username: string;
  event_type: LoginEventType;
  failure_reason: string | null;
  ip_address: string | null;
  session_id: string | null;
  created_at: string;
};

const mapLoginEvent = (row: LoginEventRow): LoginEvent => ({
  id: row.id,
  organizationId: row.organization_id,
  username: row.username,
  eventType: row.event_type,
  failureReason: row.failure_reason,
  ipAddress: row.ip_address,
  sessionId: row.session_id,
  createdAt: row.created_at,
});

/** Input fields accepted when recording an authentication event (ISSUE-050.2). */
export interface RecordLoginEventInput {
  id: string;
  organizationId: string | null;
  username: string;
  eventType: LoginEventType;
  failureReason?: string;
  ipAddress?: string;
  /** Session id (JWT `jti`). Omit for LOGIN_FAILURE -- no token is ever minted for a failed
   * attempt. */
  sessionId?: string;
}

/**
 * Records one row in the durable authentication audit trail. Uses a plain `pool.query`, not
 * `runInTenantScope` -- `reconciliation_login_event` is deliberately not RLS-protected (see the
 * table's own changeset comment), for the same reason `reconciliation_user` isn't: a
 * `LOGIN_FAILURE` for an unresolvable username has no organization to scope a transaction to.
 */
export const recordLoginEvent = async (
  pool: Pool,
  input: RecordLoginEventInput,
): Promise<LoginEvent> => {
  const result = await pool.query<LoginEventRow>(
    `INSERT INTO reconciliation_login_event
       (id, organization_id, username, event_type, failure_reason, ip_address, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, organization_id, username, event_type, failure_reason, ip_address, session_id,
       created_at`,
    [
      input.id,
      input.organizationId,
      input.username,
      input.eventType,
      input.failureReason ?? null,
      input.ipAddress ?? null,
      input.sessionId ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('recordLoginEvent: INSERT returned no row');
  }
  return mapLoginEvent(row);
};

/** Input for {@link proposePayeeAlias}. `approvalRequestId` is caller-supplied (like
 * `CreateApprovalRequestInput.id`) so the API can log it before the write. */
export interface ProposePayeeAliasInput {
  accountIdentifier?: string;
  bankPattern: string;
  canonicalPayeeName: string;
  normalizedTokens: string[];
  sourceDirection?: 'bank_to_gl' | 'bidirectional';
  matchConfidence?: number;
  submittedBy: string;
  approvalRequestId: string;
}

/** Issue #311 (PR B): records a payee alias learned from a reviewer's confirmed probable match as a
 * PROPOSAL -- the alias row is inserted with `is_active = false` and a generic approval request
 * (`subject_type = 'payeeAlias'`) opens against it in the same transaction, so the alias either
 * exists inactive-with-a-gate or not at all. Two separate store calls would leave an inert,
 * ungated row behind if the second failed. Approval flips `is_active` via {@link updatePayeeAlias}. */
export const proposePayeeAlias = async (
  pool: Pool,
  organizationId: string,
  input: ProposePayeeAliasInput,
): Promise<{ alias: PayeeAlias; approvalRequest: ApprovalRequestRecord }> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const aliasResult = await client.query<PayeeAliasRow>(
      `INSERT INTO reconciliation_payee_alias
         (organization_id, account_identifier, bank_pattern, canonical_payee_name, normalized_tokens, source_direction, match_confidence, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)
       RETURNING id, account_identifier, bank_pattern, canonical_payee_name, normalized_tokens, source_direction, match_confidence, is_active`,
      [
        organizationId,
        input.accountIdentifier ?? null,
        input.bankPattern,
        input.canonicalPayeeName,
        input.normalizedTokens,
        input.sourceDirection ?? 'bank_to_gl',
        input.matchConfidence ?? 1,
      ],
    );
    const aliasRow = aliasResult.rows[0];
    if (!aliasRow) {
      throw new Error('proposePayeeAlias: alias INSERT returned no row');
    }
    const requestResult = await client.query<ApprovalRequestRow>(
      `INSERT INTO reconciliation_approval_request (id, organization_id, subject_type, subject_id, submitted_by)
       VALUES ($1, $2, 'payeeAlias', $3, $4)
       RETURNING id, subject_type, subject_id, status, submitted_by, decided_by, rationale, requested_at, decided_at`,
      [input.approvalRequestId, organizationId, aliasRow.id, input.submittedBy],
    );
    const requestRow = requestResult.rows[0];
    if (!requestRow) {
      throw new Error('proposePayeeAlias: approval request INSERT returned no row');
    }
    return { alias: mapPayeeAlias(aliasRow), approvalRequest: mapApprovalRequest(requestRow) };
  });
};

/** Loads one alias by id within the organization, active or not -- the approvals inbox needs to
 * title a pending proposal, and a pending proposal is by definition inactive. */
export const findPayeeAliasById = async (
  pool: Pool,
  organizationId: string,
  id: string,
): Promise<PayeeAlias | undefined> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<PayeeAliasRow>(
      `SELECT id, account_identifier, bank_pattern, canonical_payee_name, normalized_tokens, source_direction, match_confidence, is_active
         FROM reconciliation_payee_alias
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, id],
    );
    const row = result.rows[0];
    return row ? mapPayeeAlias(row) : undefined;
  });
};

/** The text fields of persisted normalized transactions, keyed for the alias proposal in #311. */
export interface CanonicalTransactionText {
  id: string;
  source: string;
  description?: string;
  merchantName?: string;
  payeeName?: string;
  normalizedComparisonTokens: string[];
}

/** Reads the persisted text of specific normalized transactions of a run. The run REPORT the API
 * hands around carries only transaction ids on a match (sanitizeRun strips
 * normalizedTransactions), and an API instance deciding a review may not be the one that ran the
 * job, so the in-memory repository cannot be relied on -- this is the durable source. */
export const loadCanonicalTransactionsByIds = async (
  pool: Pool,
  organizationId: string,
  runId: string,
  ids: string[],
): Promise<CanonicalTransactionText[]> => {
  if (ids.length === 0) {
    return [];
  }
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<{
      id: string;
      source_system: string;
      description: string | null;
      merchant_name: string | null;
      payee_name: string | null;
      normalized_comparison_tokens: string[] | null;
    }>(
      `SELECT id, source_system, description, merchant_name, payee_name, normalized_comparison_tokens
         FROM reconciliation_canonical_row
        WHERE organization_id = $1 AND job_id = $2 AND id = ANY($3::uuid[])`,
      [organizationId, runId, ids],
    );
    return result.rows.map((row) => ({
      id: row.id,
      source: row.source_system,
      description: row.description ?? undefined,
      merchantName: row.merchant_name ?? undefined,
      payeeName: row.payee_name ?? undefined,
      normalizedComparisonTokens: row.normalized_comparison_tokens ?? [],
    }));
  });
};

/** Case-insensitive lookup of an alias by its (bankPattern, canonicalPayeeName) pair, active or
 * not. `loadPayeeAliases` deliberately hides inactive rows from the engine, but a proposal must
 * not be re-raised while an identical one is still pending -- or after it was rejected. */
export const findPayeeAliasByPattern = async (
  pool: Pool,
  organizationId: string,
  bankPattern: string,
  canonicalPayeeName: string,
): Promise<PayeeAlias | undefined> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query<PayeeAliasRow>(
      `SELECT id, account_identifier, bank_pattern, canonical_payee_name, normalized_tokens, source_direction, match_confidence, is_active
         FROM reconciliation_payee_alias
        WHERE organization_id = $1
          AND lower(bank_pattern) = lower($2)
          AND lower(canonical_payee_name) = lower($3)
        ORDER BY is_active DESC
        LIMIT 1`,
      [organizationId, bankPattern, canonicalPayeeName],
    );
    const row = result.rows[0];
    return row ? mapPayeeAlias(row) : undefined;
  });
};

/** Issue #311 (PR B): the approval side of {@link proposePayeeAlias} -- flips a proposed alias to
 * `is_active = true` so `loadPayeeAliases` (and therefore the engine) starts seeing it. Mirror of
 * `deactivatePayeeAlias`; `updatePayeeAlias` deliberately cannot touch `is_active`, because the
 * generic PUT must not be a back door around the approval gate. Returns `true` when a row changed. */
export const activatePayeeAlias = async (
  pool: Pool,
  organizationId: string,
  id: string,
): Promise<boolean> => {
  return runInTenantScope(pool, organizationId, async (client) => {
    const result = await client.query(
      `UPDATE reconciliation_payee_alias
          SET is_active = TRUE, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 AND is_active = FALSE`,
      [organizationId, id],
    );
    return (result.rowCount ?? 0) > 0;
  });
};
