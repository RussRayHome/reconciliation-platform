import type {
  ExceptionItem,
  GroupedMatchResult,
  MatchResult,
  NormalizedTransaction,
  OutputWorkbook,
  RawTransactionRow,
  ReconciliationFrequency,
  ReviewerDecision,
  ReviewerObservation,
  SourceFile,
  SummaryMetrics,
} from '@recon/domain';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import {
  assertValidJobTransition,
  type ReconciliationJobState,
  type ReconciliationSourceFormat,
} from './stateMachine';

type PersistedSourceFileRegistration = {
  id: string;
  sourceSystem: 'bank' | 'gl';
  sourceFormat: ReconciliationSourceFormat;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageUri?: string;
  uploadedAt: string;
  /**
   * The uploaded file verbatim. Persisted to `reconciliation_source_file_content` inside the same
   * transaction as registration, so the bytes are durable before parsing has had a chance to fail —
   * which is precisely the case the preserved copy exists to survive.
   *
   * Omitting it registers the file with no recoverable original: `reconciliation_source_file_recovery`
   * will report the row as MISSING. Callers that hold the upload buffer should always pass it.
   */
  content?: Buffer;
  /**
   * How the file is normalized. 'DIRECT' (the default) means the built-in column configuration with
   * no mapping profile — the mode every import uses today. See changeset 0020.
   */
  ingestionMode?: 'DIRECT' | 'MAPPED';
};

/** Input to `createJob` — creates the job row and registers source file metadata. */
export interface CreateReconciliationJobInput {
  jobId: string;
  correlationId: string;
  startedAt: string;
  rulepackVersion: string;
  /** ADR-0001: the tenant this job belongs to. Every descendant row denormalizes this value,
   * resolved from the job row rather than re-passed by each caller -- see getJobOrganizationId. */
  organizationId: string;
  accountIdentifier?: string;
  periodLabel?: string;
  reconciliationFrequency?: ReconciliationFrequency;
  inputFingerprint?: string;
  sourceFiles: PersistedSourceFileRegistration[];
}

/** Input to `persistMatchingArtifacts` — pairwise and grouped match results with their rule evaluations. */
export interface PersistMatchingArtifactsInput {
  jobId: string;
  matchResults: MatchResult[];
  probableMatches: MatchResult[];
  groupedMatchResults: GroupedMatchResult[];
}

/** Input to `persistReviewArtifacts` — exception items, reviewer observations, and run summary. */
export interface PersistReviewArtifactsInput {
  jobId: string;
  exceptions: ExceptionItem[];
  reviewerObservations: ReviewerObservation[];
  summary: SummaryMetrics;
}

/** Input to `persistExportAndFinalize` — workbook binary metadata and audit event list. */
export interface PersistExportArtifactsInput {
  jobId: string;
  outputWorkbook: OutputWorkbook;
  completedAt: string;
  auditEvents: Array<{
    timestamp: string;
    action: string;
    details: Record<string, string | number | boolean | null>;
  }>;
}

/** Input to `markFailed` — transitions the job to FAILED or RETRY_PENDING with an error record. */
export interface MarkJobFailedInput {
  jobId: string;
  failedAt: string;
  errorMessage: string;
  errorCode?: string;
  nextState?: Extract<ReconciliationJobState, 'FAILED' | 'RETRY_PENDING'>;
}

type RuleResultRecord = {
  id: string;
  targetKind: 'MATCH_RESULT' | 'MATCH_GROUP' | 'EXCEPTION_ITEM';
  targetId: string;
  ruleId: string;
  ruleName: string;
  passed: boolean;
  score: number;
  reason: string;
  evidence: string[];
  candidateTransactionId?: string;
  evaluationOrder: number;
};

const DEFAULT_BATCH_SIZE = 500;

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
};

const buildInsertStatement = (
  tableName: string,
  columns: readonly string[],
  rows: ReadonlyArray<readonly unknown[]>,
  suffix = '',
): { text: string; values: unknown[] } => {
  const values: unknown[] = [];
  const valueSql = rows
    .map((row) => {
      const placeholders = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });

      return `(${placeholders.join(', ')})`;
    })
    .join(', ');

  return {
    text: `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${valueSql}${suffix}`,
    values,
  };
};

const hashJson = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Computes a hex-encoded SHA-256 digest of a binary or string value. Used for workbook checksums. */
export const computeSha256Hex = (value: Uint8Array | Buffer | string): string =>
  createHash('sha256').update(value).digest('hex');

const withTransaction = async <T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const lockJob = async (client: PoolClient, jobId: string): Promise<void> => {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [jobId]);
};

const getCurrentState = async (
  client: PoolClient,
  jobId: string,
): Promise<ReconciliationJobState> => {
  const result = await client.query<{ current_state: ReconciliationJobState }>(
    'SELECT current_state FROM reconciliation_job WHERE id = $1 FOR UPDATE',
    [jobId],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error(`reconciliation_job not found: ${jobId}`);
  }

  return row.current_state;
};

