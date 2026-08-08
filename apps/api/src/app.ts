import type {
  ErrorCategory,
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
  computeSha256Hex,
  createMappingProfile,
  createMappingProfileVersion,
  createMatchingConfigVersionDraft,
  createPayeeAlias,
  deactivatePayeeAlias,
  findMappingProfile,
  listMappingProfiles,
  listMappingProfileVersions,
  listMatchingConfigVersions,
  loadPayeeAliases,
  publishMatchingConfigVersion,
  updatePayeeAlias,
  type CreatePayeeAliasInput,
  type ExceptionPageFilters,
  type PaginatedExceptionsResult,
  type PostgresReconciliationLifecycleStore,
  type PostgresReconciliationReadModelStore,
} from '@recon/persistence';
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
import {
  createReconciliationQueue,
  type QueuedReconciliationFilePayload,
  type QueuedReconciliationJobPayload,
  type QueuedReconciliationResult,
} from './services/reconciliationQueue';
import { captureApiException, flushApiSentry, initializeApiSentry } from './services/sentry';
import {
  aliasesQuerySchema,
  createAliasBodySchema,
  entityVerificationCheckBodySchema,
  exceptionsQuerySchema,
  identityConfirmBodySchema,
  isErrorCategory,
  loginBodySchema,
  matchingConfigVersionDraftBodySchema,
  publishMatchingConfigVersionBodySchema,
  reconciliationRunBodySchema,
  respondWithValidationError,
  reviewerDecisionBodySchema,
  reviewerDecisionDeleteParamsSchema,
  reviewerDecisionDeleteQuerySchema,
  saveMappingProfileBodySchema,
  signupBodySchema,
  updateAliasBodySchema,
} from './validation';

import { InMemoryRunRepository } from './services/runRepository';
import cors from 'cors';
import { executeReconciliation } from './services/reconciliationService';
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

