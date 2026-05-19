import type {
  ExceptionItem,
  ExceptionRuleTrace,
  GroupedMatchMember,
  GroupedMatchResult,
  MatchResult,
  OutputWorkbookManifest,
  ReconciliationRunReport,
  ReviewerDecision,
  ReviewerObservation,
  SourceFile,
  SourceSystem,
  SummaryMetrics,
} from '@recon/domain';

import type { Pool } from 'pg';

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
  qbo_transaction_ids: unknown;
  bank_members_json: unknown;
  qbo_members_json: unknown;
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
  qbo_transaction_id: string | null;
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
  qbo_records: number;
  exact_matches: number;
  probable_matches: number;
  unmatched_items: number;
  duplicates: number;
  bank_duplicates: number;
  qbo_duplicates: number;
  date_variances: number;
  timing_differences: number;
  data_quality_issues: number;
  amount_mismatches: number;
  missing_from_bank: number;
  missing_from_qbo: number;
  unmatched_bank_net_amount: string | number;
  unmatched_qbo_net_amount: string | number;
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
  qboTransactionIds: asStringArray(row.qbo_transaction_ids),
  bankMembers: mapGroupedMembers(row.bank_members_json),
  qboMembers: mapGroupedMembers(row.qbo_members_json),
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
  qboTransactionId: row.qbo_transaction_id ?? undefined,
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