/** ADR-0001: resolves the tenant a job belongs to from the job row itself, so descendant writes
 * denormalize organization_id without every caller re-threading it through method signatures. */
const getJobOrganizationId = async (client: PoolClient, jobId: string): Promise<string> => {
  const result = await client.query<{ organization_id: string }>(
    'SELECT organization_id FROM reconciliation_job WHERE id = $1',
    [jobId],
  );
  const organizationId = result.rows[0]?.organization_id;

  if (!organizationId) {
    throw new Error(`reconciliation_job not found (or missing organization_id): ${jobId}`);
  }

  return organizationId;
};

const insertAuditEvent = async (
  client: PoolClient,
  jobId: string,
  organizationId: string,
  eventType: string,
  details: Record<string, unknown>,
  fromState?: ReconciliationJobState,
  toState?: ReconciliationJobState,
): Promise<void> => {
  await client.query(
    `INSERT INTO reconciliation_audit_event
      (job_id, organization_id, event_type, from_state, to_state, details_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [jobId, organizationId, eventType, fromState ?? null, toState ?? null, JSON.stringify(details)],
  );
};

const transitionJobState = async (
  client: PoolClient,
  jobId: string,
  organizationId: string,
  nextState: ReconciliationJobState,
  details: Record<string, unknown>,
): Promise<void> => {
  const currentState = await getCurrentState(client, jobId);
  assertValidJobTransition(currentState, nextState);

  await client.query(
    `UPDATE reconciliation_job
        SET current_state = $2,
            record_version = record_version + 1,
            updated_at = NOW(),
            completed_at = CASE WHEN $2 = 'FINALIZED' THEN COALESCE(completed_at, NOW()) ELSE completed_at END
      WHERE id = $1`,
    [jobId, nextState],
  );
  await insertAuditEvent(
    client,
    jobId,
    organizationId,
    'job.state.transitioned',
    details,
    currentState,
    nextState,
  );
};

/**
 * Preserves each uploaded file's bytes verbatim in `reconciliation_source_file_content`.
 *
 * Runs inside the registration transaction so the original is durable before any parsing is
 * attempted — a file that crashes the parser is exactly the one an operator needs to retrieve.
 *
 * Resolves the target row by the natural key `(job_id, source_system)` rather than trusting the
 * caller's generated id. The source-file insert upserts on that same natural key, so if a row
 * already existed it keeps its *original* id and the caller's freshly generated one is discarded —
 * keying the content insert off the caller's id would then violate the foreign key. The job state
 * machine currently rejects a second `createJob` for the same job (FILE_REGISTERED is terminal for
 * that transition), so this is defence in depth rather than a path exercised today.
 *
 * Files registered without a buffer are skipped; `reconciliation_source_file_recovery` reports them
 * as MISSING rather than silently implying a recoverable copy exists.
 *
 * @returns how many of the registered files carried bytes to preserve.
 */
const persistSourceFileContent = async (
  client: PoolClient,
  jobId: string,
  organizationId: string,
  sourceFiles: PersistedSourceFileRegistration[],
): Promise<number> => {
  let preservedCount = 0;

  for (const sourceFile of sourceFiles) {
    if (sourceFile.content === undefined) {
      continue;
    }

    await client.query(
      `INSERT INTO reconciliation_source_file_content
         (source_file_id, organization_id, content, byte_size, sha256, original_file_name, original_mime_type)
       SELECT id, $3, $4::bytea, $5, $6, $7, $8
         FROM reconciliation_source_file
        WHERE job_id = $1 AND source_system = $2
       ON CONFLICT (source_file_id) DO UPDATE
          SET content = EXCLUDED.content,
              byte_size = EXCLUDED.byte_size,
              sha256 = EXCLUDED.sha256,
              original_file_name = EXCLUDED.original_file_name,
              original_mime_type = EXCLUDED.original_mime_type,
              captured_at = NOW()`,
      [
        jobId,
        sourceFile.sourceSystem,
        organizationId,
        sourceFile.content,
        // Taken from the buffer itself rather than the caller-supplied sizeBytes so the value can
        // never disagree with what is stored; the table's octet_length CHECK would reject it anyway.
        sourceFile.content.byteLength,
        sourceFile.sha256,
        sourceFile.fileName,
        sourceFile.mimeType,
      ],
    );

    preservedCount += 1;
  }

  return preservedCount;
};

const upsertSourceFileDetails = async (
  client: PoolClient,
  sourceFiles: SourceFile[],
): Promise<void> => {
  for (const sourceFile of sourceFiles) {
    await client.query(
      `UPDATE reconciliation_source_file
          SET worksheet_name = $2,
              header_row = $3,
              transaction_start_row = $4,
              excluded_row_numbers = $5::jsonb,
              imported_row_count = $6,
              updated_at = NOW()
        WHERE id = $1`,
      [
        sourceFile.id,
        sourceFile.worksheetName,
        sourceFile.headerRow,
        sourceFile.transactionStartRow,
        JSON.stringify(sourceFile.excludedRowNumbers),
        0,
      ],
    );
  }
};

const buildRuleResultsFromMatches = (
  matchResults: MatchResult[],
  probableMatches: MatchResult[],
  groupedMatchResults: GroupedMatchResult[],
): RuleResultRecord[] => {
  const pairwise = [...matchResults, ...probableMatches].map((result, index) => ({
    id: randomUUID(),
    targetKind: 'MATCH_RESULT' as const,
    targetId: result.id,
    ruleId: result.ruleId ?? result.ruleName.toLowerCase().replaceAll(/\s+/g, '-'),
    ruleName: result.ruleName,
    passed: true,
    score: result.score,
    reason: result.reason ?? result.evidence.join(' '),
    evidence: result.evidence,
    candidateTransactionId: result.glTransactionId,
    evaluationOrder: index,
  }));

  const grouped = groupedMatchResults.map((result, index) => ({
    id: randomUUID(),
    targetKind: 'MATCH_GROUP' as const,
    targetId: result.id,
    ruleId: result.ruleId,
    ruleName: result.ruleName,
    passed: true,
    score: result.score,
    reason: result.reason,
    evidence: result.evidence,
    candidateTransactionId: result.glTransactionIds[0],
    evaluationOrder: index,
  }));

  return [...pairwise, ...grouped];
};

const buildRuleResultsFromExceptions = (exceptions: ExceptionItem[]): RuleResultRecord[] =>
  exceptions.flatMap((exception) => {
    const traces = [exception.ruleTrace, ...(exception.priorRuleTraces ?? [])].filter(
      (trace): trace is NonNullable<ExceptionItem['ruleTrace']> => Boolean(trace),
    );

    return traces.map((trace, index) => ({
      id: randomUUID(),
      targetKind: 'EXCEPTION_ITEM' as const,
      targetId: exception.id,
      ruleId: trace.ruleId,
      ruleName: trace.ruleName,
      passed: index === 0,
      score: index === 0 ? 1 : 0.5,
      reason: trace.reason,
      evidence: trace.evidence,
      candidateTransactionId: trace.counterpart?.transactionId,
      evaluationOrder: index,
    }));
  });

const toNullableDate = (value?: string): string | null => value ?? null;

/**
 * Writes all reconciliation artifacts to PostgreSQL, advancing the job state machine at each step.
 *
 * Every public method wraps its writes in a single transaction, acquires an advisory lock on the
 * job row, validates the state transition, performs the inserts/updates, and records an audit event.
 * This ensures the job can never skip a state and that partial writes are rolled back on error.
 *
 * Typical call sequence:
 *   1. `createJob`           — insert job + source file registrations → CREATED → FILE_REGISTERED
 *   2. `persistParsedRows`   — bulk-insert raw rows → IMPORTING → IMPORTED
 *   3. `persistNormalizedRows` — bulk-insert canonical rows → NORMALIZING → NORMALIZED
 *   4. `persistMatchingArtifacts` — insert match results + rule evaluations → MATCHING → MATCHED
 *   5. `persistReviewArtifacts`  — insert exceptions, observations, summary → EXCEPTIONS_IDENTIFIED → REVIEW_READY
 *   6. `persistExportAndFinalize` — insert export record + audit events → FINALIZED
 */
export class PostgresReconciliationLifecycleStore {
  /**
   * Creates a lifecycle store with optional batch-size tuning for bulk inserts.
   */
  constructor(
    private readonly pool: Pool,
    private readonly options: {
      rawRowBatchSize?: number;
      canonicalRowBatchSize?: number;
      resultBatchSize?: number;
      rulepackVersion?: string;
    } = {},
  ) {}

  /**
   * Persists a new reconciliation job and its registered source files.
   */
  async createJob(input: CreateReconciliationJobInput): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO reconciliation_job
          (id, correlation_id, organization_id, account_identifier, period_label, reconciliation_frequency, current_state, input_fingerprint, rulepack_version, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'CREATED', $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          input.jobId,
          input.correlationId,
          input.organizationId,
          input.accountIdentifier ?? null,
          input.periodLabel ?? null,
          input.reconciliationFrequency ?? null,
          input.inputFingerprint ?? null,
          input.rulepackVersion,
          input.startedAt,
        ],
      );

      const sourceFileRows = input.sourceFiles.map(
        (sourceFile) =>
          [
            sourceFile.id,
            input.jobId,
            input.organizationId,
            sourceFile.sourceSystem,
            sourceFile.sourceFormat,
            sourceFile.fileName,
            sourceFile.mimeType,
            sourceFile.sizeBytes,
            sourceFile.sha256,
            sourceFile.storageUri ?? null,
            sourceFile.uploadedAt,
            sourceFile.ingestionMode ?? 'DIRECT',
          ] as const,
      );

      const insertSourceFiles = buildInsertStatement(
        'reconciliation_source_file',
        [
          'id',
          'job_id',
          'organization_id',
          'source_system',
          'source_format',
          'file_name',
          'mime_type',
          'size_bytes',
          'sha256',
          'storage_uri',
          'uploaded_at',
          'ingestion_mode',
        ],
        sourceFileRows,
        ' ON CONFLICT (job_id, source_system) DO UPDATE SET sha256 = EXCLUDED.sha256, storage_uri = EXCLUDED.storage_uri, ingestion_mode = EXCLUDED.ingestion_mode, updated_at = NOW()',
      );
      await client.query(insertSourceFiles.text, insertSourceFiles.values);

      const contentPreservedCount = await persistSourceFileContent(
        client,
        input.jobId,
        input.organizationId,
        input.sourceFiles,
      );

      await transitionJobState(client, input.jobId, input.organizationId, 'FILE_REGISTERED', {
        sourceFileCount: input.sourceFiles.length,
        inputFingerprint: input.inputFingerprint ?? null,
        contentPreservedCount,
      });
    });
  }

  /**
   * Persists parsed raw spreadsheet rows and source-file import batch metadata.
   */
  async persistParsedRows(
    jobId: string,
    sourceFiles: SourceFile[],
    rawRows: RawTransactionRow[],
  ): Promise<void> {
    const rawRowBatchSize = this.options.rawRowBatchSize ?? DEFAULT_BATCH_SIZE;

    await withTransaction(this.pool, async (client) => {
      await lockJob(client, jobId);
      const organizationId = await getJobOrganizationId(client, jobId);
      await transitionJobState(client, jobId, organizationId, 'IMPORTING', {
        rawRowCount: rawRows.length,
      });
      await upsertSourceFileDetails(client, sourceFiles);

      for (const sourceFile of sourceFiles) {
        const rowsForSource = rawRows.filter((row) => row.sourceFileId === sourceFile.id);
        const batches = chunk(rowsForSource, rawRowBatchSize);

        await client.query(
          'UPDATE reconciliation_source_file SET imported_row_count = $2, updated_at = NOW() WHERE id = $1',
          [sourceFile.id, rowsForSource.length],
        );

        for (const [batchIndex, batchRows] of batches.entries()) {
          const batchId = randomUUID();
          await client.query(
            `INSERT INTO reconciliation_import_batch
              (id, job_id, organization_id, source_file_id, batch_number, state, row_start_number, row_end_number, row_count, started_at, completed_at)
             VALUES ($1, $2, $3, $4, $5, 'IMPORTED', $6, $7, $8, NOW(), NOW())`,
            [
              batchId,
              jobId,
              organizationId,
              sourceFile.id,
              batchIndex + 1,
              batchRows[0]?.lineNumber ?? 0,
              batchRows.at(-1)?.lineNumber ?? 0,
              batchRows.length,
            ],
          );

          const rawRowValues = batchRows.map(
            (row) =>
              [
                row.id,
                jobId,
                organizationId,
                row.sourceFileId,
                batchId,
                row.source,
                row.lineNumber,
                hashJson(row.rawValues),
                JSON.stringify(row.rawValues),
                row.transactionDateRaw ?? null,
                row.postingDateRaw ?? null,
                row.transactionTypeRaw ?? null,
                row.checkNumberRaw ?? null,
                row.serialNumberRaw ?? null,
                row.referenceNumberRaw ?? null,
                row.descriptionRaw ?? null,
                row.merchantNameRaw ?? null,
                row.payeeNameRaw ?? null,
                row.amountRaw ?? null,
                row.debitRaw ?? null,
                row.creditRaw ?? null,
                row.runningBalanceRaw ?? null,
                row.excluded,
                row.exclusionReason ?? null,
                JSON.stringify(row.parsingIssues),
              ] as const,
          );

          if (rawRowValues.length > 0) {
            const rawRowInsert = buildInsertStatement(
              'reconciliation_raw_row',
              [
                'id',
                'job_id',
                'organization_id',
                'source_file_id',
                'import_batch_id',
                'source_system',
                'line_number',
                'row_hash',
                'raw_values_json',
                'transaction_date_raw',
                'posting_date_raw',
                'transaction_type_raw',
                'check_number_raw',
                'serial_number_raw',
                'reference_number_raw',
                'description_raw',
                'merchant_name_raw',
                'payee_name_raw',
                'amount_raw',
                'debit_raw',
                'credit_raw',
                'running_balance_raw',
                'excluded',
                'exclusion_reason',
                'parsing_issues_json',
              ],
              rawRowValues,
            );
            await client.query(rawRowInsert.text, rawRowInsert.values);
          }
        }
      }

      await transitionJobState(client, jobId, organizationId, 'IMPORTED', {
        rawRowCount: rawRows.length,
      });
    });
  }

  /**
   * Persists normalized canonical transactions derived from raw imported rows.
   */
  async persistNormalizedRows(
    jobId: string,
    normalizedTransactions: NormalizedTransaction[],
  ): Promise<void> {
    const canonicalRowBatchSize = this.options.canonicalRowBatchSize ?? DEFAULT_BATCH_SIZE;

    await withTransaction(this.pool, async (client) => {
      await lockJob(client, jobId);
      const organizationId = await getJobOrganizationId(client, jobId);
      await transitionJobState(client, jobId, organizationId, 'NORMALIZING', {
        normalizedRowCount: normalizedTransactions.length,
      });

      for (const batch of chunk(normalizedTransactions, canonicalRowBatchSize)) {
        const rows = batch.map(
          (transaction) =>
            [
              transaction.id,
              jobId,
              organizationId,
              transaction.rawRowId,
              transaction.sourceFileId,
              transaction.source,
              transaction.spreadsheetFileName,
              transaction.worksheetName,
              transaction.lineNumber,
              toNullableDate(transaction.transactionDate),
              toNullableDate(transaction.postingDate),
              transaction.transactionType ?? null,
              transaction.checkNumber ?? null,
              transaction.serialNumber ?? null,
              transaction.referenceNumber ?? null,
              transaction.description ?? null,
              transaction.merchantName ?? null,
              transaction.payeeName ?? null,
              transaction.amount,
              transaction.debit,
              transaction.credit,
              transaction.runningBalance,
              transaction.normalizedComparisonText,
              transaction.normalizedComparisonTokens,
              transaction.normalizedReferenceTokens,
              JSON.stringify(transaction.rawSourceValues),
              JSON.stringify(transaction.dataQualityIssues),
              transaction.isExcluded,
              transaction.exclusionReason ?? null,
              transaction.isZeroAmount,
              transaction.contextFingerprint,
              transaction.accountIdentifier ?? null,
              transaction.reviewerNotes ?? null,
            ] as const,
        );

        const insert = buildInsertStatement(
          'reconciliation_canonical_row',
          [
            'id',
            'job_id',
            'organization_id',
            'raw_row_id',
            'source_file_id',
            'source_system',
            'spreadsheet_file_name',
            'worksheet_name',
            'line_number',
            'transaction_date',
            'posting_date',
            'transaction_type',
            'check_number',
            'serial_number',
            'reference_number',
            'description',
            'merchant_name',
            'payee_name',
            'amount',
            'debit',
            'credit',
            'running_balance',
            'normalized_comparison_text',
            'normalized_comparison_tokens',
            'normalized_reference_tokens',
            'raw_source_values_json',
            'data_quality_issues_json',
            'is_excluded',
            'exclusion_reason',
            'is_zero_amount',
            'context_fingerprint',
            'account_identifier',
            'reviewer_notes',
          ],
          rows,
        );
        await client.query(insert.text, insert.values);
      }

      await transitionJobState(client, jobId, organizationId, 'NORMALIZED', {
        normalizedRowCount: normalizedTransactions.length,
      });
    });
  }

  /**
   * Persists grouped and pairwise match artifacts plus derived rule-evaluation records.
   */
  async persistMatchingArtifacts(input: PersistMatchingArtifactsInput): Promise<void> {
    const resultBatchSize = this.options.resultBatchSize ?? DEFAULT_BATCH_SIZE;

    await withTransaction(this.pool, async (client) => {
      await lockJob(client, input.jobId);
      const organizationId = await getJobOrganizationId(client, input.jobId);
      await transitionJobState(client, input.jobId, organizationId, 'MATCHING', {
        pairwiseMatchCount: input.matchResults.length,
        probableMatchCount: input.probableMatches.length,
        groupedMatchCount: input.groupedMatchResults.length,
      });

      if (input.groupedMatchResults.length > 0) {
        const groupRows = input.groupedMatchResults.map(
          (result) =>
            [
              result.id,
              input.jobId,
              organizationId,
              result.disposition,
              result.confidence,
              result.category ?? null,
              result.bankTransactionIds,
              result.glTransactionIds,
              JSON.stringify(result.bankMembers),
              JSON.stringify(result.glMembers),
              result.totalAmount,
              result.dateDifferenceDays ?? null,
              result.score,
              result.ruleId,
              result.ruleName,
              result.reason,
              JSON.stringify(result.evidence),
            ] as const,
        );

        const insertGroups = buildInsertStatement(
          'reconciliation_match_group',
          [
            'id',
            'job_id',
            'organization_id',
            'disposition',
            'confidence',
            'category',
            'bank_transaction_ids',
            'gl_transaction_ids',
            'bank_members_json',
            'gl_members_json',
            'total_amount',
            'date_difference_days',
            'score',
            'rule_id',
            'rule_name',
            'reason',
            'evidence_json',
          ],
          groupRows,
        );
        await client.query(insertGroups.text, insertGroups.values);
      }

      const probableMatchIds = new Set(input.probableMatches.map((result) => result.id));
      const pairwiseRows = [
        ...input.matchResults
          .filter((result) => !probableMatchIds.has(result.id))
          .map((result) => ({ result, bucket: 'MATCH' as const })),
        ...input.probableMatches.map((result) => ({ result, bucket: 'PROBABLE' as const })),
      ];

      for (const batch of chunk(pairwiseRows, resultBatchSize)) {
        const values = batch.map(
          ({ result, bucket }) =>
            [
              result.id,
              input.jobId,
              organizationId,
              bucket,
              result.bankTransactionId ?? null,
              result.glTransactionId ?? null,
              result.disposition,
              result.confidence,
              result.ruleId ?? null,
              result.ruleName,
              result.reason ?? null,
              result.score,
              result.amountDifference,
              result.dateDifferenceDays ?? null,
              JSON.stringify(result.evidence),
              result.likelyMatchingReference ?? null,
              result.exceptionCategory ?? null,
            ] as const,
        );

        const insert = buildInsertStatement(
          'reconciliation_match_result',
          [
            'id',
            'job_id',
            'organization_id',
            'result_bucket',
            'bank_transaction_id',
            'gl_transaction_id',
            'disposition',
            'confidence',
            'rule_id',
            'rule_name',
            'reason',
            'score',
            'amount_difference',
            'date_difference_days',
            'evidence_json',
            'likely_matching_reference',
            'exception_category',
          ],
          values,
        );
        await client.query(insert.text, insert.values);
      }

      const ruleResults = buildRuleResultsFromMatches(
        input.matchResults,
        input.probableMatches,
        input.groupedMatchResults,
      );
      if (ruleResults.length > 0) {
        const ruleRows = ruleResults.map(
          (ruleResult) =>
            [
              ruleResult.id,
              input.jobId,
              organizationId,
              ruleResult.targetKind,
              ruleResult.targetId,
              ruleResult.ruleId,
              ruleResult.ruleName,
              ruleResult.passed,
              ruleResult.score,
              ruleResult.reason,
              JSON.stringify(ruleResult.evidence),
              ruleResult.candidateTransactionId ?? null,
              ruleResult.evaluationOrder,
            ] as const,
        );

        const insertRules = buildInsertStatement(
          'reconciliation_rule_result',
          [
            'id',
            'job_id',
            'organization_id',
            'target_kind',
            'target_id',
            'rule_id',
            'rule_name',
            'passed',
            'score',
            'reason',
            'evidence_json',
            'candidate_transaction_id',
            'evaluation_order',
          ],
          ruleRows,
        );
        await client.query(insertRules.text, insertRules.values);
      }

      await transitionJobState(client, input.jobId, organizationId, 'MATCHED', {
        pairwiseMatchCount: input.matchResults.length,
        probableMatchCount: input.probableMatches.length,
        groupedMatchCount: input.groupedMatchResults.length,
      });
    });
  }

  /**
   * Persists exception/review artifacts and upserts run summary metrics.
   */
  async persistReviewArtifacts(input: PersistReviewArtifactsInput): Promise<void> {
    const resultBatchSize = this.options.resultBatchSize ?? DEFAULT_BATCH_SIZE;

    await withTransaction(this.pool, async (client) => {
      await lockJob(client, input.jobId);
      const organizationId = await getJobOrganizationId(client, input.jobId);
      await transitionJobState(client, input.jobId, organizationId, 'EXCEPTIONS_IDENTIFIED', {
        exceptionCount: input.exceptions.length,
      });

      for (const batch of chunk(input.exceptions, resultBatchSize)) {
        const values = batch.map(
          (exception) =>
            [
              exception.id,
              input.jobId,
              organizationId,
              exception.relatedTransactionIds[0] ?? null,
              exception.category,
              exception.severity,
              exception.source,
              exception.spreadsheetFileName,
              exception.lineNumber,
              toNullableDate(exception.transactionDate),
              exception.amount,
              exception.errorMessage,
              exception.ruleTrace ? JSON.stringify(exception.ruleTrace) : null,
              JSON.stringify(exception.priorRuleTraces ?? []),
              exception.recommendedNextActions,
              exception.likelyMatchingReference ?? null,
              exception.reviewerNotes ?? null,
              exception.matchConfidence ?? null,
              exception.normalizedComparisonTokens,
              exception.relatedTransactionIds,
            ] as const,
        );

        const insert = buildInsertStatement(
          'reconciliation_exception',
          [
            'id',
            'job_id',
            'organization_id',
            'canonical_row_id',
            'category',
            'severity',
            'source_system',
            'spreadsheet_file_name',
            'line_number',
            'transaction_date',
            'amount',
            'error_message',
            'rule_trace_json',
            'prior_rule_traces_json',
            'recommended_next_actions',
            'likely_matching_reference',
            'reviewer_notes',
            'match_confidence',
            'normalized_comparison_tokens',
            'related_transaction_ids',
          ],
          values,
        );
        await client.query(insert.text, insert.values);
      }

      if (input.reviewerObservations.length > 0) {
        const observationRows = input.reviewerObservations.map(
          (observation) =>
            [
              observation.id,
              input.jobId,
              organizationId,
              observation.category,
              observation.title,
              observation.message,
              observation.severity,
              observation.relatedTransactionIds,
              observation.createdAt,
            ] as const,
        );
        const insertObservations = buildInsertStatement(
          'reconciliation_review_observation',
          [
            'id',
            'job_id',
            'organization_id',
            'category',
            'title',
            'message',
            'severity',
            'related_transaction_ids',
            'created_at',
          ],
          observationRows,
        );
        await client.query(insertObservations.text, insertObservations.values);
      }

      const ruleResults = buildRuleResultsFromExceptions(input.exceptions);
      if (ruleResults.length > 0) {
        const ruleRows = ruleResults.map(
          (ruleResult) =>
            [
              ruleResult.id,
              input.jobId,
              organizationId,
              ruleResult.targetKind,
              ruleResult.targetId,
              ruleResult.ruleId,
              ruleResult.ruleName,
              ruleResult.passed,
              ruleResult.score,
              ruleResult.reason,
              JSON.stringify(ruleResult.evidence),
              ruleResult.candidateTransactionId ?? null,
              ruleResult.evaluationOrder,
            ] as const,
        );
        const insertRules = buildInsertStatement(
          'reconciliation_rule_result',
          [
            'id',
            'job_id',
            'organization_id',
            'target_kind',
            'target_id',
            'rule_id',
            'rule_name',
            'passed',
            'score',
            'reason',
            'evidence_json',
            'candidate_transaction_id',
            'evaluation_order',
          ],
          ruleRows,
        );
        await client.query(insertRules.text, insertRules.values);
      }

      await client.query(
        `INSERT INTO reconciliation_job_summary (
            job_id,
            organization_id,
            total_records_reviewed,
            bank_records,
            gl_records,
            exact_matches,
            probable_matches,
            unmatched_items,
            duplicates,
            bank_duplicates,
            gl_duplicates,
            date_variances,
            timing_differences,
            data_quality_issues,
            amount_mismatches,
            missing_from_bank,
            missing_from_gl,
            unmatched_bank_net_amount,
            unmatched_gl_net_amount,
            clean_matched_amount,
            unresolved_exposure,
            counts_by_category_json,
            amount_by_category_json,
            charts_json,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22::jsonb, $23::jsonb, $24::jsonb, NOW()
          )
          ON CONFLICT (job_id) DO UPDATE SET
            total_records_reviewed = EXCLUDED.total_records_reviewed,
            bank_records = EXCLUDED.bank_records,
            gl_records = EXCLUDED.gl_records,
            exact_matches = EXCLUDED.exact_matches,
            probable_matches = EXCLUDED.probable_matches,
            unmatched_items = EXCLUDED.unmatched_items,
            duplicates = EXCLUDED.duplicates,
            bank_duplicates = EXCLUDED.bank_duplicates,
            gl_duplicates = EXCLUDED.gl_duplicates,
            date_variances = EXCLUDED.date_variances,
            timing_differences = EXCLUDED.timing_differences,
            data_quality_issues = EXCLUDED.data_quality_issues,
            amount_mismatches = EXCLUDED.amount_mismatches,
            missing_from_bank = EXCLUDED.missing_from_bank,
            missing_from_gl = EXCLUDED.missing_from_gl,
            unmatched_bank_net_amount = EXCLUDED.unmatched_bank_net_amount,
            unmatched_gl_net_amount = EXCLUDED.unmatched_gl_net_amount,
            clean_matched_amount = EXCLUDED.clean_matched_amount,
            unresolved_exposure = EXCLUDED.unresolved_exposure,
            counts_by_category_json = EXCLUDED.counts_by_category_json,
            amount_by_category_json = EXCLUDED.amount_by_category_json,
            charts_json = EXCLUDED.charts_json,
            updated_at = NOW()`,
        [
          input.jobId,
          organizationId,
          input.summary.totalRecordsReviewed,
          input.summary.bankRecords,
          input.summary.glRecords,
          input.summary.exactMatches,
          input.summary.probableMatches,
          input.summary.unmatchedItems,
          input.summary.duplicates,
          input.summary.bankDuplicates,
          input.summary.glDuplicates,
          input.summary.dateVariances,
          input.summary.timingDifferences,
          input.summary.dataQualityIssues,
          input.summary.amountMismatches,
          input.summary.missingFromBank,
          input.summary.missingFromGL,
          input.summary.unmatchedBankNetAmount,
          input.summary.unmatchedGlNetAmount,
          input.summary.cleanMatchedAmount,
          input.summary.unresolvedExposure,
          JSON.stringify(input.summary.countsByCategory),
          JSON.stringify(input.summary.amountByCategory),
          JSON.stringify(input.summary.charts),
        ],
      );

      await transitionJobState(client, input.jobId, organizationId, 'REVIEW_READY', {
        exceptionCount: input.exceptions.length,
        observationCount: input.reviewerObservations.length,
      });
    });
  }

  /**
   * Persists export metadata, appends audit events, and finalizes the reconciliation job.
   */
  async persistExportAndFinalize(input: PersistExportArtifactsInput): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await lockJob(client, input.jobId);
      const organizationId = await getJobOrganizationId(client, input.jobId);

      await client.query(
        `INSERT INTO reconciliation_export
          (id, job_id, organization_id, export_type, state, file_name, checksum_sha256, byte_size, tab_names_json, generated_at)
         VALUES ($1, $2, $3, 'workbook', 'READY', $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (job_id, export_type) DO UPDATE SET
           state = EXCLUDED.state,
           file_name = EXCLUDED.file_name,
           checksum_sha256 = EXCLUDED.checksum_sha256,
           byte_size = EXCLUDED.byte_size,
           tab_names_json = EXCLUDED.tab_names_json,
           generated_at = EXCLUDED.generated_at`,
        [
          randomUUID(),
          input.jobId,
          organizationId,
          input.outputWorkbook.fileName,
          computeSha256Hex(input.outputWorkbook.binary),
          input.outputWorkbook.binary.byteLength,
          JSON.stringify(input.outputWorkbook.tabNames),
          input.outputWorkbook.generatedAt,
        ],
      );

      for (const auditEvent of input.auditEvents) {
        await insertAuditEvent(
          client,
          input.jobId,
          organizationId,
          auditEvent.action,
          auditEvent.details,
        );
      }

      await client.query(
        'UPDATE reconciliation_job SET completed_at = $2, updated_at = NOW() WHERE id = $1',
        [input.jobId, input.completedAt],
      );
      await transitionJobState(client, input.jobId, organizationId, 'FINALIZED', {
        exportFileName: input.outputWorkbook.fileName,
        exportByteSize: input.outputWorkbook.binary.byteLength,
      });
    });
  }

  /**
   * Persists or updates a reviewer decision for a run target and records an audit event.
   */
  async persistReviewerDecision(decision: ReviewerDecision): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await lockJob(client, decision.runId);
      const organizationId = await getJobOrganizationId(client, decision.runId);
      await client.query(
        `INSERT INTO reconciliation_review_decision
          (id, job_id, organization_id, target_type, target_id, outcome, final_category, notes, reviewer_id, reviewer_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (job_id, target_type, target_id) DO UPDATE SET
           outcome = EXCLUDED.outcome,
           final_category = EXCLUDED.final_category,
           notes = EXCLUDED.notes,
           reviewer_id = EXCLUDED.reviewer_id,
           reviewer_name = EXCLUDED.reviewer_name,
           updated_at = EXCLUDED.updated_at,
           record_version = reconciliation_review_decision.record_version + 1`,
        [
          decision.id,
          decision.runId,
          organizationId,
          decision.targetType,
          decision.targetId,
          decision.outcome,
          decision.finalCategory ?? null,
          decision.notes ?? null,
          decision.reviewerId ?? null,
          decision.reviewerName ?? null,
          decision.createdAt,
          decision.updatedAt,
        ],
      );

      await insertAuditEvent(client, decision.runId, organizationId, 'review.decision.persisted', {
        targetType: decision.targetType,
        targetId: decision.targetId,
        outcome: decision.outcome,
      });
    });
  }

  /**
   * Removes a reviewer decision for a run/target, returning the target to an undecided state.
   * Idempotent: a no-op when no matching decision exists.
   */
  async deleteReviewerDecision(
    runId: string,
    targetType: ReviewerDecision['targetType'],
    targetId: string,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await lockJob(client, runId);
      const organizationId = await getJobOrganizationId(client, runId);
      await client.query(
        `DELETE FROM reconciliation_review_decision
         WHERE job_id = $1 AND target_type = $2 AND target_id = $3`,
        [runId, targetType, targetId],
      );

      await insertAuditEvent(client, runId, organizationId, 'review.decision.cleared', {
        targetType,
        targetId,
      });
    });
  }

  /**
   * Marks a reconciliation job as failed (or retry-pending) with failure diagnostics.
   */
  async markFailed(input: MarkJobFailedInput): Promise<void> {
    const nextState = input.nextState ?? 'FAILED';

    await withTransaction(this.pool, async (client) => {
      await lockJob(client, input.jobId);
      const organizationId = await getJobOrganizationId(client, input.jobId);
      const currentState = await getCurrentState(client, input.jobId);
      assertValidJobTransition(currentState, nextState);

      await client.query(
        `UPDATE reconciliation_job
            SET current_state = $2,
                failure_code = $3,
                failure_message = $4,
                updated_at = NOW(),
                completed_at = COALESCE(completed_at, $5),
                retry_count = CASE WHEN $2 = 'RETRY_PENDING' THEN retry_count + 1 ELSE retry_count END,
                record_version = record_version + 1
          WHERE id = $1`,
        [input.jobId, nextState, input.errorCode ?? null, input.errorMessage, input.failedAt],
      );
      await insertAuditEvent(
        client,
        input.jobId,
        organizationId,
        'job.failed',
        { errorCode: input.errorCode ?? null, errorMessage: input.errorMessage },
        currentState,
        nextState,
      );
    });
  }
}