const fromQueuedReconciliationFiles = (
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

const runReconciliationWorkflow = async (input: {
  body: Record<string, unknown>;
  files: ReconciliationUploadFiles;
  requestId: unknown;
  organizationId: string;
  requestLog: pino.Logger;
  repository: InMemoryRunRepository;
  lifecycleStore?: PostgresReconciliationLifecycleStore;
  pool?: Pool;
}): Promise<ReconciliationWorkflowResult> => {
  const { accountIdentifier, periodLabel, reconciliationFrequency, varianceOverrides } =
    parseReconciliationRequestInput(input.body);
  const correlationId = resolveCorrelationId(input.requestId);
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

  input.requestLog.info({ action: 'reconciliation.run.received', accountIdentifier, periodLabel });

  const aliases = input.pool
    ? await loadPayeeAliases(input.pool, input.organizationId, accountIdentifier)
    : [];

  const run = await executeReconciliation({
    correlationId,
    runId: lifecycleContext.runId,
    organizationId: input.organizationId,
    lifecycleStore: input.lifecycleStore,
    sourceFileIds: {
      bank: lifecycleContext.bankSourceFileId,
      gl: lifecycleContext.glSourceFileId,
    },
    bankFile: input.files.bankFile,
    glFile: input.files.glFile,
    accountIdentifier,
    reconciliationFrequency,
    periodLabel,
    aliases,
  });

  input.repository.save(run);
  input.requestLog.info({
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
};

const recordSuccessfulReconciliationRun = (input: {
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

const handleFailedReconciliationRun = async (input: {
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

const createUploadMiddleware = (maxUploadMb: number) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024 },
    fileFilter: (_request, file, callback) => {
      const allowed =
        acceptedMimeTypes.has(file.mimetype) || file.originalname.toLowerCase().endsWith('.xlsx');
      if (!allowed) {
        callback(new Error('Only .xlsx files are accepted.'));
        return;
      }

      callback(null, true);
    },
  });

const sanitizeRun = (run: ReconciliationRun): ReconciliationRunReport => ({
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

  if (error instanceof Error && error.message === 'Only .xlsx files are accepted.') {
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

type ReconciliationQueueConfiguration = {
  enabled: boolean;
  redisUrl: string | null;
  queueName: string;
  prefix: string;
  concurrency: number;
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

const resolveReconciliationQueueConfiguration = (): ReconciliationQueueConfiguration => {
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
) => {
  const app = express();
  const upload = createUploadMiddleware(Number(process.env.MAX_UPLOAD_MB ?? '10'));
  const httpLogger = pino({ level: resolveLogLevelAtLeastInfo(process.env.LOG_LEVEL) });
  const apiMetricsFlag = parseBooleanFlag(process.env.ENABLE_API_METRICS);
  const apiMetrics = apiMetricsFlag === true || apiMetricsFlag === null ? createApiMetrics() : null;
  const apiRateLimiter = createApiRateLimiter(httpLogger);
  const openApiSpec = buildOpenApiSpec();
  const queueConfiguration = resolveReconciliationQueueConfiguration();

  // ADR-0002 step 7: username == password in localLoginUsers, so this fallback must be
  // impossible to reach in production even by misconfiguration -- checked at startup, not at
  // request time, so a bad deploy fails immediately instead of quietly shipping a backdoor.
  const localLoginFallbackEnabled = parseBooleanFlag(process.env.ALLOW_LOCAL_LOGIN_FALLBACK) === true;
  if (localLoginFallbackEnabled && isProductionRuntime()) {
    throw new Error(
      'ALLOW_LOCAL_LOGIN_FALLBACK is set in a production runtime; refusing to start. ' +
        'This fallback authenticates with username == password and must only exist in local dev.',
    );
  }

  initializeApiSentry(httpLogger);

  const reconciliationQueue = createReconciliationQueue({
    enabled: queueConfiguration.enabled,
    redisUrl: queueConfiguration.redisUrl,
    queueName: queueConfiguration.queueName,
    prefix: queueConfiguration.prefix,
    concurrency: queueConfiguration.concurrency,
    logger: httpLogger,
    processJob: async (
      payload: QueuedReconciliationJobPayload,
    ): Promise<QueuedReconciliationResult> => {
      const started = Date.now();
      let persistenceJobId: string | undefined;

      try {
        const workflowResult = await runReconciliationWorkflow({
          body: payload.body,
          files: fromQueuedReconciliationFiles(payload.files),
          requestId: payload.requestId,
          organizationId: payload.organizationId,
          requestLog: httpLogger,
          repository,
          lifecycleStore,
          pool,
        });
        persistenceJobId = workflowResult.persistenceJobId;

        recordSuccessfulReconciliationRun({
          requestId: payload.requestId,
          started,
          result: workflowResult,
        });

        return {
          status: 'completed',
          runId: workflowResult.run.id,
          run: sanitizeRun(workflowResult.run),
        };
      } catch (error) {
        await handleFailedReconciliationRun({
          requestId: payload.requestId,
          requestBody: payload.body,
          started,
          organizationId: payload.organizationId,
          lifecycleStore,
          persistenceJobId,
          error,
        });
        captureApiException(error, {
          tags: { scope: 'reconciliation-queue' },
          extra: { requestId: payload.requestId },
        });

        return {
          status: 'failed',
          failedAt: new Date().toISOString(),
          reason:
            error instanceof Error ? error.message : 'Unexpected reconciliation queue failure',
        };
      }
    },
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
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger: httpLogger,
      genReqId: (request) => request.headers['x-correlation-id']?.toString() ?? randomUUID(),
      quietReqLogger: false,
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

  // ADR-0002 step 5: the reconciliation/aliases/mapping/rules surface additionally requires
  // canAccessApplication.
  app.use(
    ['/api/reconciliation', '/api/aliases', '/api/mapping', '/api/rules'],
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

  app.post('/api/auth/login', async (request, response, next) => {
    try {
      const { username, password } = loginBodySchema.parse(request.body ?? {});

      if (username.length === 0 || password.length === 0) {
        response.status(401).json({ message: invalidLoginMessage });
        return;
      }

      if (!pool) {
        if (!localLoginFallbackEnabled) {
          response.status(401).json({ message: invalidLoginMessage });
          return;
        }

        const localUser = authenticateWithLocalUsers(username, password);

        if (!localUser) {
          response.status(401).json({ message: invalidLoginMessage });
          return;
        }

        const { token } = signAuthToken(
          {
            sub: localUser.username,
            role: localUser.role,
            organizationId: LOCAL_LOGIN_FALLBACK_ORGANIZATION_ID,
            firstName: localUser.firstName,
            lastName: localUser.lastName,
          },
          httpLogger,
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
      const passwordMatches = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);

      if (!user || !passwordMatches) {
        response.status(401).json({ message: invalidLoginMessage });
        return;
      }

      const { token } = signAuthToken(
        {
          sub: user.user_name,
          role: user.role,
          organizationId: user.organization_id,
          firstName: user.first_name,
          lastName: user.last_name,
        },
        httpLogger,
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
        [organizationId, body.companyName, body.entityState, body.entityFilingNumber, body.entityType],
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
      response.status(501).json({ message: 'Identity verification requires a database connection.' });
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
      response.status(501).json({ message: 'Identity verification requires a database connection.' });
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
        response.status(409).json({ message: 'Entity details are incomplete for this organization.' });
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
      const decisions = await loadReviewerDecisions(request.auth!.organizationId, request.params.id);
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

  app.get('/api/aliases', async (request, response, next) => {
    if (!requirePool(response)) return;
    try {
      const { accountIdentifier } = aliasesQuerySchema.parse(request.query);
      const aliases = await loadPayeeAliases(pool!, request.auth!.organizationId, accountIdentifier);
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
    await flushApiSentry().catch(() => undefined);
  };

  return app;
};
