import type {
  ApprovableType,
  ApprovalCountsByGroup,
  ApprovalRow,
  ErrorCategory,
  ImportApprovalStatus,
  ReconciliationRun,
  ReconciliationRunReport,
  ReviewerDecision,
  ReviewerDecisionOutcome,
  ReviewerDecisionTargetType,
  RuleVersionsResponse,
  SeverityLevel,
  UserRole,
} from '@recon/domain';
import { rolePermissionsByRole } from '@recon/domain';
import {
  claimApprovalRequest,
  claimImportApproval,
  computeSha256Hex,
  createApprovalRequest,
  createMappingProfile,
  createMappingProfileVersion,
  createMatchingConfigVersionDraft,
  createPayeeAlias,
  deactivatePayeeAlias,
  findMappingProfile,
  getApprovalRequestCounts,
  getImportApprovalCounts,
  getMappingProfileDetail,
  listApprovalRequests,
  listImportApprovals,
  listMappingProfiles,
  listMappingProfileVersions,
  listMatchingConfigVersions,
  loadPayeeAliases,
  PostgresBlobStorage,
  PostgresImportRunStore,
  PostgresImportValidationStore,
  PostgresOpenItemStore,
  publishMatchingConfigVersion,
  recordApprovalDecision,
  recordApprovalRequestDecision,
  recordLoginEvent,
  retireMappingProfile,
  updatePayeeAlias,
  type ApprovalRequestRecord,
  type CreateImportRunFileInput,
  type CreatePayeeAliasInput,
  type ExceptionPageFilters,
  type GenericApprovableType,
  type ImportApprovalListItem,
  type ListApprovalRequestsFilter,
  type ListImportApprovalsFilter,
  type ListRunApprovalsFilter,
  type PaginatedExceptionsResult,
  type PostgresReconciliationLifecycleStore,
  type PostgresReconciliationReadModelStore,
  type RunApprovalListItem,
} from '@recon/persistence';
import {
  BankFileCountError,
  BankFilenameAccountParseError,
  BankFileStructuralError,
  MAX_BANK_ACCOUNTS,
  MIN_BANK_ACCOUNTS,
  mergeBankFiles,
  toNormalizedTransactions,
  toRawTransactionRows,
  validateFile,
  type ValidationIssue,
} from '@recon/core';
import type { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { recordReconciliationRun } from './services/runtimeDiagnostics';
import { CANONICAL_FIELDS } from './services/canonicalFields';
import {
  OVERRIDES_APPLIED_TO_ENGINE,
  RULES_CATALOG,
  RULES_CATALOG_METRIC_IDS,
} from './services/rulesCatalog';
import {
  AUTH_TOKEN_TTL_SECONDS,
  DUMMY_PASSWORD_HASH,
  denylistToken,
  hashPassword,
  isProductionRuntime,
  signAuthToken,
  verifyPassword,
  type DenylistRedisClient,
} from './services/authService';
import {
  createAuthMiddleware,
  createRequireFullyVerified,
  requireApplicationAccess,
} from './services/authMiddleware';
import { resolveEntityVerificationProvider } from './services/entityVerificationService';
import {
  generateIdentityCode,
  resolveNotificationChannel,
  verifyIdentityCode,
} from './services/identityVerificationService';
import { resolveLogLevelAtLeastInfo } from './services/logLevel';
import { logRedactOptions } from './services/logRedaction';
import {
  createImportValidationProducer,
  createImportValidationQueueEvents,
  type QueuedImportValidationResult,
} from './services/importValidationQueue';
import {
  runImportValidationWorkflow,
  type ImportValidationTriggerFile,
} from './services/importValidationService';
import {
  buildErrorReportCsv,
  buildImportFileFailureDetail,
} from './services/importFailureDetailService';
import { buildImportRowGrid } from './services/importRowGridService';
import {
  createReconciliationProducer,
  createReconciliationQueueEvents,
  type QueuedReconciliationFilePayload,
  type QueuedReconciliationResult,
} from './services/reconciliationQueue';
import { captureApiException, flushApiSentry, initializeApiSentry } from './services/sentry';
import {
  aliasesQuerySchema,
  approvalDecisionBodySchema,
  approvalsQuerySchema,
  createAliasBodySchema,
  entityVerificationCheckBodySchema,
  exceptionsQuerySchema,
  identityConfirmBodySchema,
  importRunBodySchema,
  importRunPartialImportBodySchema,
  isErrorCategory,
  loginBodySchema,
  matchingConfigVersionDraftBodySchema,
  publishMatchingConfigVersionBodySchema,
  reconciliationRunBodySchema,
  respondWithValidationError,
  reviewerDecisionBodySchema,
  reviewerDecisionDeleteParamsSchema,
  reviewerDecisionDeleteQuerySchema,
  runIssuesQuerySchema,
  runRecordsQuerySchema,
  saveMappingProfileBodySchema,
  signupBodySchema,
  updateAliasBodySchema,
  writeOffOpenItemBodySchema,
} from './validation';

import { InMemoryRunRepository } from './services/runRepository';
import cors from 'cors';
import { executeReconciliationFromNormalized } from './services/reconciliationService';
import type { QueueProgressMessage, QueueStepReporter } from './services/queueProgress';
import { defaultReconciliationConfig } from '@recon/config';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { createApiMetrics } from './services/apiMetrics';

const acceptedMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

type UploadFileMap = {
  bankFile?: Express.Multer.File[];
  glFile?: Express.Multer.File[];
};

type ReconciliationRequestInput = {
  accountIdentifier?: string;
  periodLabel?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
  varianceOverrides?: Record<string, number>;
};

type ReconciliationUploadFiles = {
  bankFile: Express.Multer.File;
  glFile: Express.Multer.File;
};

type QueuedReconciliationFiles = {
  bankFile: QueuedReconciliationFilePayload;
  glFile: QueuedReconciliationFilePayload;
};

type LifecycleRegistrationContext = {
  runId: string;
  bankSourceFileId: string;
  glSourceFileId: string;
};

type ReconciliationWorkflowResult = ReconciliationRequestInput & {
  persistenceJobId: string;
  run: ReconciliationRun;
};

type ReconciliationJobEnqueueResponse = {
  jobId: string;
  status: 'queued';
};

const invalidLoginMessage = 'The user or password does not match.';

/** ADR-0002 step 7: username == password, so this must never be reachable in production. Gated
 * behind an explicit opt-in flag (see `localLoginFallbackEnabled` in createApp) rather than the
 * mere absence of a DB pool, and `createApp` throws at startup if both that flag and production
 * are set together. */
const LOCAL_LOGIN_FALLBACK_ORGANIZATION_ID = 'local-dev-fallback';

const localLoginUsers: Record<
  string,
  { password: string; firstName: string; lastName: string; role: UserRole }
> = {
  rray: {
    password: 'rray',
    firstName: 'rray',
    lastName: '',
    role: 'superuser',
  },
  rray3: {
    password: 'rray3',
    firstName: 'rray3',
    lastName: '',
    role: 'admin',
  },
  bray: {
    password: 'bray',
    firstName: 'bray',
    lastName: '',
    role: 'financial-analyst',
  },
  // senior-analyst, mirroring create-users.psql's real-DB seed of the same account -- bray
  // (financial-analyst) can't submit an import run (canSubmitImportRuns), so upload/submit-flow
  // tests need this account instead.
  bray2: {
    password: 'P@ssw0rd',
    firstName: 'bray2',
    lastName: '',
    role: 'senior-analyst',
  },
};

const findDecisionTarget = (
  run: Pick<ReconciliationRunReport, 'exceptions' | 'probableMatches'>,
  targetType: ReviewerDecisionTargetType,
  targetId: string,
): boolean => {
  if (targetType === 'ExceptionItem') {
    return run.exceptions.some((item) => item.id === targetId);
  }

  if (targetType === 'ProbableMatch') {
    return run.probableMatches.some(
      (item) => item.id === targetId && item.disposition === 'ProbableMatch',
    );
  }

  if (targetType === 'AmbiguousReview') {
    return run.probableMatches.some(
      (item) => item.id === targetId && item.disposition === 'AmbiguousReview',
    );
  }

  return false;
};

const cleanOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const authenticateWithLocalUsers = (
  username: string,
  password: string,
): { username: string; firstName: string; lastName: string; role: UserRole } | null => {
  const localUser = localLoginUsers[username];

  if (localUser?.password !== password) {
    return null;
  }

  return {
    username,
    firstName: localUser.firstName,
    lastName: localUser.lastName,
    role: localUser.role,
  };
};

const resolveCorrelationId = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  return randomUUID();
};

const resolveSourceFormat = (fileName: string): 'xlsx' | 'csv' =>
  fileName.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';

const buildInputFingerprint = (input: {
  accountIdentifier?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
  periodLabel?: string;
  bankSha256: string;
  glSha256: string;
}): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        accountIdentifier: input.accountIdentifier ?? null,
        reconciliationFrequency: input.reconciliationFrequency ?? null,
        periodLabel: input.periodLabel ?? null,
        bankSha256: input.bankSha256,
        glSha256: input.glSha256,
      }),
    )
    .digest('hex');

const getUploadedReconciliationFiles = (files: UploadFileMap): ReconciliationUploadFiles | null => {
  const bankFile = files.bankFile?.[0];
  const glFile = files.glFile?.[0];

  if (!bankFile || !glFile) {
    return null;
  }

  return { bankFile, glFile };
};

/** `/api/imports/runs` only -- deliberately separate from `UploadFileMap`/
 * `getUploadedReconciliationFiles` above, which the unrelated legacy `/api/reconciliation/run`
 * route also uses for its single-bank-file shape (Issue #141 does not touch that route).
 * `bankFiles` is one repeated multer field (Issue #153: 1-4 bank accounts), not per-slot named
 * fields -- `request.files.bankFiles` arrives as a plain array. */
type ImportRunUploadFileMap = {
  bankFiles?: Express.Multer.File[];
  glFile?: Express.Multer.File[];
};

type ImportRunUploadFiles = {
  bankFiles: Express.Multer.File[];
  glFile: Express.Multer.File;
};

const getUploadedImportRunFiles = (files: ImportRunUploadFileMap): ImportRunUploadFiles | null => {
  const bankFiles = files.bankFiles ?? [];
  const glFile = files.glFile?.[0];

  if (bankFiles.length < MIN_BANK_ACCOUNTS || bankFiles.length > MAX_BANK_ACCOUNTS || !glFile) {
    return null;
  }

  return { bankFiles, glFile };
};

const toQueuedReconciliationFiles = (
  files: ReconciliationUploadFiles,
): QueuedReconciliationFiles => ({
  bankFile: {
    originalname: files.bankFile.originalname,
    mimetype: files.bankFile.mimetype,
    buffer: files.bankFile.buffer.toString('base64'),
  },
  glFile: {
    originalname: files.glFile.originalname,
    mimetype: files.glFile.mimetype,
    buffer: files.glFile.buffer.toString('base64'),
  },
});

/** Exported for `worker.ts` (Issue #134 phase 3). */
export const fromQueuedReconciliationFiles = (
  files: QueuedReconciliationFiles,
): ReconciliationUploadFiles => {
  const bankBuffer = Buffer.from(files.bankFile.buffer, 'base64');
  const glBuffer = Buffer.from(files.glFile.buffer, 'base64');

  return {
    bankFile: {
      fieldname: 'bankFile',
      originalname: files.bankFile.originalname,
      encoding: '7bit',
      mimetype: files.bankFile.mimetype,
      size: bankBuffer.byteLength,
      buffer: bankBuffer,
      destination: '',
      filename: files.bankFile.originalname,
      path: '',
      stream: Readable.from(bankBuffer),
    },
    glFile: {
      fieldname: 'glFile',
      originalname: files.glFile.originalname,
      encoding: '7bit',
      mimetype: files.glFile.mimetype,
      size: glBuffer.byteLength,
      buffer: glBuffer,
      destination: '',
      filename: files.glFile.originalname,
      path: '',
      stream: Readable.from(glBuffer),
    },
  };
};

/** Issue #137: File-Validation-sourced files have no worksheet/header-row/exclusion concept of
 * their own (that was the old alias-based pathway's XLSX-specific notion) -- these are fixed
 * placeholders for the `SourceFile` shape `executeReconciliationFromNormalized` still needs for
 * audit/export display, matching the row-1-header/row-2-data convention every File Validation
 * input already follows (docs/transaction-csv-spec.md §4). */
const FILE_VALIDATION_SOURCE_FILE_DEFAULTS = {
  worksheetName: '',
  headerRow: 1,
  transactionStartRow: 2,
  excludedRowNumbers: [] as number[],
};

const mimeTypeForFileName = (fileName: string): string =>
  resolveSourceFormat(fileName) === 'csv'
    ? 'text/csv'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const sanitizeQueuedReconciliationResult = (
  queuedResult: QueuedReconciliationResult,
): QueuedReconciliationResult => ({
  status: queuedResult.status,
  run: queuedResult.run,
  runId: queuedResult.runId,
  failedAt: queuedResult.failedAt,
  reason: queuedResult.reason,
});