const mapReviewerObservation = (runId: string, row: ReviewerObservationRow): ReviewerObservation => ({
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
  qboRecords: row.qbo_records,
  exactMatches: row.exact_matches,
  probableMatches: row.probable_matches,
  unmatchedItems: row.unmatched_items,
  duplicates: row.duplicates,
  bankDuplicates: row.bank_duplicates,
  qboDuplicates: row.qbo_duplicates,
  dateVariances: row.date_variances,
  timingDifferences: row.timing_differences,
  dataQualityIssues: row.data_quality_issues,
  amountMismatches: row.amount_mismatches,
  missingFromBank: row.missing_from_bank,
  missingFromQBO: row.missing_from_qbo,
  unmatchedBankNetAmount: asNumber(row.unmatched_bank_net_amount) ?? 0,
  unmatchedQboNetAmount: asNumber(row.unmatched_qbo_net_amount) ?? 0,
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

/**
 * PostgreSQL-backed read-model store for reconciliation runs, exceptions, exports, and
 * reviewer decisions. Used by the API to serve report and dashboard queries.
 */
export class PostgresReconciliationReadModelStore {
  constructor(private readonly pool: Pool) {}

  async findLatestRunReport(): Promise<ReconciliationRunReport | undefined> {
    const result = await this.pool.query<{ id: string }>(
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

    return this.findRunReportById(runId);
  }

  async findRunReportById(runId: string): Promise<ReconciliationRunReport | undefined> {
    const jobResult = await this.pool.query<ReconciliationJobRow>(
      `SELECT id, correlation_id, account_identifier, period_label, reconciliation_frequency, current_state, started_at, completed_at
         FROM reconciliation_job
        WHERE id = $1`,
      [runId],
    );

    const job = jobResult.rows[0];
    if (!job) {
      return undefined;
    }

    const [sourceFiles, groupedMatchResults, probableMatches, exceptions, summary, reviewerObservations, reviewerDecisions, outputWorkbook] = await Promise.all([
      this.listSourceFiles(runId),
      this.listGroupedMatchResults(runId),
      this.listProbableMatches(runId),
      this.listRunExceptions(runId),
      this.findRunSummaryById(runId),
      this.listReviewerObservations(runId),
      this.listReviewerDecisions(runId),
      this.findOutputWorkbook(runId),
    ]);

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
        qboRecords: 0,
        exactMatches: 0,
        probableMatches: 0,
        unmatchedItems: 0,
        duplicates: 0,
        bankDuplicates: 0,
        qboDuplicates: 0,
        dateVariances: 0,
        timingDifferences: 0,
        dataQualityIssues: 0,
        amountMismatches: 0,
        missingFromBank: 0,
        missingFromQBO: 0,
        unmatchedBankNetAmount: 0,
        unmatchedQboNetAmount: 0,
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
  }

  async findRunSummaryById(runId: string): Promise<SummaryMetrics | undefined> {
    const result = await this.pool.query<SummaryRow>(
      `SELECT total_records_reviewed, bank_records, qbo_records, exact_matches, probable_matches,
              unmatched_items, duplicates, bank_duplicates, qbo_duplicates, date_variances,
              timing_differences, data_quality_issues, amount_mismatches, missing_from_bank,
              missing_from_qbo, unmatched_bank_net_amount, unmatched_qbo_net_amount,
              clean_matched_amount, unresolved_exposure, counts_by_category_json,
              amount_by_category_json, charts_json
         FROM reconciliation_job_summary
        WHERE job_id = $1`,
      [runId],
    );

    const row = result.rows[0];
    return row ? mapSummary(row) : undefined;
  }

  async listRunExceptions(runId: string): Promise<ExceptionItem[]> {
    const result = await this.pool.query<ExceptionRow>(
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
  }

  async listRunExceptionsPage(runId: string, limit: number, offset: number): Promise<PaginatedExceptionsResult> {
    const [itemsResult, countResult] = await Promise.all([
      this.pool.query<ExceptionRow>(
        `SELECT id, category, severity, source_system, spreadsheet_file_name, line_number,
                transaction_date, amount, error_message, rule_trace_json, prior_rule_traces_json,
                recommended_next_actions, likely_matching_reference, reviewer_notes,
                match_confidence, normalized_comparison_tokens, related_transaction_ids
           FROM reconciliation_exception
          WHERE job_id = $1
          ORDER BY line_number ASC, id ASC
          LIMIT $2 OFFSET $3`,
        [runId, limit, offset],
      ),
      this.pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM reconciliation_exception WHERE job_id = $1',
        [runId],
      ),
    ]);

    const total = Number(countResult.rows[0]?.count ?? '0');
    const items = itemsResult.rows.map((row) => mapException(runId, row));

    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  }

  async listReviewerDecisions(runId: string): Promise<ReviewerDecision[]> {
    const result = await this.pool.query<ReviewerDecisionRow>(
      `SELECT id, target_type, target_id, outcome, final_category, notes, reviewer_id, reviewer_name, created_at, updated_at
         FROM reconciliation_review_decision
        WHERE job_id = $1
        ORDER BY created_at ASC, id ASC`,
      [runId],
    );

    return result.rows.map((row) => mapReviewerDecision(runId, row));
  }

  private async listSourceFiles(runId: string): Promise<SourceFile[]> {
    const result = await this.pool.query<SourceFileRow>(
      `SELECT id, source_system, file_name, mime_type, size_bytes, worksheet_name,
              header_row, transaction_start_row, excluded_row_numbers, uploaded_at
         FROM reconciliation_source_file
        WHERE job_id = $1
        ORDER BY uploaded_at ASC, id ASC`,
      [runId],
    );

    return result.rows.map(mapSourceFile);
  }

  private async listGroupedMatchResults(runId: string): Promise<GroupedMatchResult[]> {
    const result = await this.pool.query<GroupedMatchRow>(
      `SELECT id, disposition, confidence, category, bank_transaction_ids, qbo_transaction_ids,
              bank_members_json, qbo_members_json, total_amount, date_difference_days,
              score, rule_id, rule_name, reason, evidence_json
         FROM reconciliation_match_group
        WHERE job_id = $1
        ORDER BY created_at ASC, id ASC`,
      [runId],
    );

    return result.rows.map(mapGroupedMatch);
  }

  private async listProbableMatches(runId: string): Promise<MatchResult[]> {
    const result = await this.pool.query<MatchResultRow>(
      `SELECT id, bank_transaction_id, qbo_transaction_id, disposition, confidence, rule_id,
              rule_name, reason, score, amount_difference, date_difference_days,
              evidence_json, likely_matching_reference, exception_category
         FROM reconciliation_match_result
        WHERE job_id = $1
          AND result_bucket = 'PROBABLE'
        ORDER BY created_at ASC, id ASC`,
      [runId],
    );

    return result.rows.map(mapMatchResult);
  }

  private async listReviewerObservations(runId: string): Promise<ReviewerObservation[]> {
    const result = await this.pool.query<ReviewerObservationRow>(
      `SELECT id, category, title, message, severity, related_transaction_ids, created_at
         FROM reconciliation_review_observation
        WHERE job_id = $1
        ORDER BY created_at ASC, id ASC`,
      [runId],
    );

    return result.rows.map((row) => mapReviewerObservation(runId, row));
  }

  private async findOutputWorkbook(runId: string): Promise<OutputWorkbookManifest | undefined> {
    const result = await this.pool.query<ExportRow>(
      `SELECT file_name, generated_at, tab_names_json
         FROM reconciliation_export
        WHERE job_id = $1
          AND export_type = 'workbook'
        LIMIT 1`,
      [runId],
    );

    return mapOutputWorkbook(result.rows[0]);
  }
}