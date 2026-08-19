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
  PayeeAlias,
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
            match_confidence, normalized_comparison_tokens, related_transaction_ids
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
            evidence_json, likely_matching_reference, exception_category
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
                match_confidence, normalized_comparison_tokens, related_transaction_ids
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
};

const MATCHING_CONFIG_VERSION_COLUMNS =
  'id, organization_id, version_number, status, variance_overrides, created_by, created_at, ' +
  'published_by, published_at, effective_at, pending_approval_owner';

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
});

/** Input fields accepted when drafting a new matching-config version. */
export interface CreateMatchingConfigVersionDraftInput {
  id: string;
  organizationId: string;
  varianceOverrides: Partial<Record<keyof MatchingConfig, number>>;
  createdBy: string;
  pendingApprovalOwner?: string | null;
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
         (id, organization_id, version_number, variance_overrides, created_by, pending_approval_owner)
       SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, $3::jsonb, $4, $5
         FROM reconciliation_matching_config_version
        WHERE organization_id = $2
       RETURNING ${MATCHING_CONFIG_VERSION_COLUMNS}`,
      [
        input.id,
        input.organizationId,
        JSON.stringify(input.varianceOverrides),
        input.createdBy,
        input.pendingApprovalOwner ?? null,
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