const parseVarianceOverrides = (value: unknown): Record<string, number> | undefined => {
  const source =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return undefined;
          }
        })()
      : value;

  if (!source || typeof source !== 'object') {
    return undefined;
  }

  const overrides: Record<string, number> = {};

  for (const [metricId, metricValue] of Object.entries(source as Record<string, unknown>)) {
    if (typeof metricValue === 'number' && Number.isFinite(metricValue)) {
      overrides[metricId] = metricValue;
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
};

const parseReconciliationRequestInput = (
  body: Record<string, unknown>,
): ReconciliationRequestInput => {
  // `.catch()` on every field in this schema means parsing never throws.
  const parsed = reconciliationRunBodySchema.parse(body);

  return {
    accountIdentifier: parsed.accountIdentifier,
    periodLabel: parsed.periodLabel,
    reconciliationFrequency: parsed.reconciliationFrequency,
    varianceOverrides: parseVarianceOverrides(body.varianceOverrides),
  };
};

const registerLifecycleJob = async (
  lifecycleStore: PostgresReconciliationLifecycleStore | undefined,
  correlationId: string,
  organizationId: string,
  input: ReconciliationRequestInput,
  files: ReconciliationUploadFiles,
): Promise<LifecycleRegistrationContext> => {
  const runId = randomUUID();
  const bankSourceFileId = randomUUID();
  const glSourceFileId = randomUUID();

  if (!lifecycleStore) {
    return { runId, bankSourceFileId, glSourceFileId };
  }

  const startedAt = new Date().toISOString();
  const bankSha256 = computeSha256Hex(files.bankFile.buffer);
  const glSha256 = computeSha256Hex(files.glFile.buffer);

  await lifecycleStore.createJob({
    jobId: runId,
    correlationId,
    organizationId,
    startedAt,
    rulepackVersion: '2026-04-06',
    accountIdentifier: input.accountIdentifier,
    periodLabel: input.periodLabel,
    reconciliationFrequency: input.reconciliationFrequency,
    inputFingerprint: buildInputFingerprint({
      accountIdentifier: input.accountIdentifier,
      reconciliationFrequency: input.reconciliationFrequency,
      periodLabel: input.periodLabel,
      bankSha256,
      glSha256,
    }),
    sourceFiles: [
      {
        id: bankSourceFileId,
        sourceSystem: 'bank',
        sourceFormat: resolveSourceFormat(files.bankFile.originalname),
        fileName: files.bankFile.originalname,
        mimeType: files.bankFile.mimetype,
        sizeBytes: files.bankFile.size,
        sha256: bankSha256,
        uploadedAt: startedAt,
        // multer holds uploads in memory, so these bytes are gone the moment the request ends.
        // Handing them to createJob preserves the original before parsing can fail.
        content: files.bankFile.buffer,
      },
      {
        id: glSourceFileId,
        sourceSystem: 'gl',
        sourceFormat: resolveSourceFormat(files.glFile.originalname),
        fileName: files.glFile.originalname,
        mimeType: files.glFile.mimetype,
        sizeBytes: files.glFile.size,
        sha256: glSha256,
        uploadedAt: startedAt,
        content: files.glFile.buffer,
      },
    ],
  });

  return { runId, bankSourceFileId, glSourceFileId };
};

/** Thrown by `runReconciliationWorkflow` when either uploaded file fails File Validation
 * (Issue #137, Phase 7). This route has no partial-import/review screen the way the Import flow
 * does, so the decided behavior is to fail the request outright with the validation issues rather
 * than silently degrading or falling back to the old lenient pathway -- callers catch this
 * specifically (before the generic error handler) to respond with the issues instead of a bare
 * 500. No lifecycle job is registered when this throws, so a rejected upload never creates an
 * orphaned CREATED-status reconciliation_job row. */
export class ReconciliationFileValidationError extends Error {
  /**
   * @param bankIssues Validation issues found in the uploaded bank file.
   * @param glIssues Validation issues found in the uploaded GL file.
   */
  constructor(
    public readonly bankIssues: ValidationIssue[],
    public readonly glIssues: ValidationIssue[],
  ) {
    super('Uploaded files failed File Validation.');
    this.name = 'ReconciliationFileValidationError';
  }
}

/** Thrown by `runReconciliationWorkflow` for any failure *after* `registerLifecycleJob` has already
 * created a Postgres lifecycle row (i.e. everything past the File Validation check above). Carries
 * that row's id so both callers (`handleFailedReconciliationRun`'s call sites, in the synchronous
 * route and the queue consumer) can actually mark it failed. Without this, `persistenceJobId` is
 * only ever assigned from a *successful* `runReconciliationWorkflow` return -- a failure never
 * reaches that `return` statement, so the row this run created would otherwise be silently left in
 * its initial in-progress state forever, regardless of whether the failure came from the
 * synchronous route or a queued/retried run. */
export class ReconciliationWorkflowError extends Error {
  /**
   * @param message Human-readable failure reason, surfaced as-is via `Error.message`.
   * @param persistenceJobId Id of the Postgres lifecycle row this run had already created.
   * @param options Standard `ErrorOptions` -- used to attach the original error as `cause`.
   */
  constructor(
    message: string,
    public readonly persistenceJobId: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ReconciliationWorkflowError';
  }
}

/** Exported for `worker.ts` (Issue #134 phase 3) -- the standalone consumer process calls this
 * directly, same function the synchronous in-request path and the (now removed) in-process queue
 * Worker both used. */
export const runReconciliationWorkflow = async (input: {
  body: Record<string, unknown>;
  files: ReconciliationUploadFiles;
  requestId: unknown;
  /** Session id (JWT `jti`) of whoever submitted this run. `requestLog` arrives unbound when
   * this is called from the queue worker (no request.log to inherit from) -- child() it with
   * this value so this function's own log lines, and executeReconciliation's, stay filterable
   * by session the same way the synchronous in-request path already gets via request.log. */
  sessionId?: string;
  organizationId: string;
  requestLog: pino.Logger;
  repository: InMemoryRunRepository;
  lifecycleStore?: PostgresReconciliationLifecycleStore;
  pool?: Pool;
  /** See reconciliationService.ts's `RunReconciliationPipelineInput.onStep` doc comment. */
  onStep?: QueueStepReporter;
}): Promise<ReconciliationWorkflowResult> => {
  const log = input.sessionId ? input.requestLog.child({ jti: input.sessionId }) : input.requestLog;
  const { accountIdentifier, periodLabel, reconciliationFrequency, varianceOverrides } =
    parseReconciliationRequestInput(input.body);
  const correlationId = resolveCorrelationId(input.requestId);

  const [bankOutcome, glOutcome] = await Promise.all([
    validateFile({
      bytes: input.files.bankFile.buffer,
      fileFormat: resolveSourceFormat(input.files.bankFile.originalname) === 'csv' ? 'CSV' : 'XLSX',
      fileType: 'BANK',
    }),
    validateFile({
      bytes: input.files.glFile.buffer,
      fileFormat: resolveSourceFormat(input.files.glFile.originalname) === 'csv' ? 'CSV' : 'XLSX',
      fileType: 'GL',
    }),
  ]);

  if (!bankOutcome.ok || !glOutcome.ok) {
    input.requestLog.info({
      action: 'reconciliation.run.validation_failed',
      bankIssueCount: bankOutcome.issues.length,
      glIssueCount: glOutcome.issues.length,
    });
    throw new ReconciliationFileValidationError(bankOutcome.issues, glOutcome.issues);
  }

  const lifecycleContext = await registerLifecycleJob(
    input.lifecycleStore,
    correlationId,
    input.organizationId,
    {
      accountIdentifier,
      periodLabel,
      reconciliationFrequency,
    },
    input.files,
  );

  log.info({ action: 'reconciliation.run.received', accountIdentifier, periodLabel });

  // Everything from here on runs against an already-created lifecycle row (lifecycleContext.runId)
  // -- any failure past this point must carry that id back out so the caller can mark the row
  // failed instead of leaving it stuck in progress. See ReconciliationWorkflowError's doc comment.
  try {
    const aliases = input.pool
      ? await loadPayeeAliases(input.pool, input.organizationId, accountIdentifier)
      : [];

    const bankTransactionContext = {
      runId: lifecycleContext.runId,
      sourceFileId: lifecycleContext.bankSourceFileId,
      spreadsheetFileName: input.files.bankFile.originalname,
      config: defaultReconciliationConfig,
    };
    const glTransactionContext = {
      runId: lifecycleContext.runId,
      sourceFileId: lifecycleContext.glSourceFileId,
      spreadsheetFileName: input.files.glFile.originalname,
      config: defaultReconciliationConfig,
    };

    const normalizedTransactions = [
      ...toNormalizedTransactions(bankOutcome.normalized, bankTransactionContext),
      ...toNormalizedTransactions(glOutcome.normalized, glTransactionContext),
    ];
    const rawRows = [
      ...toRawTransactionRows(bankOutcome.normalized, bankTransactionContext),
      ...toRawTransactionRows(glOutcome.normalized, glTransactionContext),
    ];
    const sourceFiles = [
      {
        id: lifecycleContext.bankSourceFileId,
        source: 'bank' as const,
        fileName: input.files.bankFile.originalname,
        mimeType: input.files.bankFile.mimetype,
        sizeBytes: input.files.bankFile.size,
        uploadedAt: new Date().toISOString(),
        ...FILE_VALIDATION_SOURCE_FILE_DEFAULTS,
      },
      {
        id: lifecycleContext.glSourceFileId,
        source: 'gl' as const,
        fileName: input.files.glFile.originalname,
        mimeType: input.files.glFile.mimetype,
        sizeBytes: input.files.glFile.size,
        uploadedAt: new Date().toISOString(),
        ...FILE_VALIDATION_SOURCE_FILE_DEFAULTS,
      },
    ];

    const run = await executeReconciliationFromNormalized({
      correlationId,
      sessionId: input.sessionId,
      runId: lifecycleContext.runId,
      organizationId: input.organizationId,
      lifecycleStore: input.lifecycleStore,
      sourceFiles,
      rawRows,
      normalizedTransactions,
      accountIdentifier,
      reconciliationFrequency,
      periodLabel,
      aliases,
      onStep: input.onStep,
    });

    input.repository.save(run);
    log.info({
      action: 'reconciliation.run.completed',
      runId: run.id,
      exceptions: run.exceptions.length,
    });

    if (varianceOverrides) {
      run.appliedVarianceOverrides = varianceOverrides;
    }

    return {
      accountIdentifier,
      periodLabel,
      reconciliationFrequency,
      varianceOverrides,
      persistenceJobId: lifecycleContext.runId,
      run,
    };
  } catch (error) {
    throw new ReconciliationWorkflowError(
      error instanceof Error ? error.message : 'Unexpected reconciliation workflow failure',
      lifecycleContext.runId,
      { cause: error },
    );
  }
};

/** The "trigger the existing GL<->Bank matching pipeline immediately" half of Phase 6 (submit &
 * async validation) -- Issue #137: runs the reconciliation pipeline directly against the File
 * Validation Engine's already-validated `NormalizedRecord`s (via `toNormalizedTransactions`/
 * `toRawTransactionRows`), never re-parsing the original bytes through the old alias-based
 * pathway. Still registers the original bytes into the older pipeline's own audit trail
 * (reconciliation_job/reconciliation_source_file/reconciliation_source_file_content) via
 * `registerLifecycleJob`, since `reconciliation_run.matching_job_id` (changeset 0048) links to
 * that job id specifically -- only the parsing step is skipped, not the audit registration. */
const triggerMatchingForImportRun = async (input: {
  files: { bankFile: ImportValidationTriggerFile; glFile: ImportValidationTriggerFile };
  organizationId: string;
  repository: InMemoryRunRepository;
  lifecycleStore?: PostgresReconciliationLifecycleStore;
  pool?: Pool;
  requestLog: pino.Logger;
  /** Session id (JWT `jti`) of whoever submitted the files, threaded down to
   * executeReconciliationFromNormalized so its whole matching-phase log narrative stays
   * filterable by session, same as the synchronous in-request path gets for free via
   * request.log. */
  sessionId?: string;
  /** See reconciliationService.ts's `RunReconciliationPipelineInput.onStep` doc comment. */
  onStep?: QueueStepReporter;
  /** The `reconciliation_run.period_end` this import run declared at submission (changeset 0061),
   * ISO date string -- see `ExecuteReconciliationFromNormalizedInput.declaredAnchorDate`'s doc
   * comment. Both callers below fetch it from the run row before calling this function. */
  declaredAnchorDate?: string;
  /** `reconciliation_run.id` -- both callers below already have it in scope as their own `runId`.
   * See `ExecuteReconciliationFromNormalizedInput.reconciliationRunId`'s doc comment. */
  reconciliationRunId: string;
}): Promise<{ matchingJobId: string }> => {
  const correlationId = randomUUID();

  const toUploadShape = (file: ImportValidationTriggerFile): Express.Multer.File => ({
    fieldname: 'file',
    originalname: file.originalname,
    encoding: '7bit',
    mimetype: mimeTypeForFileName(file.originalname),
    size: file.buffer.byteLength,
    buffer: file.buffer,
    destination: '',
    filename: file.originalname,
    path: '',
    stream: Readable.from(file.buffer),
  });

  const lifecycleContext = await registerLifecycleJob(
    input.lifecycleStore,
    correlationId,
    input.organizationId,
    {},
    { bankFile: toUploadShape(input.files.bankFile), glFile: toUploadShape(input.files.glFile) },
  );

  const aliases = input.pool
    ? await loadPayeeAliases(input.pool, input.organizationId, undefined)
    : [];

  const bankTransactionContext = {
    runId: lifecycleContext.runId,
    sourceFileId: lifecycleContext.bankSourceFileId,
    spreadsheetFileName: input.files.bankFile.originalname,
    config: defaultReconciliationConfig,
  };
  const glTransactionContext = {
    runId: lifecycleContext.runId,
    sourceFileId: lifecycleContext.glSourceFileId,
    spreadsheetFileName: input.files.glFile.originalname,
    config: defaultReconciliationConfig,
  };

  const normalizedTransactions = [
    ...toNormalizedTransactions(input.files.bankFile.normalized, bankTransactionContext),
    ...toNormalizedTransactions(input.files.glFile.normalized, glTransactionContext),
  ];
  const rawRows = [
    ...toRawTransactionRows(input.files.bankFile.normalized, bankTransactionContext),
    ...toRawTransactionRows(input.files.glFile.normalized, glTransactionContext),
  ];
  const sourceFiles = [
    {
      id: lifecycleContext.bankSourceFileId,
      source: 'bank' as const,
      fileName: input.files.bankFile.originalname,
      mimeType: mimeTypeForFileName(input.files.bankFile.originalname),
      sizeBytes: input.files.bankFile.buffer.byteLength,
      uploadedAt: new Date().toISOString(),
      ...FILE_VALIDATION_SOURCE_FILE_DEFAULTS,
    },
    {
      id: lifecycleContext.glSourceFileId,
      source: 'gl' as const,
      fileName: input.files.glFile.originalname,
      mimeType: mimeTypeForFileName(input.files.glFile.originalname),
      sizeBytes: input.files.glFile.buffer.byteLength,
      uploadedAt: new Date().toISOString(),
      ...FILE_VALIDATION_SOURCE_FILE_DEFAULTS,
    },
  ];

  const run = await executeReconciliationFromNormalized({
    correlationId,
    runId: lifecycleContext.runId,
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    lifecycleStore: input.lifecycleStore,
    sourceFiles,
    rawRows,
    normalizedTransactions,
    aliases,
    onStep: input.onStep,
    declaredAnchorDate: input.declaredAnchorDate,
    reconciliationRunId: input.reconciliationRunId,
    openItemStore: input.pool ? new PostgresOpenItemStore(input.pool) : undefined,
    // Default on -- the env var is purely an ops kill switch; the real per-organization control
    // is reconciliation_organization.carry_forward_enabled (PR C.5).
    carryForwardEnvEnabled: parseBooleanFlag(process.env.ENABLE_CARRY_FORWARD) !== false,
  });

  input.repository.save(run);
  input.requestLog.info({
    action: 'reconciliation.run.completed',
    runId: run.id,
    exceptions: run.exceptions.length,
  });

  return { matchingJobId: run.id };
};

/** processJob for the import validation queue (and the synchronous fallback when that queue is
 * disabled, same pattern as /api/reconciliation/run's own enabled/disabled split). Requires a
 * real pool -- only ever invoked once a submit request has already passed requirePool, so the
 * non-null assertions below are safe, matching how the rest of this route family asserts `pool!`
 * after its own requirePool check. */
/** Exported for `worker.ts` (Issue #134 phase 3) -- see `runReconciliationWorkflow`'s doc comment
 * above for the same rationale. */
export const processImportValidationJob = async (input: {
  organizationId: string;
  runId: string;
  importJobId: string;
  workerId: string;
  pool: Pool;
  repository: InMemoryRunRepository;
  lifecycleStore?: PostgresReconciliationLifecycleStore;
  requestLog: pino.Logger;
  /** Session id (JWT `jti`) of whoever submitted the files. When invoked from the queue worker
   * (see importValidationQueue.ts), `requestLog` is the shared module-level logger with no
   * per-job binding of its own -- child() it with this value so every log line the rest of this
   * workflow emits stays filterable by session, same as the synchronous in-request path already
   * gets for free via request.log. */
  sessionId?: string;
  /** Live push half of Issue #154 -- present only when invoked from the import validation queue
   * worker (see importValidationQueue.ts); undefined on the synchronous in-request fallback. */
  onStep?: QueueStepReporter;
}): Promise<QueuedImportValidationResult> => {
  const importValidationStore = new PostgresImportValidationStore(input.pool);
  const log = input.sessionId ? input.requestLog.child({ jti: input.sessionId }) : input.requestLog;

  try {
    const result = await runImportValidationWorkflow({
      organizationId: input.organizationId,
      runId: input.runId,
      importJobId: input.importJobId,
      workerId: input.workerId,
      logger: log,
      blobStorage: new PostgresBlobStorage(input.pool),
      importRunStore: new PostgresImportRunStore(input.pool),
      importValidationStore,
      onStep: input.onStep,
      triggerMatching: ({ declaredAnchorDate, ...files }) =>
        triggerMatchingForImportRun({
          files,
          organizationId: input.organizationId,
          repository: input.repository,
          lifecycleStore: input.lifecycleStore,
          pool: input.pool,
          requestLog: log,
          sessionId: input.sessionId,
          onStep: input.onStep,
          declaredAnchorDate,
          reconciliationRunId: input.runId,
        }),
    });

    return { status: 'completed', passed: result.passed, matchingJobId: result.matchingJobId };
  } catch (error) {
    await importValidationStore
      .markJobFailed(
        input.organizationId,
        input.importJobId,
        error instanceof Error ? error.message : 'Unexpected import validation failure',
      )
      .catch(() => undefined);

    captureApiException(error, {
      tags: { scope: 'import-validation-queue' },
      extra: { runId: input.runId, importJobId: input.importJobId },
    });

    return {
      status: 'failed',
      failedAt: new Date().toISOString(),
      reason: error instanceof Error ? error.message : 'Unexpected import validation failure',
    };
  }
};

/** Exported for `worker.ts` (Issue #134 phase 3). */
export const recordSuccessfulReconciliationRun = (input: {
  requestId: unknown;
  started: number;
  result: ReconciliationWorkflowResult;
}): void => {
  recordReconciliationRun({
    timestamp: new Date().toISOString(),
    status: 'Succeeded',
    correlationId: resolveCorrelationId(input.requestId),
    runId: input.result.run.id,
    accountIdentifier: input.result.accountIdentifier,
    reconciliationFrequency: input.result.reconciliationFrequency,
    periodLabel: input.result.periodLabel,
    durationMs: Date.now() - input.started,
    exceptionCount: input.result.run.exceptions.length,
  });
};

/** Exported for `worker.ts` (Issue #134 phase 3). */
export const handleFailedReconciliationRun = async (input: {
  requestId: unknown;
  requestBody: Record<string, unknown>;
  started: number;
  organizationId: string;
  lifecycleStore?: PostgresReconciliationLifecycleStore;
  persistenceJobId?: string;
  error: unknown;
}): Promise<void> => {
  if (input.lifecycleStore && input.persistenceJobId) {
    await input.lifecycleStore
      .markFailed(input.organizationId, {
        jobId: input.persistenceJobId,
        failedAt: new Date().toISOString(),
        errorMessage:
          input.error instanceof Error ? input.error.message : 'Unexpected reconciliation failure',
      })
      .catch(() => undefined);
  }

  const requestInput = parseReconciliationRequestInput(input.requestBody);
  recordReconciliationRun({
    timestamp: new Date().toISOString(),
    status: 'Failed',
    correlationId: resolveCorrelationId(input.requestId),
    accountIdentifier: requestInput.accountIdentifier,
    reconciliationFrequency: requestInput.reconciliationFrequency,
    periodLabel: requestInput.periodLabel,
    durationMs: Date.now() - input.started,
    failureReason:
      input.error instanceof Error ? input.error.message : 'Unexpected reconciliation failure',
  });
};

/** allowedExtensions defaults to .xlsx only, matching the existing /api/reconciliation/run
 * upload's behavior exactly. File Imports & Validation (/api/imports/runs) passes ['.xlsx',
 * '.csv'] instead -- transaction-csv-spec.md's Bank/GL template is defined for both formats, and
 * the File Validation Engine (packages/core/src/fileValidation) already parses both. */
const createUploadMiddleware = (
  maxUploadMb: number,
  allowedExtensions: readonly string[] = ['.xlsx'],
) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024 },
    fileFilter: (_request, file, callback) => {
      const name = file.originalname.toLowerCase();
      const allowed =
        acceptedMimeTypes.has(file.mimetype) || allowedExtensions.some((ext) => name.endsWith(ext));
      if (!allowed) {
        callback(new Error(`Only ${allowedExtensions.join('/')} files are accepted.`));
        return;
      }

      callback(null, true);
    },
  });

/** Exported for `worker.ts` (Issue #134 phase 3). */
export const sanitizeRun = (run: ReconciliationRun): ReconciliationRunReport => ({
  id: run.id,
  correlationId: run.correlationId,
  accountIdentifier: run.accountIdentifier,
  periodLabel: run.periodLabel,
  reconciliationFrequency: run.reconciliationFrequency,
  status: run.status,
  startedAt: run.startedAt,
  completedAt: run.completedAt,
  sourceFiles: run.sourceFiles,
  groupedMatchResults: run.groupedMatchResults,
  probableMatches: run.probableMatches,
  exceptions: run.exceptions,
  summary: run.summary,
  reviewerObservations: run.reviewerObservations,
  reviewerDecisions: run.reviewerDecisions,
  outputWorkbook: run.outputWorkbook
    ? {
        fileName: run.outputWorkbook.fileName,
        generatedAt: run.outputWorkbook.generatedAt,
        tabNames: run.outputWorkbook.tabNames,
      }
    : undefined,
  appliedVarianceOverrides: run.appliedVarianceOverrides,
});

const resolveUploadErrorStatus = (error: unknown): number => {
  if (error instanceof multer.MulterError) {
    return error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  }

  // Matches createUploadMiddleware's fileFilter rejection message for any allowedExtensions list
  // (e.g. 'Only .xlsx files are accepted.', 'Only .xlsx/.csv files are accepted.').
  if (error instanceof Error && /^Only .+ files are accepted\.$/.test(error.message)) {
    return 400;
  }

  return 500;
};

const parseLimit = (value: unknown, defaultValue: number, max = 50): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(Math.trunc(parsed), max);
};

const parseOffset = (value: unknown, defaultValue = 0): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue;
  }

  return Math.trunc(parsed);
};

const parseBooleanFlag = (value: string | undefined): boolean | null => {
  if (value === undefined) {
    return null;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return null;
};

// ZAP finding #161: `cors()` with no options reflects `*` for every request. Real deployments
// (dev/stage/prod Docker) never need this at all -- the browser only ever talks to the web
// gateway's own origin, which reverse-proxies /api/* to this service server-side (not subject to
// CORS, since that's not a browser-initiated cross-origin request). The genuine cross-origin case
// is local native development/testing, where the Vite dev server (5173) and preview server (4173)
// run on different ports than this API (4000) -- both are covered by the default below.
// CORS_ALLOWED_ORIGINS overrides with a comma-separated list for any environment that legitimately
// needs something else to call this API directly from a browser.
const resolveCorsAllowedOrigins = (): string[] => {
  const configured = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (configured) {
    return configured
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  return [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
    'http://localhost:4173',
  ];
};

const parsePositiveInteger = (
  value: string | undefined,
  defaultValue: number,
  maxValue: number,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(Math.trunc(parsed), maxValue);
};

type ApiRateLimiter = {
  middleware: ReturnType<typeof rateLimit>;
  // Also used as the auth denylist client (see DenylistRedisClient in authService.ts) so logout
  // revocation shares the same connection rather than opening a second one.
  redisClient:
    | (DenylistRedisClient & {
        isOpen: boolean;
        quit: () => Promise<unknown>;
      })
    | null;
};

/** Exported for `worker.ts` (Issue #134 phase 3), which needs the same shape to build its own
 * consumer. */
export type ReconciliationQueueConfiguration = {
  enabled: boolean;
  redisUrl: string | null;
  queueName: string;
  prefix: string;
  concurrency: number;
  maxAttempts: number;
  backoffDelayMs: number;
};

/** File Imports & Validation's own queue config, deliberately separate from
 * ReconciliationQueueConfiguration above -- "we should use the best queuing tool" resolved to
 * BullMQ but as its own queue, not sharing the existing reconciliation queue's job type. Exported
 * for `worker.ts` (Issue #134 phase 3). */
export type ImportValidationQueueConfiguration = {
  enabled: boolean;
  redisUrl: string | null;
  queueName: string;
  prefix: string;
  concurrency: number;
  maxAttempts: number;
  backoffDelayMs: number;
};

const resolveRateLimitRedisConfiguration = (): {
  enabled: boolean;
  url: string | null;
  prefix: string;
} => {
  const enabledFlag = parseBooleanFlag(process.env.RATE_LIMIT_USE_REDIS);
  const configuredUrl = process.env.RATE_LIMIT_REDIS_URL?.trim();

  return {
    enabled: enabledFlag === true || (enabledFlag === null && Boolean(configuredUrl)),
    url: configuredUrl && configuredUrl.length > 0 ? configuredUrl : null,
    prefix: process.env.RATE_LIMIT_REDIS_PREFIX?.trim() || 'recon:rate-limit:',
  };
};

const createApiRateLimiter = (logger: pino.Logger): ApiRateLimiter => {
  const redisConfiguration = resolveRateLimitRedisConfiguration();
  let redisClient: ApiRateLimiter['redisClient'] = null;
  let redisStore: RedisStore | undefined;

  if (redisConfiguration.enabled && redisConfiguration.url) {
    try {
      const configuredRedisClient = createClient({ url: redisConfiguration.url });
      redisClient = configuredRedisClient;

      configuredRedisClient.on('error', (error) => {
        logger.warn({ action: 'api.rate-limit.redis.error', err: error }, 'Redis client error');
      });

      void configuredRedisClient
        .connect()
        .then(() => {
          logger.info(
            { action: 'api.rate-limit.redis.connected' },
            'Redis-backed rate limiting connected',
          );
        })
        .catch((error: unknown) => {
          logger.warn(
            { action: 'api.rate-limit.redis.connect_failed', err: error },
            'Redis-backed rate limiting failed to connect',
          );
        });

      redisStore = new RedisStore({
        prefix: redisConfiguration.prefix,
        sendCommand: (...commandArgs: string[]) =>
          configuredRedisClient.sendCommand(commandArgs) as unknown as Promise<number>,
      });

      logger.info(
        {
          action: 'api.rate-limit.mode',
          mode: 'redis',
          redisPrefix: redisConfiguration.prefix,
        },
        'Using Redis-backed API rate limiting',
      );
    } catch (error) {
      redisClient = null;
      logger.warn(
        { action: 'api.rate-limit.redis.init_failed', err: error },
        'Failed to initialize Redis-backed rate limiting; falling back to in-memory store',
      );
    }
  } else if (redisConfiguration.enabled && !redisConfiguration.url) {
    logger.warn(
      { action: 'api.rate-limit.redis.url_missing' },
      'RATE_LIMIT_USE_REDIS=true but RATE_LIMIT_REDIS_URL is missing; falling back to in-memory store',
    );
  }

  if (!redisStore) {
    logger.info(
      { action: 'api.rate-limit.mode', mode: 'memory' },
      'Using in-memory API rate limiting',
    );
  }

  return {
    redisClient,
    middleware: rateLimit({
      windowMs: parsePositiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000, 86_400_000),
      limit: parsePositiveInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 120, 50_000),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      validate: {
        trustProxy: false,
      },
      store: redisStore,
      passOnStoreError: true,
      skip: (request) => request.path === '/api/health' || request.path === '/api/metrics',
      message: { message: 'Too many requests. Please try again later.' },
    }),
  };
};

/** Exported for `worker.ts` (Issue #134 phase 3). */
export const resolveReconciliationQueueConfiguration = (): ReconciliationQueueConfiguration => {
  const queueEnabled = parseBooleanFlag(process.env.ENABLE_RECONCILIATION_QUEUE) === true;
  const configuredRedisUrl =
    process.env.RECONCILIATION_QUEUE_REDIS_URL?.trim() ||
    process.env.RATE_LIMIT_REDIS_URL?.trim() ||
    process.env.REDIS_URL?.trim() ||
    null;

  return {
    enabled: queueEnabled,
    redisUrl: configuredRedisUrl,
    queueName: process.env.RECONCILIATION_QUEUE_NAME?.trim() || 'reconciliation-runs',
    prefix: process.env.RECONCILIATION_QUEUE_PREFIX?.trim() || 'recon',
    concurrency: parsePositiveInteger(process.env.RECONCILIATION_QUEUE_CONCURRENCY, 1, 8),
    // Default: 1 initial attempt + 4 retries, exponential backoff starting at 5s (5s/10s/20s/40s)
    // -- enough tolerance for a transient DB/Redis blip without leaving a truly broken run
    // retrying for very long before it reaches the dead-letter queue.
    maxAttempts: parsePositiveInteger(process.env.RECONCILIATION_QUEUE_MAX_ATTEMPTS, 5, 20),
    backoffDelayMs: parsePositiveInteger(
      process.env.RECONCILIATION_QUEUE_BACKOFF_DELAY_MS,
      5000,
      600_000,
    ),
  };
};

/** Exported for `worker.ts` (Issue #134 phase 3). */
export const resolveImportValidationQueueConfiguration = (): ImportValidationQueueConfiguration => {
  const queueEnabled = parseBooleanFlag(process.env.ENABLE_IMPORT_VALIDATION_QUEUE) === true;
  const configuredRedisUrl =
    process.env.IMPORT_VALIDATION_QUEUE_REDIS_URL?.trim() ||
    process.env.RECONCILIATION_QUEUE_REDIS_URL?.trim() ||
    process.env.RATE_LIMIT_REDIS_URL?.trim() ||
    process.env.REDIS_URL?.trim() ||
    null;

  return {
    enabled: queueEnabled,
    redisUrl: configuredRedisUrl,
    queueName: process.env.IMPORT_VALIDATION_QUEUE_NAME?.trim() || 'import-validation-runs',
    prefix: process.env.IMPORT_VALIDATION_QUEUE_PREFIX?.trim() || 'recon',
    concurrency: parsePositiveInteger(process.env.IMPORT_VALIDATION_QUEUE_CONCURRENCY, 1, 4),
    // Same retry policy as the reconciliation queue -- see its resolver's comment.
    maxAttempts: parsePositiveInteger(process.env.IMPORT_VALIDATION_QUEUE_MAX_ATTEMPTS, 5, 20),
    backoffDelayMs: parsePositiveInteger(
      process.env.IMPORT_VALIDATION_QUEUE_BACKOFF_DELAY_MS,
      5000,
      600_000,
    ),
  };
};

export const buildOpenApiSpec = () => ({
  openapi: '3.0.3',
  info: {
    title: 'Reconciliation Platform API',
    version: '0.1.0',
    description:
      'Operational API for authentication, reconciliation execution, run reports, and exports.',
  },
  servers: [{ url: '/', description: 'Current origin' }],
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        responses: {
          200: {
            description: 'API is healthy',
          },
        },
      },
    },
    '/api/metrics': {
      get: {
        summary: 'Prometheus API metrics',
        responses: {
          200: { description: 'Prometheus metrics payload' },
          404: { description: 'Metrics endpoint disabled' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        summary: 'Authenticate user credentials',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Bearer token and authenticated user profile' },
          401: { description: 'Authentication failed' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        summary: 'Revoke the current bearer token',
        security: [{ bearerAuth: [] }],
        responses: {
          204: { description: 'Token revoked (or already expired/absent)' },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        summary: 'Get the authenticated principal for the current bearer token',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Current username, role, and organization' },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/api/reconciliation/run': {
      post: {
        summary: 'Run reconciliation synchronously or enqueue a queued run',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['bankFile', 'glFile'],
                properties: {
                  bankFile: { type: 'string', format: 'binary' },
                  glFile: { type: 'string', format: 'binary' },
                  accountIdentifier: { type: 'string' },
                  periodLabel: { type: 'string' },
                  reconciliationFrequency: {
                    type: 'string',
                    enum: ['Monthly', 'Annual'],
                  },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Synchronous reconciliation result' },
          202: { description: 'Queued reconciliation accepted' },
          400: { description: 'Invalid upload payload' },
        },
      },
    },
    '/api/reconciliation/jobs/{jobId}': {
      get: {
        summary: 'Get queued reconciliation job status',
        parameters: [
          {
            in: 'path',
            name: 'jobId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Queued job status payload' },
          404: { description: 'Queued job not found' },
        },
      },
    },
    '/api/reconciliation/latest': {
      get: {
        summary: 'Fetch the latest completed reconciliation run',
        responses: {
          200: { description: 'Latest run report' },
          404: { description: 'No completed run available' },
        },
      },
    },
    '/api/reconciliation/{id}': {
      get: {
        summary: 'Fetch a reconciliation run report by run ID',
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Run report' },
          404: { description: 'Run not found' },
        },
      },
    },
    '/api/reconciliation/{id}/summary': {
      get: {
        summary: 'Fetch run summary by run ID',
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Run summary' },
          404: { description: 'Run not found' },
        },
      },
    },
    '/api/reconciliation/{id}/exceptions': {
      get: {
        summary: 'Fetch run exceptions (optionally paginated)',
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string' },
          },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1 } },
          { in: 'query', name: 'offset', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          200: { description: 'Exceptions list or page object' },
          404: { description: 'Run not found' },
        },
      },
    },
    '/api/reconciliation/{id}/export/workbook': {
      get: {
        summary: 'Download output workbook for a reconciliation run',
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Workbook download' },
          404: { description: 'Workbook not available for run' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
});

/**
 * Creates the HTTP application for reconciliation, diagnostics, health checks,
 * and workbook export endpoints.
 *
 * @param repository Optional run repository implementation used to store and
 * retrieve completed reconciliation runs.
 * @returns Configured Express application instance.
 */
export const createApp = (
  repository = new InMemoryRunRepository(),
  lifecycleStore?: PostgresReconciliationLifecycleStore,
  readModelStore?: PostgresReconciliationReadModelStore,
  pool?: Pool,
  logger?: pino.Logger,
) => {
  const app = express();
  const upload = createUploadMiddleware(Number(process.env.MAX_UPLOAD_MB ?? '10'));
  const importUpload = createUploadMiddleware(Number(process.env.MAX_IMPORT_UPLOAD_MB ?? '50'), [
    '.xlsx',
    '.csv',
  ]);
  // Defaults to its own stdout-only logger (as every existing test relies on) when the caller
  // doesn't supply one. createServerRuntime (server.ts) passes its own LOG_FILE-multistreamed
  // logger here in real deployments -- without this, every per-request log line (including the
  // ISSUE-050.2 login/logout/mapping-profile audit trail) would only ever reach stdout, never
  // the durable file compose.yaml's LOG_FILE wiring exists specifically to provide.
  const httpLogger =
    logger ??
    pino({
      level: resolveLogLevelAtLeastInfo(process.env.LOG_LEVEL),
      redact: logRedactOptions,
    });
  const apiMetricsFlag = parseBooleanFlag(process.env.ENABLE_API_METRICS);
  const apiMetrics = apiMetricsFlag === true || apiMetricsFlag === null ? createApiMetrics() : null;
  const apiRateLimiter = createApiRateLimiter(httpLogger);
  const openApiSpec = buildOpenApiSpec();
  const queueConfiguration = resolveReconciliationQueueConfiguration();
  const importValidationQueueConfiguration = resolveImportValidationQueueConfiguration();

  // ADR-0002 step 7: username == password in localLoginUsers, so this fallback must be
  // impossible to reach in production even by misconfiguration -- checked at startup, not at
  // request time, so a bad deploy fails immediately instead of quietly shipping a backdoor.
  const localLoginFallbackEnabled =
    parseBooleanFlag(process.env.ALLOW_LOCAL_LOGIN_FALLBACK) === true;
  if (localLoginFallbackEnabled && isProductionRuntime()) {
    throw new Error(
      'ALLOW_LOCAL_LOGIN_FALLBACK is set in a production runtime; refusing to start. ' +
        'This fallback authenticates with username == password and must only exist in local dev.',
    );
  }

  // Dev-only escape hatch (changeset 0056) letting a superuser submit and approve the same
  // import run for solo Dev-stack testing -- restated (restricted) before go-live, per the app
  // owner. Deliberately no isProductionRuntime() boot guard here, unlike
  // ALLOW_LOCAL_LOGIN_FALLBACK above: compose.yaml's shared x-api-environment anchor sets
  // NODE_ENV=production unconditionally in every Docker tier (dev and stage included, confirmed
  // by trying the mirrored guard here first -- it refused to boot in Dev too), so
  // isProductionRuntime() cannot distinguish real production from Dev/stage and would be a false
  // safety net, not a real one (the ALLOW_LOCAL_LOGIN_FALLBACK guard above has this same latent
  // gap; it has just never been exercised, since nothing sets that flag anywhere). The actual
  // safeguard is the same one every other dev-only flag in this project relies on
  // (ENABLE_RECONCILIATION_QUEUE and siblings): this variable is set only in compose.dev.yaml and
  // must never be added to compose.yaml or compose.stage.yaml.
  const superuserSelfApprovalEnabled =
    parseBooleanFlag(process.env.ALLOW_SUPERUSER_SELF_APPROVAL) === true;

  initializeApiSentry(httpLogger);

  // Producer only (Issue #134 phase 2) -- no Worker/processJob here anymore. The consumer that
  // actually processes queued jobs lives in worker.ts, its own process, built from the same
  // resolveReconciliationQueueConfiguration() (exported for that purpose) so both sides agree on
  // queueName/prefix/Redis connection without sharing any in-process state.
  const reconciliationQueue = createReconciliationProducer({
    enabled: queueConfiguration.enabled,
    redisUrl: queueConfiguration.redisUrl,
    queueName: queueConfiguration.queueName,
    prefix: queueConfiguration.prefix,
    logger: httpLogger,
    maxAttempts: queueConfiguration.maxAttempts,
    backoffDelayMs: queueConfiguration.backoffDelayMs,
  });

  // worker-N (not a random id): if two worker processes are ever run side by side, import_job.
  // worker_id should read as which *process* handled a job, not a fresh id per job that reveals
  // nothing on inspection. Still used below by the synchronous fallback path (requirePool already
  // guarantees a pool exists there); the queue-consumer path builds its own in worker.ts.
  const importValidationWorkerId = `import-validation-worker-${process.pid}`;
  const importValidationQueue = createImportValidationProducer({
    enabled: importValidationQueueConfiguration.enabled,
    redisUrl: importValidationQueueConfiguration.redisUrl,
    queueName: importValidationQueueConfiguration.queueName,
    prefix: importValidationQueueConfiguration.prefix,
    logger: httpLogger,
    maxAttempts: importValidationQueueConfiguration.maxAttempts,
    backoffDelayMs: importValidationQueueConfiguration.backoffDelayMs,
  });

  // Only registered when the queue is actually enabled -- a permanent zero series for a
  // permanently-disabled queue would misleadingly suggest it exists and is just empty, rather
  // than being off entirely.
  if (apiMetrics && reconciliationQueue.enabled) {
    apiMetrics.registerQueueDepthSource(queueConfiguration.queueName, reconciliationQueue);
  }
  if (apiMetrics && importValidationQueue.enabled) {
    apiMetrics.registerQueueDepthSource(
      importValidationQueueConfiguration.queueName,
      importValidationQueue,
    );
  }

  // Issue #154 (live status push): one shared `QueueEvents` listener per queue for the whole API
  // process, constructed here alongside the producers -- not one per SSE connection, which would
  // open N redundant Redis subscriptions under concurrent users. `GET /api/imports/runs/:id/events`
  // below registers a per-connection filtered listener against these two shared instances.
  const reconciliationQueueEvents = createReconciliationQueueEvents({
    enabled: queueConfiguration.enabled,
    redisUrl: queueConfiguration.redisUrl,
    queueName: queueConfiguration.queueName,
    prefix: queueConfiguration.prefix,
    logger: httpLogger,
    maxAttempts: queueConfiguration.maxAttempts,
    backoffDelayMs: queueConfiguration.backoffDelayMs,
  });
  const importValidationQueueEvents = createImportValidationQueueEvents({
    enabled: importValidationQueueConfiguration.enabled,
    redisUrl: importValidationQueueConfiguration.redisUrl,
    queueName: importValidationQueueConfiguration.queueName,
    prefix: importValidationQueueConfiguration.prefix,
    logger: httpLogger,
    maxAttempts: importValidationQueueConfiguration.maxAttempts,
    backoffDelayMs: importValidationQueueConfiguration.backoffDelayMs,
  });

  app.set('trust proxy', true);
  app.use(
    helmet({
      // Keep cross-origin workbook downloads and local dev UI interactions working.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  if (apiMetrics) {
    app.use(apiMetrics.middleware);
  }
  if (parseBooleanFlag(process.env.DISABLE_API_RATE_LIMIT) !== true) {
    app.use(apiRateLimiter.middleware);
  }
  app.use(cors({ origin: resolveCorsAllowedOrigins() }));
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger: httpLogger,
      genReqId: (request) => request.headers['x-correlation-id']?.toString() ?? randomUUID(),
      quietReqLogger: false,
      // pino-http's own received/completed lines close over a logger captured at request start,
      // so a later `request.log = request.log.child(...)` (see authMiddleware.ts) never reaches
      // them -- customProps is re-invoked at both received and finish time and is the only hook
      // that does. The received line still can't carry jti: auth hasn't run yet at that point.
      // request.sessionId covers the one request where request.auth is never set at all -- the
      // login route itself, which mints a jti but is a PUBLIC_ROUTE so createAuthMiddleware never
      // runs for it.
      customProps: (request) => {
        const jti = request.auth?.jti ?? request.sessionId;
        return jti ? { jti } : {};
      },
      // Log full error detail including stack trace for 4xx/5xx responses
      customErrorMessage: (_request, response) =>
        `request failed with status ${response.statusCode}`,
      customReceivedMessage: (request) => `request received: ${request.method} ${request.url}`,
      customSuccessMessage: (_request, response) =>
        `request completed with status ${response.statusCode}`,
      serializers: {
        err: (err: unknown) => {
          if (err instanceof Error) {
            return { type: err.constructor.name, message: err.message, stack: err.stack };
          }
          return err;
        },
      },
    }),
  );

  app.use((request, response, next) => {
    response.setHeader('x-correlation-id', resolveCorrelationId(request.id));
    next();
  });

  // ADR-0002 step 4: deny-by-default across /api from this point on. See PUBLIC_ROUTES in
  // authMiddleware.ts for the (short, justified) allowlist. Everything registered below this
  // line requires a valid bearer token; a forgotten route 401s instead of silently staying open.
  app.use(createAuthMiddleware(httpLogger, () => apiRateLimiter.redisClient));

  // ADR-0002 step 5: the reconciliation/aliases/mapping/rules/imports surface additionally
  // requires canAccessApplication.
  app.use(
    ['/api/reconciliation', '/api/aliases', '/api/mapping', '/api/rules', '/api/imports'],
    requireApplicationAccess,
  );

  // Mapping *creation* specifically additionally requires both verification gates -- see
  // createRequireFullyVerified. Instantiated once here (not per-request) and mounted inline on
  // that one route below, so read-only mapping routes stay reachable on an unverified account.
  const requireFullyVerified = createRequireFullyVerified(pool);

  const loadFromReadModelOrRepository = async <T>(
    loadFromReadModel: (() => Promise<T | undefined>) | undefined,
    loadFromRepository: () => T | undefined,
  ): Promise<T | undefined> => {
    const persistedResult = loadFromReadModel ? await loadFromReadModel() : undefined;

    if (persistedResult !== undefined) {
      return persistedResult;
    }

    return loadFromRepository();
  };

  const toRunReport = (run: ReconciliationRun | undefined): ReconciliationRunReport | undefined =>
    run ? sanitizeRun(run) : undefined;

  const readModelHasRun = async (organizationId: string, runId: string): Promise<boolean> => {
    if (!readModelStore) {
      return true;
    }

    const run = await readModelStore.findRunReportById(organizationId, runId);
    return Boolean(run);
  };

  const loadLatestRunReport = async (
    organizationId: string,
  ): Promise<ReconciliationRunReport | undefined> => {
    return loadFromReadModelOrRepository(
      readModelStore ? () => readModelStore.findLatestRunReport(organizationId) : undefined,
      () => toRunReport(repository.findLatest()),
    );
  };

  const loadRunReport = async (
    organizationId: string,
    runId: string,
  ): Promise<ReconciliationRunReport | undefined> => {
    return loadFromReadModelOrRepository(
      readModelStore ? () => readModelStore.findRunReportById(organizationId, runId) : undefined,
      () => toRunReport(repository.findById(runId)),
    );
  };

  const loadRunSummary = async (organizationId: string, runId: string) => {
    return loadFromReadModelOrRepository(
      readModelStore ? () => readModelStore.findRunSummaryById(organizationId, runId) : undefined,
      () => repository.findById(runId)?.summary,
    );
  };

  const loadRunExceptions = async (organizationId: string, runId: string) => {
    return loadFromReadModelOrRepository(
      readModelStore ? () => readModelStore.listRunExceptions(organizationId, runId) : undefined,
      () => repository.findById(runId)?.exceptions,
    );
  };

  const loadRunExceptionPage = async (
    organizationId: string,
    runId: string,
    limit: number,
    offset: number,
    filters: ExceptionPageFilters = {},
  ): Promise<PaginatedExceptionsResult | undefined> => {
    if (readModelStore) {
      const runExists = await readModelHasRun(organizationId, runId);
      if (!runExists) {
        return undefined;
      }

      return readModelStore.listRunExceptionsPage(organizationId, runId, limit, offset, filters);
    }

    const exceptions = repository.findById(runId)?.exceptions;
    if (!exceptions) {
      return undefined;
    }

    const filtered = exceptions.filter(
      (exception) =>
        (!filters.category || exception.category === filters.category) &&
        (!filters.severity || exception.severity === filters.severity),
    );

    const items = filtered.slice(offset, offset + limit);
    return {
      items,
      total: filtered.length,
      limit,
      offset,
      hasMore: offset + items.length < filtered.length,
    };
  };

  const loadReviewerDecisions = async (organizationId: string, runId: string) => {
    if (readModelStore) {
      const runExists = await readModelHasRun(organizationId, runId);
      if (!runExists) {
        return undefined;
      }

      return readModelStore.listReviewerDecisions(organizationId, runId);
    }

    return repository.listReviewerDecisions(runId);
  };

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/openapi.json', (_request, response) => {
    response.json(openApiSpec);
  });

  app.get('/api/metrics', async (_request, response, next) => {
    if (!apiMetrics) {
      response.status(404).type('text/plain; charset=utf-8').send('# API metrics are disabled.\n');
      return;
    }

    try {
      const { contentType, body } = await apiMetrics.render();
      response.setHeader('Content-Type', contentType);
      response.send(body);
    } catch (error) {
      next(error);
    }
  });

  // ISSUE-050.2: structured, action-tagged audit logging for every authentication event
  // (matching the pattern the signup handler already uses, e.g. 'signup.entity_verification.failed'
  // -- login previously logged nothing at all, success or failure). Also persists to the durable
  // reconciliation_login_event table when a real database is configured -- local-fallback mode
  // (no pool) can only log, not persist, since there's nowhere to write to.
  const auditLoginEvent = async (
    request: express.Request,
    eventType: 'LOGIN_SUCCESS' | 'LOGIN_FAILURE' | 'LOGOUT',
    username: string,
    organizationId: string | null,
    failureReason?: string,
    // The session id (JWT `jti`) minted for this login, or the existing session's jti on logout.
    // Undefined for LOGIN_FAILURE -- no token is ever minted for a failed attempt.
    sessionId?: string,
  ): Promise<void> => {
    const ipAddress = request.ip;
    const log = sessionId ? request.log.child({ jti: sessionId }) : request.log;
    log.info(
      {
        action: `auth.${eventType.toLowerCase()}`,
        username,
        organizationId,
        ipAddress,
        failureReason,
      },
      `Authentication event: ${eventType}`,
    );

    if (!pool) {
      return;
    }

    try {
      await recordLoginEvent(pool, {
        id: randomUUID(),
        organizationId,
        username,
        eventType,
        failureReason,
        ipAddress,
        sessionId,
      });
    } catch (error) {
      // The audit trail failing to persist must never block the login/logout response itself --
      // the structured log line above already recorded the event; this is a durability layer on
      // top of it, not the only copy.
      log.error(
        { action: 'auth.login_event.persist_failed', username, err: error },
        'Failed to persist login event to the database',
      );
    }
  };

  app.post('/api/auth/login', async (request, response, next) => {
    try {
      const { username, password } = loginBodySchema.parse(request.body ?? {});

      if (username.length === 0 || password.length === 0) {
        response.status(401).json({ message: invalidLoginMessage });
        return;
      }

      if (!pool) {
        if (!localLoginFallbackEnabled) {
          await auditLoginEvent(
            request,
            'LOGIN_FAILURE',
            username,
            null,
            'local_fallback_disabled',
          );
          response.status(401).json({ message: invalidLoginMessage });
          return;
        }

        const localUser = authenticateWithLocalUsers(username, password);

        if (!localUser) {
          await auditLoginEvent(
            request,
            'LOGIN_FAILURE',
            username,
            null,
            'invalid_local_credentials',
          );
          response.status(401).json({ message: invalidLoginMessage });
          return;
        }

        const { token, jti } = signAuthToken(
          {
            sub: localUser.username,
            role: localUser.role,
            organizationId: LOCAL_LOGIN_FALLBACK_ORGANIZATION_ID,
            firstName: localUser.firstName,
            lastName: localUser.lastName,
          },
          httpLogger,
        );
        request.sessionId = jti;
        await auditLoginEvent(
          request,
          'LOGIN_SUCCESS',
          localUser.username,
          LOCAL_LOGIN_FALLBACK_ORGANIZATION_ID,
          undefined,
          jti,
        );
        response.json({
          token,
          username: localUser.username,
          firstName: localUser.firstName,
          lastName: localUser.lastName,
          role: localUser.role,
          organizationId: LOCAL_LOGIN_FALLBACK_ORGANIZATION_ID,
        });
        return;
      }

      const authenticatedUser = await pool.query<{
        user_name: string;
        first_name: string;
        last_name: string;
        password_hash: string;
        role: UserRole;
        organization_id: string;
      }>(
        `
          SELECT user_name, first_name, last_name, password_hash, role, organization_id
          FROM reconciliation_user
          WHERE user_name = $1
          LIMIT 1
        `,
        [username],
      );

      const user = authenticatedUser.rows[0];
      // Always run the bcrypt compare, even when no row was found, against a fixed dummy hash --
      // otherwise a nonexistent username short-circuits before the compare and responds
      // measurably faster than a real username with the wrong password, which lets a caller
      // enumerate valid usernames purely from response timing.
      const passwordMatches = await verifyPassword(
        password,
        user?.password_hash ?? DUMMY_PASSWORD_HASH,
      );

      if (!user || !passwordMatches) {
        // Distinguishable server-side (never surfaced to the client, which always gets the same
        // generic message) so an auditor can tell "no such account" from "wrong password" without
        // that distinction ever being usable for username enumeration over the wire.
        const failureReason = user ? 'invalid_password' : 'unknown_username';
        await auditLoginEvent(
          request,
          'LOGIN_FAILURE',
          username,
          user?.organization_id ?? null,
          failureReason,
        );
        response.status(401).json({ message: invalidLoginMessage });
        return;
      }

      const { token, jti } = signAuthToken(
        {
          sub: user.user_name,
          role: user.role,
          organizationId: user.organization_id,
          firstName: user.first_name,
          lastName: user.last_name,
        },
        httpLogger,
      );
      request.sessionId = jti;

      await auditLoginEvent(
        request,
        'LOGIN_SUCCESS',
        user.user_name,
        user.organization_id,
        undefined,
        jti,
      );

      response.json({
        token,
        username: user.user_name,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        organizationId: user.organization_id,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', async (request, response, next) => {
    try {
      if (request.auth) {
        // Denylisted for the token's full nominal lifetime rather than its actual remaining
        // time -- simpler than decoding `exp` again here, and over-retaining a denylist entry
        // by a few hours is harmless (it only ever blocks a token that would otherwise still be
        // valid).
        await denylistToken(
          apiRateLimiter.redisClient,
          request.auth.jti,
          AUTH_TOKEN_TTL_SECONDS,
          httpLogger,
        );
        // ISSUE-050.2: a successful logout previously produced zero log lines at all (only a
        // denylistToken failure did). Matches the login handler's audit pattern above.
        await auditLoginEvent(
          request,
          'LOGOUT',
          request.auth.username,
          request.auth.organizationId,
          undefined,
          request.auth.jti,
        );
      }

      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/auth/me', async (request, response, next) => {
    if (!request.auth) {
      response.status(401).json({ message: 'Authentication required.' });
      return;
    }

    if (!pool) {
      // Local-fallback users (ALLOW_LOCAL_LOGIN_FALLBACK) have no reconciliation_user row to read
      // verification state from -- treat that mode as fully verified rather than gating it on
      // state it structurally can't have.
      response.json({
        username: request.auth.username,
        role: request.auth.role,
        organizationId: request.auth.organizationId,
        firstName: request.auth.firstName,
        lastName: request.auth.lastName,
        identityVerificationStatus: 'verified',
        entityVerificationStatus: 'verified',
        isFullyVerified: true,
      });
      return;
    }

    try {
      // Verification status is read live, not carried on the JWT: both statuses can flip well
      // after the token was issued, so a cached claim would go stale mid-session.
      const result = await pool.query<{
        identity_verification_status: string;
        entity_verification_status: string;
      }>(
        `
          SELECT u.identity_verification_status, o.entity_verification_status
          FROM reconciliation_user u
          JOIN reconciliation_organization o ON o.id = u.organization_id
          WHERE u.user_name = $1
          LIMIT 1
        `,
        [request.auth.username],
      );

      const row = result.rows[0];
      const identityVerificationStatus = row?.identity_verification_status ?? 'pending';
      const entityVerificationStatus = row?.entity_verification_status ?? 'pending';

      response.json({
        username: request.auth.username,
        role: request.auth.role,
        organizationId: request.auth.organizationId,
        firstName: request.auth.firstName,
        lastName: request.auth.lastName,
        identityVerificationStatus,
        entityVerificationStatus,
        isFullyVerified:
          identityVerificationStatus === 'verified' && entityVerificationStatus === 'verified',
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/signup', async (request, response, next) => {
    if (!pool) {
      response.status(501).json({ message: 'Signup requires a database connection.' });
      return;
    }

    const bodyResult = signupBodySchema.safeParse(request.body ?? {});
    if (!bodyResult.success) {
      respondWithValidationError(response, bodyResult.error);
      return;
    }

    const body = bodyResult.data;
    const [firstName = '', ...lastNameParts] = body.fullName.trim().split(/\s+/);
    const lastName = lastNameParts.join(' ') || firstName;
    const organizationId = randomUUID();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `
          INSERT INTO reconciliation_organization
            (id, name, entity_state, entity_filing_number, entity_type, entity_verification_status)
          VALUES ($1, $2, $3, $4, $5, 'pending')
        `,
        [
          organizationId,
          body.companyName,
          body.entityState,
          body.entityFilingNumber,
          body.entityType,
        ],
      );

      const passwordHash = await hashPassword(body.password);

      await client.query(
        `
          INSERT INTO reconciliation_user
            (user_name, first_name, last_name, email, phone, password_hash, role, organization_id,
             identity_verification_status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
        `,
        [
          body.username,
          firstName,
          lastName,
          body.email,
          body.phone.length > 0 ? body.phone : null,
          passwordHash,
          body.role,
          organizationId,
        ],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();

      if ((error as { code?: string }).code === '23505') {
        response
          .status(409)
          .json({ message: 'That username, email, or company name is already registered.' });
        return;
      }

      next(error);
      return;
    }

    client.release();

    // Account creation is already committed at this point -- nothing below should be able to roll
    // it back on failure, it should only degrade (a stuck entity check can be retried via
    // /api/organizations/entity-verification/retry, a missing code via /api/auth/identity/resend).
    void resolveEntityVerificationProvider()
      .verify({
        legalName: body.companyName,
        state: body.entityState,
        filingNumber: body.entityFilingNumber,
        entityType: body.entityType,
      })
      .then((result) =>
        pool!.query(
          'UPDATE reconciliation_organization SET entity_verification_status = $1 WHERE id = $2',
          [result.status, organizationId],
        ),
      )
      .catch((error: unknown) => {
        httpLogger.warn(
          { action: 'signup.entity_verification.failed', organizationId, err: error },
          'Entity verification provider call failed.',
        );
      });

    try {
      const { code, codeHash, expiresAt } = await generateIdentityCode();
      await pool.query(
        `
          UPDATE reconciliation_user
          SET identity_verification_code_hash = $1, identity_verification_code_expires_at = $2
          WHERE user_name = $3
        `,
        [codeHash, expiresAt, body.username],
      );

      const notificationTarget = body.verificationChannel === 'sms' ? body.phone : body.email;
      void resolveNotificationChannel(httpLogger)
        .send(notificationTarget, code)
        .catch((error: unknown) => {
          httpLogger.warn(
            { action: 'signup.identity_code.send_failed', err: error },
            'Failed to send identity verification code.',
          );
        });
    } catch (error) {
      httpLogger.warn(
        { action: 'signup.identity_code.generate_failed', username: body.username, err: error },
        'Failed to generate the initial identity verification code; the user can request one via /api/auth/identity/resend.',
      );
    }

    const { token } = signAuthToken(
      { sub: body.username, role: body.role, organizationId, firstName, lastName },
      httpLogger,
    );

    response.status(201).json({
      token,
      username: body.username,
      firstName,
      lastName,
      role: body.role,
      organizationId,
    });
  });

  // Public (PUBLIC_ROUTES): the signup form calls this while filling out the entity section,
  // before an account -- and therefore a token -- exists. Advisory only; it writes nothing. The
  // account's real entity_verification_status is set by the fire-and-forget call inside
  // POST /api/auth/signup and can be re-run post-signup via
  // POST /api/organizations/entity-verification/retry.
  app.post('/api/entity-verification/check', async (request, response, next) => {
    const bodyResult = entityVerificationCheckBodySchema.safeParse(request.body ?? {});
    if (!bodyResult.success) {
      respondWithValidationError(response, bodyResult.error);
      return;
    }

    try {
      const result = await resolveEntityVerificationProvider().verify({
        legalName: bodyResult.data.companyName,
        state: bodyResult.data.entityState,
        filingNumber: bodyResult.data.entityFilingNumber,
        entityType: bodyResult.data.entityType,
      });

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/identity/confirm', async (request, response, next) => {
    if (!request.auth) {
      response.status(401).json({ message: 'Authentication required.' });
      return;
    }

    if (!pool) {
      response
        .status(501)
        .json({ message: 'Identity verification requires a database connection.' });
      return;
    }

    const bodyResult = identityConfirmBodySchema.safeParse(request.body ?? {});
    if (!bodyResult.success) {
      respondWithValidationError(response, bodyResult.error);
      return;
    }

    try {
      const result = await pool.query<{
        identity_verification_code_hash: string | null;
        identity_verification_code_expires_at: Date | null;
      }>(
        `
          SELECT identity_verification_code_hash, identity_verification_code_expires_at
          FROM reconciliation_user
          WHERE user_name = $1
          LIMIT 1
        `,
        [request.auth.username],
      );

      const row = result.rows[0];
      const valid = await verifyIdentityCode(
        bodyResult.data.code,
        row?.identity_verification_code_hash ?? null,
        row?.identity_verification_code_expires_at ?? null,
      );

      if (!valid) {
        response.status(400).json({ message: 'That code is invalid or has expired.' });
        return;
      }

      await pool.query(
        `
          UPDATE reconciliation_user
          SET identity_verification_status = 'verified',
              identity_verification_code_hash = NULL,
              identity_verification_code_expires_at = NULL
          WHERE user_name = $1
        `,
        [request.auth.username],
      );

      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/identity/resend', async (request, response, next) => {
    if (!request.auth) {
      response.status(401).json({ message: 'Authentication required.' });
      return;
    }

    if (!pool) {
      response
        .status(501)
        .json({ message: 'Identity verification requires a database connection.' });
      return;
    }

    try {
      const userResult = await pool.query<{ email: string | null; phone: string | null }>(
        'SELECT email, phone FROM reconciliation_user WHERE user_name = $1 LIMIT 1',
        [request.auth.username],
      );
      const user = userResult.rows[0];
      const target = user?.email ?? user?.phone ?? null;

      if (!target) {
        response.status(409).json({ message: 'No email or phone is on file for this account.' });
        return;
      }

      const { code, codeHash, expiresAt } = await generateIdentityCode();
      await pool.query(
        `
          UPDATE reconciliation_user
          SET identity_verification_code_hash = $1, identity_verification_code_expires_at = $2
          WHERE user_name = $3
        `,
        [codeHash, expiresAt, request.auth.username],
      );

      await resolveNotificationChannel(httpLogger).send(target, code);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/organizations/entity-verification/retry', async (request, response, next) => {
    if (!request.auth) {
      response.status(401).json({ message: 'Authentication required.' });
      return;
    }

    if (!pool) {
      response.status(501).json({ message: 'Entity verification requires a database connection.' });
      return;
    }

    try {
      const orgResult = await pool.query<{
        name: string;
        entity_state: string | null;
        entity_filing_number: string | null;
        entity_type: 'domestic' | 'foreign' | null;
      }>(
        `
          SELECT name, entity_state, entity_filing_number, entity_type
          FROM reconciliation_organization
          WHERE id = $1
          LIMIT 1
        `,
        [request.auth.organizationId],
      );
      const org = orgResult.rows[0];

      if (!org || !org.entity_state || !org.entity_filing_number || !org.entity_type) {
        response
          .status(409)
          .json({ message: 'Entity details are incomplete for this organization.' });
        return;
      }

      const result = await resolveEntityVerificationProvider().verify({
        legalName: org.name,
        state: org.entity_state,
        filingNumber: org.entity_filing_number,
        entityType: org.entity_type,
      });

      await pool.query(
        'UPDATE reconciliation_organization SET entity_verification_status = $1 WHERE id = $2',
        [result.status, request.auth.organizationId],
      );

      response.json({ status: result.status });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/reconciliation/run',
    upload.fields([
      { name: 'bankFile', maxCount: 1 },
      { name: 'glFile', maxCount: 1 },
    ]),
    async (request, response, next) => {
      const started = Date.now();
      let persistenceJobId: string | undefined;
      try {
        const files = getUploadedReconciliationFiles((request.files ?? {}) as UploadFileMap);

        if (!files) {
          response.status(400).json({
            message: 'Both bankFile and glFile must be provided as .xlsx uploads.',
          });
          return;
        }

        const body = (request.body ?? {}) as Record<string, unknown>;
        // requireApplicationAccess (mounted ahead of this route) guarantees request.auth here.
        const organizationId = request.auth!.organizationId;
        if (reconciliationQueue.enabled) {
          const queuedResponse: ReconciliationJobEnqueueResponse =
            await reconciliationQueue.enqueue({
              requestId: resolveCorrelationId(request.id),
              sessionId: request.auth!.jti,
              organizationId,
              body,
              files: toQueuedReconciliationFiles(files),
            });

          response.status(202).json(queuedResponse);
          return;
        }

        const workflowResult = await runReconciliationWorkflow({
          body,
          files,
          requestId: request.id,
          sessionId: request.auth!.jti,
          organizationId,
          requestLog: request.log,
          repository,
          lifecycleStore,
          pool,
        });
        persistenceJobId = workflowResult.persistenceJobId;

        recordSuccessfulReconciliationRun({
          requestId: request.id,
          started,
          result: workflowResult,
        });

        response.status(201).json(sanitizeRun(workflowResult.run));
      } catch (error) {
        // File Validation failure: fail the request with the issues rather than a generic 500 --
        // no lifecycle job was ever registered for it, so there's nothing to mark failed.
        if (error instanceof ReconciliationFileValidationError) {
          response.status(400).json({
            message: 'Uploaded files failed File Validation.',
            bankIssues: error.bankIssues,
            glIssues: error.glIssues,
          });
          return;
        }

        // ReconciliationWorkflowError carries the lifecycle row's id for any failure past
        // registerLifecycleJob -- without it, persistenceJobId stays undefined here (it's only
        // ever assigned from a successful runReconciliationWorkflow return above) and
        // handleFailedReconciliationRun's markFailed call becomes a silent no-op.
        if (error instanceof ReconciliationWorkflowError) {
          persistenceJobId = error.persistenceJobId;
        }

        const requestBody = (request.body ?? {}) as Record<string, unknown>;
        await handleFailedReconciliationRun({
          requestId: request.id,
          requestBody,
          started,
          // requireApplicationAccess (mounted ahead of this route) guarantees request.auth here;
          // this is a fresh read rather than the try block's `organizationId` local, which is out
          // of scope in this catch block.
          organizationId: request.auth!.organizationId,
          lifecycleStore,
          persistenceJobId,
          error,
        });
        next(error);
      }
    },
  );

  app.get('/api/reconciliation/jobs/:jobId', async (request, response, next) => {
    try {
      if (!reconciliationQueue.enabled) {
        response.status(404).json({ message: 'Reconciliation queue is disabled.' });
        return;
      }

      const queuedResult = await reconciliationQueue.getStatus(request.params.jobId);
      if (!queuedResult) {
        response.status(404).json({ message: 'Queued reconciliation job not found.' });
        return;
      }

      let responsePayload = queuedResult;
      if (queuedResult.status === 'completed' && queuedResult.runId && !queuedResult.run) {
        const run = await loadRunReport(request.auth!.organizationId, queuedResult.runId);
        if (run) {
          responsePayload = {
            ...queuedResult,
            run,
          };
        }
      }

      response.json(sanitizeQueuedReconciliationResult(responsePayload));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reconciliation/latest', async (request, response, next) => {
    try {
      const run = await loadLatestRunReport(request.auth!.organizationId);
      if (!run) {
        response.status(404).json({ message: 'No completed reconciliation run found.' });
        return;
      }

      response.json(run);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reconciliation/:id', async (request, response, next) => {
    try {
      const run = await loadRunReport(request.auth!.organizationId, request.params.id);
      if (!run) {
        response.status(404).json({ message: 'Reconciliation run not found.' });
        return;
      }

      response.json(run);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reconciliation/:id/summary', async (request, response, next) => {
    try {
      const summary = await loadRunSummary(request.auth!.organizationId, request.params.id);
      if (!summary) {
        response.status(404).json({ message: 'Reconciliation run not found.' });
        return;
      }

      response.json(summary);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reconciliation/:id/exceptions', async (request, response, next) => {
    try {
      const queryResult = exceptionsQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        respondWithValidationError(response, queryResult.error);
        return;
      }

      const category = queryResult.data.category as ErrorCategory | undefined;
      const severity = queryResult.data.severity as SeverityLevel | undefined;

      const limitRequested = request.query.limit !== undefined;
      const offsetRequested = request.query.offset !== undefined;
      const filterRequested = category !== undefined || severity !== undefined;

      if (limitRequested || offsetRequested || filterRequested) {
        const limit = parseLimit(request.query.limit, 50, 200);
        const offset = parseOffset(request.query.offset, 0);
        const page = await loadRunExceptionPage(
          request.auth!.organizationId,
          request.params.id,
          limit,
          offset,
          { category, severity },
        );

        if (!page) {
          response.status(404).json({ message: 'Reconciliation run not found.' });
          return;
        }

        response.json(page);
        return;
      }

      const exceptions = await loadRunExceptions(request.auth!.organizationId, request.params.id);
      if (!exceptions) {
        response.status(404).json({ message: 'Reconciliation run not found.' });
        return;
      }

      response.json(exceptions);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reconciliation/:id/reviewer-decisions', async (request, response, next) => {
    try {
      const decisions = await loadReviewerDecisions(
        request.auth!.organizationId,
        request.params.id,
      );
      if (!decisions) {
        response.status(404).json({ message: 'Reconciliation run not found.' });
        return;
      }

      response.json(decisions);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/reconciliation/:id/reviewer-decisions', async (request, response, next) => {
    try {
      const run = await loadRunReport(request.auth!.organizationId, request.params.id);
      if (!run) {
        response.status(404).json({ message: 'Reconciliation run not found.' });
        return;
      }

      const bodyResult = reviewerDecisionBodySchema.safeParse(request.body ?? {});
      if (!bodyResult.success) {
        respondWithValidationError(response, bodyResult.error);
        return;
      }

      // The schema's superRefine already confirmed these are valid enum members / non-empty
      // strings; the field types stay `unknown` because that check is cross-field, not structural.
      const targetType = bodyResult.data.targetType as ReviewerDecisionTargetType;
      const targetId = (bodyResult.data.targetId as string).trim();
      const outcome = bodyResult.data.outcome as ReviewerDecisionOutcome;

      if (!findDecisionTarget(run, targetType, targetId)) {
        response
          .status(400)
          .json({ message: 'Reviewer decision target was not found on this reconciliation run.' });
        return;
      }

      const timestamp = new Date().toISOString();
      const decision: ReviewerDecision = {
        id: randomUUID(),
        runId: run.id,
        targetType,
        targetId,
        outcome,
        finalCategory: isErrorCategory(bodyResult.data.finalCategory)
          ? bodyResult.data.finalCategory
          : undefined,
        notes: cleanOptionalText(bodyResult.data.notes),
        reviewerId: cleanOptionalText(bodyResult.data.reviewerId),
        reviewerName: cleanOptionalText(bodyResult.data.reviewerName),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const savedDecision = repository.saveReviewerDecision(run.id, decision);
      if (lifecycleStore) {
        await lifecycleStore.persistReviewerDecision(request.auth!.organizationId, savedDecision);
      }
      response.status(201).json(savedDecision);
    } catch (error) {
      next(error);
    }
  });

  app.delete(
    '/api/reconciliation/:id/reviewer-decisions/:targetId',
    async (request, response, next) => {
      try {
        const run = await loadRunReport(request.auth!.organizationId, request.params.id);
        if (!run) {
          response.status(404).json({ message: 'Reconciliation run not found.' });
          return;
        }

        const queryResult = reviewerDecisionDeleteQuerySchema.safeParse(request.query);
        if (!queryResult.success) {
          respondWithValidationError(response, queryResult.error);
          return;
        }

        const paramsResult = reviewerDecisionDeleteParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          respondWithValidationError(response, paramsResult.error);
          return;
        }

        const targetType = queryResult.data.targetType as ReviewerDecisionTargetType;
        const targetId = paramsResult.data.targetId.trim();

        // Clearing a decision returns the target to undecided; idempotent when none exists.
        if (repository.findById(run.id)) {
          repository.deleteReviewerDecision(run.id, targetType, targetId);
        }
        if (lifecycleStore) {
          await lifecycleStore.deleteReviewerDecision(
            request.auth!.organizationId,
            run.id,
            targetType,
            targetId,
          );
        }

        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  const requirePool = (response: express.Response): boolean => {
    if (!pool) {
      response.status(501).json({ message: 'Alias management requires a database connection.' });
      return false;
    }
    return true;
  };

  // ── File Imports & Validation: create/read a reconciliation_run + its Bank/GL source files ──────
  // No routes here touch validation_issue/canonical_record yet -- this is purely T5(persistence)'s
  // create/read surface (DRAFT status only). Submitting a run for validation is Phase 6, not built.
  const toImportRunFile = (
    role: CreateImportRunFileInput['role'],
    sourceType: 'BANK' | 'GL',
    file: Express.Multer.File,
  ): CreateImportRunFileInput => ({
    role,
    sourceType,
    originalFilename: file.originalname,
    fileFormat: resolveSourceFormat(file.originalname) === 'csv' ? 'CSV' : 'XLSX',
    bytes: file.buffer,
  });

  app.post(
    '/api/imports/runs',
    importUpload.fields([
      // Issue #153: 1-4 bank accounts per run, one repeated field rather than per-slot names.
      { name: 'bankFiles', maxCount: MAX_BANK_ACCOUNTS },
      { name: 'glFile', maxCount: 1 },
    ]),
    async (request, response, next) => {
      if (!requirePool(response)) return;
      // requireApplicationAccess (mounted ahead of this route) guarantees request.auth here.
      // "File reconciliation should stay with the senior Financial analyst" -- an explicit
      // product decision, expressed as its own capability (canSubmitImportRuns) rather than an
      // inline role-string comparison, matching the canApprove gate below.
      if (!rolePermissionsByRole[request.auth!.role].canSubmitImportRuns) {
        response.status(403).json({ message: 'Only a senior analyst may create an import run.' });
        return;
      }

      try {
        const files = getUploadedImportRunFiles((request.files ?? {}) as ImportRunUploadFileMap);
        if (!files) {
          response.status(400).json({
            message: `Between ${MIN_BANK_ACCOUNTS} and ${MAX_BANK_ACCOUNTS} bankFiles uploads and one glFile must all be provided as .csv or .xlsx uploads.`,
          });
          return;
        }

        // ADR-0003 / Issue #141 (widened to N files by Issue #153): every bank file merges into
        // one unified dataset before File Validation ever runs. `findOrCreateImportFile`
        // (importRunStore.ts) dedupes an uploaded file's import_file row by (organization,
        // content hash, source_type) -- every raw bank upload shares source_type 'BANK', so two
        // byte-identical files (the same file attached twice by mistake) would dedupe to the same
        // import_file row and the second run_source_file insert would violate its own UNIQUE
        // constraint. Caught here as a clean 400 rather than surfacing as an unhandled 500 from
        // that constraint violation -- checked pairwise across all N files, not just a fixed pair.
        const bankFileHashes = files.bankFiles.map((file) => computeSha256Hex(file.buffer));
        if (new Set(bankFileHashes).size !== bankFileHashes.length) {
          response.status(400).json({
            message: 'Bank account files cannot be identical uploads.',
          });
          return;
        }

        const bodyResult = importRunBodySchema.safeParse(request.body ?? {});
        if (!bodyResult.success) {
          respondWithValidationError(response, bodyResult.error);
          return;
        }

        const merged = await mergeBankFiles(
          files.bankFiles.map((file) => ({
            bytes: file.buffer,
            fileFormat: resolveSourceFormat(file.originalname) === 'csv' ? 'CSV' : 'XLSX',
            originalFilename: file.originalname,
          })),
        );

        const importRunStore = new PostgresImportRunStore(pool!);
        const summary = await importRunStore.createRun({
          organizationId: request.auth!.organizationId,
          label: bodyResult.data.label,
          accountIdentifier: bodyResult.data.accountIdentifier,
          frequency: bodyResult.data.frequency,
          periodYear: bodyResult.data.periodYear,
          periodMonth: bodyResult.data.periodMonth,
          files: [
            ...files.bankFiles.map((file, index) =>
              toImportRunFile(`BANK_ACCOUNT_${index + 1}`, 'BANK', file),
            ),
            {
              role: 'BANK_MERGED',
              sourceType: 'BANK',
              originalFilename: `(merged) ${files.bankFiles.map((file) => file.originalname).join(' + ')}`,
              fileFormat: merged.fileFormat,
              bytes: merged.bytes,
            },
            toImportRunFile('GL', 'GL', files.glFile),
          ],
        });

        response.status(201).json(summary);
      } catch (error) {
        // Filename-parsing failure is an upload-level problem, not File Validation content
        // problem -- never routed through validation_issue/rule_version.
        if (error instanceof BankFilenameAccountParseError) {
          response.status(400).json({ message: error.message });
          return;
        }
        // A raw per-account file's own structural failure (bad/missing header, wrong column
        // order) -- caught pre-merge so it's attributable to the specific file, not diluted into
        // per-row noise against the merged output. No lifecycle job/import_file rows exist yet
        // for this run, so nothing needs to be marked failed.
        if (error instanceof BankFileStructuralError) {
          response.status(400).json({
            message: error.message,
            originalFilename: error.originalFilename,
            issues: error.issues,
          });
          return;
        }
        // Defensive only -- getUploadedImportRunFiles already rejects a bankFiles count outside
        // [MIN_BANK_ACCOUNTS, MAX_BANK_ACCOUNTS] before mergeBankFiles is ever called, so this
        // should be unreachable via this route in practice.
        if (error instanceof BankFileCountError) {
          response.status(400).json({ message: error.message });
          return;
        }
        next(error);
      }
    },
  );

  // The RunBar's durable "where is my process right now" source (both engines) -- Issue #154.
  // Distinct from GET /api/reconciliation/latest, whose ReconciliationRunResponse shape can only
  // represent a completed report: it cannot express VALIDATION_FAILED (no reconciliation_job row
  // exists yet) or a Stage-2 failure. Must stay registered above '/api/imports/runs/:id' or
  // Express matches 'latest' as an :id -- same ordering constraint as /api/reconciliation/latest
  // above /api/reconciliation/:id.
  app.get('/api/imports/runs/latest', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const importRunStore = new PostgresImportRunStore(pool!);
      const summary = await importRunStore.getLatestRunSummary(request.auth!.organizationId);

      if (!summary) {
        // Not an error -- a fresh organization with no runs yet is a normal state, unlike
        // GET /api/reconciliation/latest's 404 for the analogous case (that endpoint only ever
        // represents a completed report, so "none yet" reads more like "nothing to show" there;
        // here the caller wants to know "what's my run's state, if any," and no run is itself a
        // valid answer).
        response.status(204).end();
        return;
      }

      response.json(summary);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/imports/runs/:id', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const importRunStore = new PostgresImportRunStore(pool!);
      const summary = await importRunStore.getRunSummary(
        request.auth!.organizationId,
        request.params.id,
      );

      if (!summary) {
        response.status(404).json({ message: 'Import run not found.' });
        return;
      }

      response.json(summary);
    } catch (error) {
      next(error);
    }
  });

  // Issue #154 (live status push, Pub/Sub not polling): NDJSON, not strict `text/event-stream`
  // framing -- deliberate, not an oversight. The browser's native EventSource cannot set custom
  // headers, and this app authenticates exclusively via `Authorization: Bearer` (api.ts's
  // apiFetch, authMiddleware.ts) with no cookie-based session anywhere, so EventSource is unusable
  // here regardless of wire format. The client reads this via `fetch()` + a stream reader either
  // way, so plain NDJSON is simpler on both ends than conforming to SSE's `data: `/blank-line
  // framing for no benefit.
  //
  // Only subscribes to importValidationQueueEvents, not reconciliationQueueEvents: Stage 2
  // (matching) for the import-run flow this endpoint serves runs synchronously *inside* the
  // import validation queue's own job (triggerMatchingForImportRun is a direct function call from
  // runImportValidationWorkflow, never a separate reconciliationQueue.enqueue) -- so every
  // checkpoint for both stages of this pipeline publishes through the same onStep, tagged
  // processId: runId, queueType: 'import-validation'. reconciliationQueueEvents exists for the
  // separate standalone /api/reconciliation/run flow (keyed by requestId, not runId), which this
  // endpoint doesn't serve.
  app.get('/api/imports/runs/:id/events', async (request, response) => {
    if (!requirePool(response)) return;
    const organizationId = request.auth!.organizationId;
    const runId = request.params.id;

    const importRunStore = new PostgresImportRunStore(pool!);
    const summary = await importRunStore.getRunSummary(organizationId, runId).catch(() => null);
    if (!summary) {
      response.status(404).json({ message: 'Import run not found.' });
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Node buffers response headers until the first write()/end() call -- without this, a client
    // that connects before any checkpoint exists yet (the common case: opening the stream right
    // after submit, before the first "Validating..." message) would never even see the response
    // begin, since nothing would ever flush the socket until some future write() call.
    response.flushHeaders();

    const writeMessage = (message: QueueProgressMessage): void => {
      response.write(`${JSON.stringify(message)}\n`);
    };

    // Catch-up on connect: a client that opens this stream after an earlier checkpoint was
    // already published (reload mid-run, dropped connection, second tab) would otherwise see
    // nothing until the *next* live message -- QueueEvents' 'progress' event has no replay.
    // Reads recordAuditEvent's own prior writes back as one synthetic first line. Stage-2-only
    // (matchingJobId must exist) -- see getLatestAuditEvent's doc comment for why Stage 1 has no
    // equivalent catch-up yet; the durable-state fetch (GET /api/imports/runs/latest) already
    // covers the coarser "is it running at all" answer regardless.
    if (summary.matchingJobId && lifecycleStore) {
      const latest = await lifecycleStore
        .getLatestAuditEvent(organizationId, summary.matchingJobId)
        .catch(() => null);

      if (latest) {
        writeMessage({
          organizationId,
          processId: runId,
          queueType: 'import-validation',
          statusMessage: latest.eventType,
          details: latest.details,
        });
      }
    }

    const matchesThisConnection = (message: QueueProgressMessage): boolean =>
      message.organizationId === organizationId && message.processId === runId;

    const unsubscribe = importValidationQueueEvents.onProgress((message) => {
      if (matchesThisConnection(message)) {
        writeMessage(message);
      }
    });

    request.on('close', () => {
      unsubscribe();
    });
  });

  // Phase 8 review drilldown: validation_issue/canonical_record rows for a run, paginated and
  // filterable -- GET /api/imports/runs/:id itself only returns file-level summary counts
  // (validation_status/row_count/error_count per import_file), not the individual rows a
  // Comptroller reviewing a PENDING_APPROVAL run would need to see. Mirrors the existing
  // GET /api/reconciliation/:id/exceptions pagination shape (limit/offset/hasMore).
  app.get('/api/imports/runs/:id/issues', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const queryResult = runIssuesQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        respondWithValidationError(response, queryResult.error);
        return;
      }

      const limit = parseLimit(request.query.limit, 50, 200);
      const offset = parseOffset(request.query.offset, 0);
      const page = await new PostgresImportValidationStore(pool!).listRunIssues(
        request.auth!.organizationId,
        request.params.id,
        limit,
        offset,
        {
          severity: queryResult.data.severity as 'ERROR' | 'WARNING' | undefined,
          code: queryResult.data.code as string | undefined,
        },
      );

      if (!page) {
        response.status(404).json({ message: 'Import run not found.' });
        return;
      }

      response.json(page);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/imports/runs/:id/records', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const queryResult = runRecordsQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        respondWithValidationError(response, queryResult.error);
        return;
      }

      const limit = parseLimit(request.query.limit, 50, 200);
      const offset = parseOffset(request.query.offset, 0);
      const page = await new PostgresImportValidationStore(pool!).listRunRecords(
        request.auth!.organizationId,
        request.params.id,
        limit,
        offset,
        {
          sourceType: queryResult.data.sourceType as string | undefined,
          importFileId: queryResult.data.importFileId as string | undefined,
        },
      );

      if (!page) {
        response.status(404).json({ message: 'Import run not found.' });
        return;
      }

      response.json(page);
    } catch (error) {
      next(error);
    }
  });

  // Phase 11: full failure detail for one file within a run (gate sequence, header comparison,
  // issues) -- Screens 05/07 render from this rather than assembling it client-side from
  // /issues + /records, since the header comparison needs a server-side re-parse of the stored
  // original (see importFailureDetailService.ts's doc comment).
  app.get('/api/imports/runs/:id/files/:fileId/failure-detail', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const organizationId = request.auth!.organizationId;
      const runId = request.params.id;
      const fileId = request.params.fileId;

      const importRunStore = new PostgresImportRunStore(pool!);
      const file = await importRunStore.getFileWithBytes(organizationId, runId, fileId);
      if (!file) {
        response.status(404).json({ message: 'Import run or file not found.' });
        return;
      }

      const importValidationStore = new PostgresImportValidationStore(pool!);
      const [issuesPage, recordsPage] = await Promise.all([
        importValidationStore.listRunIssues(organizationId, runId, 500, 0, {
          importFileId: fileId,
        }),
        importValidationStore.listRunRecords(organizationId, runId, 1, 0, {
          importFileId: fileId,
        }),
      ]);

      if (!issuesPage || !recordsPage) {
        response.status(404).json({ message: 'Import run not found.' });
        return;
      }

      const detail = await buildImportFileFailureDetail({
        importFileId: file.importFileId,
        originalFilename: file.originalFilename,
        sourceType: file.sourceType,
        fileFormat: file.fileFormat,
        validationStatus: file.validationStatus,
        rowCount: file.rowCount,
        errorCount: file.errorCount,
        warningCount: file.warningCount,
        importableRowCount: recordsPage.total,
        bytes: file.bytes,
        issues: issuesPage.items,
      });

      response.json(detail);
    } catch (error) {
      next(error);
    }
  });

  // Phase 12 (Screen 06): every row of one file, re-parsed from the stored original and
  // annotated with its already-persisted issues -- see importRowGridService.ts's doc comment for
  // why this re-parses rather than reading validation_issue alone (raw cell values were never
  // persisted there).
  app.get('/api/imports/runs/:id/files/:fileId/rows', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const organizationId = request.auth!.organizationId;
      const runId = request.params.id;
      const fileId = request.params.fileId;

      const importRunStore = new PostgresImportRunStore(pool!);
      const file = await importRunStore.getFileWithBytes(organizationId, runId, fileId);
      if (!file) {
        response.status(404).json({ message: 'Import run or file not found.' });
        return;
      }

      const importValidationStore = new PostgresImportValidationStore(pool!);
      const issuesPage = await importValidationStore.listRunIssues(organizationId, runId, 5000, 0, {
        importFileId: fileId,
      });
      if (!issuesPage) {
        response.status(404).json({ message: 'Import run not found.' });
        return;
      }

      const grid = await buildImportRowGrid({
        bytes: file.bytes,
        fileFormat: file.fileFormat,
        issues: issuesPage.items,
      });

      response.json(grid);
    } catch (error) {
      next(error);
    }
  });

  // README §7.8: file,line,column,code,severity,message,raw_value -- one row per finding, ordered
  // by file then line then column (buildErrorReportCsv does the ordering).
  app.get('/api/imports/runs/:id/error-report.csv', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const organizationId = request.auth!.organizationId;
      const runId = request.params.id;

      const importRunStore = new PostgresImportRunStore(pool!);
      const summary = await importRunStore.getRunSummary(organizationId, runId);
      if (!summary) {
        response.status(404).json({ message: 'Import run not found.' });
        return;
      }

      const filenameByFileId = new Map(
        summary.files.map((file) => [file.importFileId, file.originalFilename]),
      );

      const importValidationStore = new PostgresImportValidationStore(pool!);
      const issuesPage = await importValidationStore.listRunIssues(organizationId, runId, 5000, 0);
      if (!issuesPage) {
        response.status(404).json({ message: 'Import run not found.' });
        return;
      }

      const csv = buildErrorReportCsv(
        issuesPage.items.map((issue) => ({
          file: filenameByFileId.get(issue.importFileId) ?? issue.importFileId,
          line: issue.rowNumber,
          column: issue.field,
          code: issue.code,
          severity: issue.severity,
          message: issue.message,
        })),
      );

      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="import-run-${runId}-error-report.csv"`,
      );
      response.send(csv);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/imports/runs/:id/submit', async (request, response, next) => {
    if (!requirePool(response)) return;
    // Same gate as create -- submitting is part of the same senior-analyst-owned action, not a
    // separate capability.
    if (!rolePermissionsByRole[request.auth!.role].canSubmitImportRuns) {
      response.status(403).json({ message: 'Only a senior analyst may submit an import run.' });
      return;
    }

    try {
      const organizationId = request.auth!.organizationId;
      const runId = request.params.id;
      const importValidationStore = new PostgresImportValidationStore(pool!);

      const submitResult = await importValidationStore.submitRun(
        organizationId,
        runId,
        request.auth!.username,
      );

      if (submitResult.outcome === 'not_found') {
        response.status(404).json({ message: 'Import run not found.' });
        return;
      }

      if (submitResult.outcome === 'invalid_state') {
        response.status(409).json({
          message: `Import run cannot be submitted from status ${submitResult.currentStatus}.`,
        });
        return;
      }

      const { importJobId } = submitResult;

      if (importValidationQueue.enabled) {
        await importValidationQueue.enqueue({
          organizationId,
          runId,
          importJobId,
          sessionId: request.auth!.jti,
        });
        response.status(202).json({ importJobId, status: 'queued' });
        return;
      }

      // No queue configured -- process synchronously in-request, same fallback shape
      // /api/reconciliation/run already uses when reconciliationQueue.enabled is false.
      const result = await processImportValidationJob({
        organizationId,
        runId,
        importJobId,
        workerId: importValidationWorkerId,
        pool: pool!,
        repository,
        lifecycleStore,
        requestLog: request.log,
        sessionId: request.auth!.jti,
      });

      const importRunStore = new PostgresImportRunStore(pool!);
      const run = await importRunStore.getRunSummary(organizationId, runId);

      response.status(200).json({ importJobId, ...result, run });
    } catch (error) {
      next(error);
    }
  });

  // Phase 14: README §7 item 7, "an analyst... may withdraw a submission" -- pulls a
  // PENDING_APPROVAL run back to DRAFT. Self-service (the submitter withdrawing their own run),
  // not a general approver action, so this lives under /api/imports/runs/:id rather than the
  // polymorphic /api/approvals/:type/:id/* surface Phase 7 built for approver decisions.
  app.post('/api/imports/runs/:id/withdraw', async (request, response, next) => {
    if (!requirePool(response)) return;
    if (!rolePermissionsByRole[request.auth!.role].canSubmitImportRuns) {
      response.status(403).json({ message: 'Only a senior analyst may withdraw an import run.' });
      return;
    }

    try {
      const organizationId = request.auth!.organizationId;
      const runId = request.params.id;
      const importValidationStore = new PostgresImportValidationStore(pool!);

      const result = await importValidationStore.withdrawRunApproval(
        organizationId,
        runId,
        request.auth!.username,
      );

      if (result.outcome === 'not_found') {
        response.status(404).json({ message: 'Import run not found.' });
        return;
      }
      if (result.outcome === 'invalid_state') {
        response.status(409).json({
          message: `Import run cannot be withdrawn from status ${result.currentStatus}.`,
        });
        return;
      }
      if (result.outcome === 'not_submitter') {
        response
          .status(403)
          .json({ message: 'Only the analyst who submitted this run may withdraw it.' });
        return;
      }

      const importRunStore = new PostgresImportRunStore(pool!);
      const run = await importRunStore.getRunSummary(organizationId, runId);
      response.json({ run });
    } catch (error) {
      next(error);
    }
  });

  // Unreconciled Item Roll-Forward PR E.2. Same canApprove gate as the polymorphic approval
  // decision endpoint (RailMenuMods: Controller/VP Finance/CFO/Admin/Superuser) -- closing a
  // period is a comptroller-level action, not a self-service one, matching the segregation-of-duty
  // CHECK on closed_by/submitted_by this same call is subject to.
  app.post('/api/imports/runs/:id/close', async (request, response, next) => {
    if (!requirePool(response)) return;
    if (!rolePermissionsByRole[request.auth!.role].canApprove) {
      response.status(403).json({ message: 'Only an approver may close a reconciliation period.' });
      return;
    }

    try {
      const { organizationId, username } = request.auth!;
      const runId = request.params.id;
      const openItemStore = new PostgresOpenItemStore(pool!);

      const result = await openItemStore.closeRun(organizationId, { runId, actorUsername: username });

      if (result.outcome === 'not_found') {
        response.status(404).json({ message: 'Reconciliation run not found.' });
        return;
      }
      if (result.outcome === 'not_closable') {
        response.status(409).json({
          message: `Run cannot be closed from status ${result.status}. A period can only be closed once its reconciliation has finished (status RECONCILED).`,
        });
        return;
      }
      if (result.outcome === 'tie_out_failed') {
        response.status(409).json({
          message: 'Period close rejected: roll-forward tie-out failed for one or more accounts.',
          discrepancies: result.discrepancies,
        });
        return;
      }

      response.json({ snapshots: result.snapshots });
    } catch (error) {
      next(error);
    }
  });

  // Unreconciled Item Roll-Forward PR E.3.
  app.post('/api/imports/runs/:id/reopen', async (request, response, next) => {
    if (!requirePool(response)) return;
    if (!rolePermissionsByRole[request.auth!.role].canApprove) {
      response.status(403).json({ message: 'Only an approver may reopen a reconciliation period.' });
      return;
    }

    try {
      const { organizationId, username } = request.auth!;
      const runId = request.params.id;
      const openItemStore = new PostgresOpenItemStore(pool!);

      const result = await openItemStore.reopenRun(organizationId, { runId, actorUsername: username });

      if (result.outcome === 'not_found') {
        response.status(404).json({ message: 'Reconciliation run not found.' });
        return;
      }
      if (result.outcome === 'not_closed') {
        response
          .status(409)
          .json({ message: `Run cannot be reopened from status ${result.status}; it is not CLOSED.` });
        return;
      }

      response.json({ reopenCount: result.reopenCount, staleSnapshotCount: result.staleSnapshotCount });
    } catch (error) {
      next(error);
    }
  });

  // Unreconciled Item Roll-Forward PR E.4. Mechanism only -- see writeOffOpenItemBodySchema and
  // PostgresOpenItemStore.writeOffOpenItem's own doc comments for why there is no automatic
  // amount/age approval gate here yet.
  app.post('/api/imports/open-items/:id/write-off', async (request, response, next) => {
    if (!requirePool(response)) return;
    if (!rolePermissionsByRole[request.auth!.role].canApprove) {
      response.status(403).json({ message: 'Only an approver may write off an open item.' });
      return;
    }

    try {
      const bodyResult = writeOffOpenItemBodySchema.safeParse(request.body ?? {});
      if (!bodyResult.success) {
        respondWithValidationError(response, bodyResult.error);
        return;
      }

      const { organizationId, username } = request.auth!;
      const openItemId = request.params.id;
      const openItemStore = new PostgresOpenItemStore(pool!);

      const result = await openItemStore.writeOffOpenItem(organizationId, {
        openItemId,
        actorUsername: username,
        dispositionCode: bodyResult.data.dispositionCode,
        dispositionNote: bodyResult.data.dispositionNote,
      });

      if (result.outcome === 'not_found') {
        response.status(404).json({ message: 'Open item not found.' });
        return;
      }
      if (result.outcome === 'not_open') {
        response
          .status(409)
          .json({ message: `Open item cannot be written off from status ${result.status}; it is not OPEN.` });
        return;
      }

      response.json({ outcome: 'written_off' });
    } catch (error) {
      next(error);
    }
  });

  // Phase 12 (Screen 06): accepts a VALIDATION_FAILED run's already-passing rows and triggers
  // matching -- per the decided scope, matching still processes the *original* file bytes in
  // full (the existing GL<->Bank engine has no concept of excluded rows and stays isolated from
  // the File Validation Engine, same "Rule Engineer" boundary as toReconciliationUploadFile's own
  // comment). "Skipping" invalid rows here means accepting the run despite them, not removing
  // them from reconciliation -- the response/UI say so.
  app.post('/api/imports/runs/:id/import', async (request, response, next) => {
    if (!requirePool(response)) return;
    if (!rolePermissionsByRole[request.auth!.role].canSubmitImportRuns) {
      response
        .status(403)
        .json({ message: 'Only a senior analyst may import a partially-valid run.' });
      return;
    }

    try {
      const bodyResult = importRunPartialImportBodySchema.safeParse(request.body ?? {});
      if (!bodyResult.success) {
        respondWithValidationError(response, bodyResult.error);
        return;
      }
      if (!bodyResult.data.skipInvalidRows) {
        response.status(400).json({
          message:
            'Importing without skipping invalid rows is not supported -- fix and re-upload instead.',
        });
        return;
      }

      const organizationId = request.auth!.organizationId;
      const runId = request.params.id;
      const importValidationStore = new PostgresImportValidationStore(pool!);
      const importRunStore = new PostgresImportRunStore(pool!);

      const acceptResult = await importValidationStore.acceptPartialImport(
        organizationId,
        runId,
        request.auth!.username,
      );

      if (acceptResult.outcome === 'not_found') {
        response.status(404).json({ message: 'Import run not found.' });
        return;
      }
      if (acceptResult.outcome === 'invalid_state') {
        response.status(409).json({
          message: `Import run cannot be partially imported from status ${acceptResult.currentStatus}.`,
        });
        return;
      }
      if (acceptResult.outcome === 'structural_failure') {
        response.status(409).json({
          message:
            'This run has a structural validation failure -- fix and re-upload instead of a partial import.',
        });
        return;
      }
      if (acceptResult.outcome === 'no_importable_rows') {
        response.status(409).json({
          message: 'At least one file has zero importable rows -- partial import is unavailable.',
        });
        return;
      }

      const summary = await importRunStore.getRunSummary(organizationId, runId);
      const bankFileSummary = summary!.files.find((file) => file.role === 'BANK_MERGED')!;
      const glFileSummary = summary!.files.find((file) => file.role === 'GL')!;
      const [bankWithBytes, glWithBytes] = await Promise.all([
        importRunStore.getFileWithBytes(organizationId, runId, bankFileSummary.importFileId),
        importRunStore.getFileWithBytes(organizationId, runId, glFileSummary.importFileId),
      ]);

      // Re-runs File Validation against the already-fetched bytes rather than persisting/fetching
      // a second copy of canonical_record -- validateFile is pure and deterministic, and this run
      // already passed validation once (or is here specifically because skipInvalidRows accepted
      // it despite some rows failing), so this is a cheap re-derivation, not new business logic.
      const [bankOutcome, glOutcome] = await Promise.all([
        validateFile({
          bytes: bankWithBytes!.bytes,
          fileFormat: bankFileSummary.fileFormat,
          fileType: 'BANK',
        }),
        validateFile({
          bytes: glWithBytes!.bytes,
          fileFormat: glFileSummary.fileFormat,
          fileType: 'GL',
        }),
      ]);

      const { matchingJobId } = await triggerMatchingForImportRun({
        files: {
          bankFile: {
            buffer: bankWithBytes!.bytes,
            originalname: bankWithBytes!.originalFilename,
            normalized: bankOutcome.normalized,
          },
          glFile: {
            buffer: glWithBytes!.bytes,
            originalname: glWithBytes!.originalFilename,
            normalized: glOutcome.normalized,
          },
        },
        organizationId,
        repository,
        lifecycleStore,
        pool: pool!,
        requestLog: request.log,
        sessionId: request.auth!.jti,
        declaredAnchorDate: summary!.periodEnd ?? undefined,
        reconciliationRunId: runId,
      });

      await importValidationStore.recordMatchingJobId(organizationId, runId, matchingJobId);

      const finalSummary = await importRunStore.getRunSummary(organizationId, runId);
      response
        .status(200)
        .json({ status: 'completed', passed: true, matchingJobId, run: finalSummary });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/aliases', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const { accountIdentifier } = aliasesQuerySchema.parse(request.query);
      const aliases = await loadPayeeAliases(
        pool!,
        request.auth!.organizationId,
        accountIdentifier,
      );
      response.json(aliases);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/aliases', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const bodyResult = createAliasBodySchema.safeParse(request.body ?? {});
      if (!bodyResult.success) {
        respondWithValidationError(response, bodyResult.error);
        return;
      }

      // organizationId comes from the authenticated principal, never the request body -- a
      // client-supplied tenant would let one customer write rows into another's data.
      const input: CreatePayeeAliasInput = {
        ...bodyResult.data,
        organizationId: request.auth!.organizationId,
      };
      const alias = await createPayeeAlias(pool!, input);
      response.status(201).json(alias);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/aliases/:id', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const bodyResult = updateAliasBodySchema.safeParse(request.body ?? {});
      if (!bodyResult.success) {
        respondWithValidationError(response, bodyResult.error);
        return;
      }

      const alias = await updatePayeeAlias(
        pool!,
        request.auth!.organizationId,
        request.params.id,
        bodyResult.data,
      );

      if (!alias) {
        response.status(404).json({ message: 'Alias not found.' });
        return;
      }

      response.json(alias);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/aliases/:id', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const deactivated = await deactivatePayeeAlias(
        pool!,
        request.auth!.organizationId,
        request.params.id,
      );
      if (!deactivated) {
        response.status(404).json({ message: 'Alias not found.' });
        return;
      }
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/mapping/canonical-fields', (_request, response) => {
    response.json(CANONICAL_FIELDS);
  });

  app.get('/api/mapping/profiles', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const names = await listMappingProfiles(pool!, request.auth!.organizationId);
      response.json(names);
    } catch (error) {
      next(error);
    }
  });

  // ISSUE-050.1: the "read/access" stage of the mapping profile lifecycle audit trail -- until
  // this route existed there was nothing to log an access event against (GET /api/mapping/profiles
  // above only ever returned bare names for the rule grid's ASSIGNED TO chips, not a profile's
  // actual detail or version history).
  app.get('/api/mapping/profiles/:name', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const detail = await getMappingProfileDetail(
        pool!,
        request.auth!.organizationId,
        request.params.name,
        request.auth!.username,
      );

      if (!detail) {
        response.status(404).json({ message: 'Mapping profile not found.' });
        return;
      }

      httpLogger.info(
        {
          action: 'mapping_profile.read',
          organizationId: request.auth!.organizationId,
          actor: request.auth!.username,
          profileName: request.params.name,
          glVersionCount: detail.gl?.versions.length ?? 0,
          bankVersionCount: detail.bank?.versions.length ?? 0,
        },
        'Mapping profile detail accessed',
      );

      response.json(detail);
    } catch (error) {
      next(error);
    }
  });

  // ISSUE-050.1: the "retirement" stage -- status was dead schema (referenced only in TS row
  // types, never written) before this. Retires both sides of the named profile together, since a
  // profile is created and thought of as one named entity even though it's two rows internally.
  app.post(
    '/api/mapping/profiles/:name/retire',
    requireFullyVerified,
    async (request, response, next) => {
      if (!requirePool(response)) return;
      try {
        // Combining a route param with a preceding middleware (requireFullyVerified) widens
        // Express's inferred param type away from the path-literal-derived `string` -- the
        // runtime value is always a plain string for a concrete `:name` segment regardless.
        const profileName = request.params.name as string;
        const retired = await retireMappingProfile(
          pool!,
          request.auth!.organizationId,
          profileName,
          request.auth!.username,
        );

        if (retired.length === 0) {
          response
            .status(404)
            .json({ message: 'No active mapping profile with that name was found to retire.' });
          return;
        }

        httpLogger.info(
          {
            action: 'mapping_profile.retired',
            organizationId: request.auth!.organizationId,
            actor: request.auth!.username,
            profileName,
            sidesRetired: retired.map((profile) => profile.sourceType),
          },
          'Mapping profile retired',
        );

        response.json(retired);
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/api/rules/catalog', (_request, response) => {
    response.json(RULES_CATALOG);
  });

  app.get('/api/rules/versions', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const organizationId = request.auth!.organizationId;
      const versions = await listMatchingConfigVersions(pool!, organizationId);

      response.json({
        active: versions.find((version) => version.status === 'ACTIVE') ?? null,
        draft: versions.find((version) => version.status === 'DRAFT') ?? null,
        history: versions,
        overridesAppliedToEngine: OVERRIDES_APPLIED_TO_ENGINE,
      } satisfies RuleVersionsResponse);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/rules/versions/draft', async (request, response, next) => {
    if (!requirePool(response)) return;
    // Mirrors the client-side gate on canAdjustSliderDefaults (App.tsx) server-side -- this is a
    // new mutating, org-wide-visible endpoint, so it needs its own enforcement rather than
    // trusting the UI to have hidden the control.
    if (!rolePermissionsByRole[request.auth!.role].canAdjustSliderDefaults) {
      response.status(403).json({ message: 'Only admins can draft a matching-config version.' });
      return;
    }
    try {
      const bodyResult = matchingConfigVersionDraftBodySchema.safeParse(request.body ?? {});
      if (!bodyResult.success) {
        respondWithValidationError(response, bodyResult.error);
        return;
      }
      const unknownMetricId = Object.keys(bodyResult.data.varianceOverrides).find(
        (id) => !RULES_CATALOG_METRIC_IDS.has(id),
      );
      if (unknownMetricId) {
        response.status(400).json({ message: `Unknown variance metric id: ${unknownMetricId}.` });
        return;
      }

      const version = await createMatchingConfigVersionDraft(pool!, {
        id: randomUUID(),
        organizationId: request.auth!.organizationId,
        varianceOverrides: bodyResult.data.varianceOverrides,
        createdBy: request.auth!.username,
        pendingApprovalOwner: bodyResult.data.pendingApprovalOwner ?? null,
      });
      // Opens the Approvals-queue gate for this draft (subjectType 'matchingRule' covers both
      // rule and variance-threshold changes -- they're fields on the same versioned object, not
      // separate entities; see toGenericApprovalRow below).
      await createApprovalRequest(pool!, request.auth!.organizationId, {
        id: randomUUID(),
        subjectType: 'matchingRule',
        subjectId: version.id,
        submittedBy: request.auth!.username,
      });
      response.status(201).json(version);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        response
          .status(409)
          .json({ message: 'A draft version is already pending for this organization.' });
        return;
      }
      next(error);
    }
  });

  app.post('/api/rules/versions/:id/publish', async (request, response, next) => {
    if (!requirePool(response)) return;
    if (!rolePermissionsByRole[request.auth!.role].canAdjustSliderDefaults) {
      response.status(403).json({ message: 'Only admins can publish a matching-config version.' });
      return;
    }
    try {
      const bodyResult = publishMatchingConfigVersionBodySchema.safeParse(request.body ?? {});
      if (!bodyResult.success) {
        respondWithValidationError(response, bodyResult.error);
        return;
      }

      const version = await publishMatchingConfigVersion(
        pool!,
        request.auth!.organizationId,
        request.params.id,
        { publishedBy: request.auth!.username, effectiveAt: bodyResult.data.effectiveAt },
      );

      // This admin-direct-publish path bypasses the Approvals queue, but if this draft has a
      // pending approval request (the normal path opens one at draft time), resolve it too so the
      // queue doesn't keep showing a now-stale PENDING row for an already-published version.
      const pendingRequests = await listApprovalRequests(pool!, request.auth!.organizationId, {
        subjectType: 'matchingRule',
        status: 'PENDING',
      });
      const pendingRequest = pendingRequests.find(
        (candidate) => candidate.subjectId === request.params.id,
      );
      if (pendingRequest) {
        await recordApprovalRequestDecision(pool!, request.auth!.organizationId, {
          approvalRequestId: pendingRequest.id,
          toStatus: 'APPROVED',
          actor: request.auth!.username,
          rationale: 'Published directly by an admin.',
        });
      }

      response.json(version);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'publishMatchingConfigVersion: no matching DRAFT version to publish'
      ) {
        response.status(404).json({ message: 'No matching draft version to publish.' });
        return;
      }
      next(error);
    }
  });

  const GENERIC_APPROVABLE_TYPES: GenericApprovableType[] = [
    'mappingProfile',
    'matchingRule',
    'varianceThreshold',
    'exceptionResolution',
    'reportDistribution',
  ];

  const ageHoursSince = (isoTimestamp: string): number =>
    Math.max(0, Math.round((Date.now() - new Date(isoTimestamp).getTime()) / (60 * 60 * 1000)));

  const toImportApprovalRow = (item: ImportApprovalListItem): ApprovalRow => ({
    id: item.id,
    type: 'import',
    title: item.fileName,
    meta: `${item.sourceSystem.toUpperCase()} import`,
    submitter: item.uploadedBy,
    approver: item.approvedBy ?? null,
    ageHours: ageHoursSince(item.requestedAt),
    state: item.status,
  });

  // reconciliation_run has no OVERRIDDEN equivalent (see approvableTypes' own doc comment on
  // 'reconciliationRun') -- PENDING_APPROVAL is the only status this mapping needs to translate,
  // APPROVED/REJECTED already match ImportApprovalStatus's own spelling.
  const toRunApprovalRow = (item: RunApprovalListItem): ApprovalRow => ({
    id: item.id,
    type: 'reconciliationRun',
    title: item.label,
    meta: `${item.frequency === 'MONTHLY' ? 'Monthly' : 'Annual'} recon · ${
      item.periodMonth ? `${item.periodMonth}/${item.periodYear}` : item.periodYear
    }`,
    submitter: item.submittedByUsername,
    approver: item.decidedByUsername,
    ageHours: ageHoursSince(item.submittedAt),
    state: item.status === 'PENDING_APPROVAL' ? 'PENDING' : item.status,
  });

  // matchingRule and varianceThreshold both point at reconciliation_matching_config_version --
  // variance-threshold changes are a field on that same versioned object (varianceOverrides), not
  // a separate entity, so both subject types resolve their title the same way. mappingProfile,
  // exceptionResolution and reportDistribution have no creation trigger wired yet (see the
  // Approvals feature's known-gaps note), so nothing ever populates them today -- the fallback
  // title (the raw subject id) exists for correctness once one of those gets a real trigger, not
  // because it's expected to render now.
  const toGenericApprovalRow = async (
    organizationId: string,
    record: ApprovalRequestRecord,
  ): Promise<ApprovalRow> => {
    let title = record.subjectId;
    let meta: string | undefined;
    if (record.subjectType === 'matchingRule' || record.subjectType === 'varianceThreshold') {
      const versions = await listMatchingConfigVersions(pool!, organizationId);
      const version = versions.find((candidate) => candidate.id === record.subjectId);
      if (version) {
        title = `Matching config v${version.versionNumber}`;
        meta =
          record.subjectType === 'varianceThreshold'
            ? 'Variance threshold change'
            : 'Matching rule change';
      }
    }
    return {
      id: record.id,
      type: record.subjectType,
      title,
      meta,
      submitter: record.submittedBy,
      approver: record.decidedBy ?? null,
      ageHours: ageHoursSince(record.requestedAt),
      state: record.status,
    };
  };

  app.get('/api/approvals', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const queryResult = approvalsQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        respondWithValidationError(response, queryResult.error);
        return;
      }
      const { type, tab } = queryResult.data;
      const { organizationId, username, role } = request.auth!;
      const canApprove = rolePermissionsByRole[role].canApprove;
      const tabStatus: Extract<ImportApprovalStatus, 'PENDING' | 'APPROVED' | 'REJECTED'> =
        tab === 'pending' ? 'PENDING' : tab === 'approved' ? 'APPROVED' : 'REJECTED';

      if (type === 'import') {
        const filter: ListImportApprovalsFilter =
          tab === 'mine'
            ? { uploadedBy: username }
            : canApprove
              ? {
                  status: tabStatus,
                  routedToOrUnassigned: tab === 'pending' ? username : undefined,
                }
              : { status: tabStatus, uploadedBy: username };

        const items = await listImportApprovals(pool!, organizationId, filter);
        response.json(items.map(toImportApprovalRow) satisfies ApprovalRow[]);
        return;
      }

      if (type === 'reconciliationRun') {
        const runStatus = tabStatus === 'PENDING' ? 'PENDING_APPROVAL' : tabStatus;
        const runFilter: ListRunApprovalsFilter =
          tab === 'mine'
            ? { submittedByUsername: username }
            : canApprove
              ? {
                  status: runStatus,
                  routedToOrUnassignedUsername: tab === 'pending' ? username : undefined,
                }
              : { status: runStatus, submittedByUsername: username };

        const items = await new PostgresImportValidationStore(pool!).listRunApprovals(
          organizationId,
          runFilter,
        );
        response.json(items.map(toRunApprovalRow) satisfies ApprovalRow[]);
        return;
      }

      const genericFilter: ListApprovalRequestsFilter =
        tab === 'mine'
          ? { subjectType: type, submittedBy: username }
          : canApprove
            ? {
                subjectType: type,
                status: tabStatus,
                routedToOrUnassigned: tab === 'pending' ? username : undefined,
              }
            : { subjectType: type, status: tabStatus, submittedBy: username };

      const records = await listApprovalRequests(pool!, organizationId, genericFilter);
      const rows = await Promise.all(
        records.map((record) => toGenericApprovalRow(organizationId, record)),
      );
      response.json(rows satisfies ApprovalRow[]);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/approvals/counts', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const { organizationId, username, role } = request.auth!;
      const canApprove = rolePermissionsByRole[role].canApprove;
      const [
        importCounts,
        runCounts,
        mappingProfileCounts,
        matchingRuleCounts,
        exceptionResolutionCounts,
        reportDistributionCounts,
      ] = await Promise.all([
        getImportApprovalCounts(pool!, organizationId, username, canApprove),
        new PostgresImportValidationStore(pool!).getRunApprovalCounts(
          organizationId,
          username,
          canApprove,
        ),
        getApprovalRequestCounts(pool!, organizationId, username, canApprove, ['mappingProfile']),
        getApprovalRequestCounts(pool!, organizationId, username, canApprove, [
          'matchingRule',
          'varianceThreshold',
        ]),
        getApprovalRequestCounts(pool!, organizationId, username, canApprove, [
          'exceptionResolution',
        ]),
        getApprovalRequestCounts(pool!, organizationId, username, canApprove, [
          'reportDistribution',
        ]),
      ]);
      response.json({
        // 'reconciliationRun' shares the 'import' rail submenu (approvableTypes' own doc comment)
        // -- its counts merge into the same badge, same pattern as matchingRule+varianceThreshold
        // merging into the 'matchingRule' key below, just summed by hand since the two row types
        // come from genuinely different tables/queries rather than one IN-list query.
        import: {
          pending: importCounts.pending + runCounts.pending,
          approved: importCounts.approved + runCounts.approved,
          rejected: importCounts.rejected + runCounts.rejected,
          mySubmissions: importCounts.mySubmissions + runCounts.mySubmissions,
        },
        mappingProfile: mappingProfileCounts,
        matchingRule: matchingRuleCounts,
        exceptionResolution: exceptionResolutionCounts,
        reportDistribution: reportDistributionCounts,
      } satisfies ApprovalCountsByGroup);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/approvals/:type/:id/decision', async (request, response, next) => {
    if (!requirePool(response)) return;
    // Only approvers may decide -- mirrors the canAdjustSliderDefaults gate above, on the new
    // canApprove permission (RailMenuMods: Controller/VP Finance/CFO/Admin/Superuser).
    if (!rolePermissionsByRole[request.auth!.role].canApprove) {
      response.status(403).json({ message: 'Only approvers can decide on an approval.' });
      return;
    }
    const type = request.params.type as ApprovableType;
    try {
      const bodyResult = approvalDecisionBodySchema.safeParse(request.body ?? {});
      if (!bodyResult.success) {
        respondWithValidationError(response, bodyResult.error);
        return;
      }
      const { organizationId, username } = request.auth!;

      if (type === 'import') {
        const approval = await recordApprovalDecision(pool!, organizationId, {
          approvalId: request.params.id,
          toStatus: bodyResult.data.status,
          actor: username,
          rationale: bodyResult.data.rationale,
        });
        response.json(approval);
        return;
      }

      if (type === 'reconciliationRun') {
        // reconciliation_run's status enum (changeset 0042) has no OVERRIDDEN value -- reject
        // before ever touching the DB rather than letting a CHECK violation surface as a raw error.
        if (bodyResult.data.status === 'OVERRIDDEN') {
          response
            .status(400)
            .json({ message: 'An import run decision must be APPROVED or REJECTED.' });
          return;
        }

        const result = await new PostgresImportValidationStore(pool!).recordRunApprovalDecision(
          organizationId,
          {
            runId: request.params.id,
            toStatus: bodyResult.data.status,
            actorUsername: username,
            rationale: bodyResult.data.rationale,
            allowSelfApproval:
              superuserSelfApprovalEnabled && request.auth!.role === 'superuser',
          },
        );

        if (result.outcome === 'not_found') {
          response.status(404).json({ message: 'Import run not found or not pending approval.' });
          return;
        }

        response.json(result.item);
        return;
      }

      if (!GENERIC_APPROVABLE_TYPES.includes(type as GenericApprovableType)) {
        response.status(400).json({ message: `Unknown approvable type: ${type}.` });
        return;
      }

      // For a matching-config version, approving IS publishing it -- do that first so an invalid
      // publish (e.g. the draft was already published or withdrawn out from under this approval
      // request) fails loudly instead of leaving a decision recorded against a no-op.
      if (
        bodyResult.data.status === 'APPROVED' &&
        (type === 'matchingRule' || type === 'varianceThreshold')
      ) {
        const [record] = await listApprovalRequests(pool!, organizationId, {
          subjectType: type,
          status: 'PENDING',
        }).then((records) => records.filter((candidate) => candidate.id === request.params.id));
        if (!record) {
          response.status(404).json({ message: 'Approval request not found.' });
          return;
        }
        await publishMatchingConfigVersion(pool!, organizationId, record.subjectId, {
          publishedBy: username,
        });
      }

      const decided = await recordApprovalRequestDecision(pool!, organizationId, {
        approvalRequestId: request.params.id,
        toStatus: bodyResult.data.status,
        actor: username,
        rationale: bodyResult.data.rationale,
      });
      response.json(decided);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('reconciliation_import_approval not found')
      ) {
        response.status(404).json({ message: 'Import approval not found.' });
        return;
      }
      if (
        error instanceof Error &&
        error.message.startsWith('reconciliation_approval_request not found')
      ) {
        response.status(404).json({ message: 'Approval request not found.' });
        return;
      }
      if (
        error instanceof Error &&
        error.message === 'publishMatchingConfigVersion: no matching DRAFT version to publish'
      ) {
        response.status(409).json({ message: 'This draft is no longer pending publish.' });
        return;
      }
      // reconciliation_run_segregation_of_duty_check (changeset 0042): the run's own submitter
      // tried to also decide it.
      if ((error as { code?: string }).code === '23514') {
        response
          .status(409)
          .json({ message: 'The submitter of an import run cannot also approve or reject it.' });
        return;
      }
      next(error);
    }
  });

  app.post('/api/approvals/:type/:id/claim', async (request, response, next) => {
    if (!requirePool(response)) return;
    if (!rolePermissionsByRole[request.auth!.role].canApprove) {
      response.status(403).json({ message: 'Only approvers can claim an approval.' });
      return;
    }
    const type = request.params.type as ApprovableType;
    try {
      const { organizationId, username } = request.auth!;

      if (type === 'reconciliationRun') {
        const result = await new PostgresImportValidationStore(pool!).claimRunApproval(
          organizationId,
          request.params.id,
          username,
        );
        if (result.outcome === 'not_claimable') {
          response
            .status(409)
            .json({ message: 'This item was already claimed or decided by someone else.' });
          return;
        }
        // The frontend discards this body and just refetches the list on success (see
        // claimApprovalRequest in apps/web/src/lib/api.ts) -- the outcome marker is enough.
        response.json(result);
        return;
      }

      const claimed =
        type === 'import'
          ? await claimImportApproval(pool!, organizationId, request.params.id, username)
          : await claimApprovalRequest(pool!, organizationId, request.params.id, username);
      response.json(claimed);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith('claimImportApproval: no unclaimed') ||
          error.message.startsWith('claimApprovalRequest: no unclaimed'))
      ) {
        response
          .status(409)
          .json({ message: 'This item was already claimed or decided by someone else.' });
        return;
      }
      next(error);
    }
  });

  app.post('/api/mapping/profiles', requireFullyVerified, async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const bodyResult = saveMappingProfileBodySchema.safeParse(request.body ?? {});
      if (!bodyResult.success) {
        respondWithValidationError(response, bodyResult.error);
        return;
      }

      const { name, gl, bank } = bodyResult.data;
      // ADR-0001: organizationId comes from the authenticated principal, not a shared default
      // organization -- that would let every tenant's mapping profiles land in (and become
      // visible in) the same organization once RLS is enforcing isolation everywhere else.
      const organizationId = request.auth!.organizationId;
      // createdBy is likewise server-derived, not client-supplied -- an audit field naming who
      // authored a mapping change must not be forgeable by the caller (ISSUE-008).
      const createdBy = request.auth!.username;

      const saveSide = async (pairs: typeof gl, sourceType: 'gl' | 'bank') => {
        let profile = await findMappingProfile(pool!, organizationId, name, sourceType);
        if (!profile) {
          profile = await createMappingProfile(pool!, {
            id: randomUUID(),
            organizationId,
            name,
            sourceType,
          });
        }

        const existingVersions = await listMappingProfileVersions(
          pool!,
          organizationId,
          profile.id,
        );
        const nextVersionNumber = (existingVersions[0]?.versionNumber ?? 0) + 1;
        const columnMapping = Object.fromEntries(pairs.map((pair) => [pair.col, pair.db]));
        const transformationRules = pairs
          .filter((pair) => pair.transform && pair.transform !== 'none')
          .map((pair) => ({ col: pair.col, db: pair.db, transform: pair.transform }));

        const version = await createMappingProfileVersion(pool!, organizationId, {
          id: randomUUID(),
          profileId: profile.id,
          versionNumber: nextVersionNumber,
          columnMapping,
          transformationRules,
          createdBy,
        });

        return { profile, version };
      };

      const [glResult, bankResult] = await Promise.all([
        saveSide(gl, 'gl'),
        saveSide(bank, 'bank'),
      ]);

      response.status(201).json({
        glProfile: glResult.profile,
        glVersion: glResult.version,
        bankProfile: bankResult.profile,
        bankVersion: bankResult.version,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reconciliation/:id/export/workbook', async (request, response, next) => {
    try {
      // ISSUE-001: this used to call repository.findById() directly, with no tenant check at
      // all. When a read model is configured it is authoritative for ownership, and that check
      // must be a hard gate here -- NOT loadRunReport's usual read-model-then-repository
      // fallback, which would fall through to the untenanted repository (and hand back another
      // tenant's workbook) the moment the read model reports "not found" for this tenant. That
      // fallback is real and intentional for the read-only report routes (ISSUE-002 tracks
      // tightening it generally); this route deals bytes out the door, so it doesn't get to
      // inherit the same leniency.
      if (readModelStore) {
        const owned = await readModelHasRun(request.auth!.organizationId, request.params.id);
        if (!owned) {
          response.status(404).json({ message: 'Workbook export is not available for this run.' });
          return;
        }
      }

      const run = repository.findById(request.params.id);
      if (!run?.outputWorkbook) {
        response.status(404).json({ message: 'Workbook export is not available for this run.' });
        return;
      }

      response.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${run.outputWorkbook.fileName}"`,
      );
      response.send(Buffer.from(run.outputWorkbook.binary));
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      error: unknown,
      request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const message = error instanceof Error ? error.message : 'Unexpected server error.';
      const stack = error instanceof Error ? error.stack : undefined;
      const statusCode = resolveUploadErrorStatus(error);

      request.log.error({ action: 'api.unhandled.error', statusCode, err: { message, stack } });
      captureApiException(error, {
        tags: {
          scope: 'http-request',
          statusCode: String(statusCode),
        },
        extra: {
          method: request.method,
          path: request.originalUrl,
          correlationId: resolveCorrelationId(request.id),
        },
      });
      response.status(statusCode).json({ message });
    },
  );

  app.locals.closeResources = async () => {
    if (apiRateLimiter.redisClient?.isOpen) {
      await apiRateLimiter.redisClient.quit().catch(() => undefined);
    }

    await reconciliationQueue.close().catch(() => undefined);
    await importValidationQueue.close().catch(() => undefined);
    await reconciliationQueueEvents.close().catch(() => undefined);
    await importValidationQueueEvents.close().catch(() => undefined);
    await flushApiSentry().catch(() => undefined);
  };

  return app;
};
