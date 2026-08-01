import type {
  ErrorCategory,
  ReconciliationRun,
  ReconciliationRunReport,
  ReviewerDecision,
  ReviewerDecisionOutcome,
  ReviewerDecisionTargetType,
  SeverityLevel,
} from '@recon/domain';
import {
  computeSha256Hex,
  createPayeeAlias,
  deactivatePayeeAlias,
  loadPayeeAliases,
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
import { createDeveloperStatusService } from './services/developerStatusService';
import { createDeveloperRuntimeService } from './services/developerRuntimeService';
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
  exceptionsQuerySchema,
  isErrorCategory,
  loginBodySchema,
  reconciliationRunBodySchema,
  respondWithValidationError,
  reviewerDecisionBodySchema,
  reviewerDecisionDeleteParamsSchema,
  reviewerDecisionDeleteQuerySchema,
  updateAliasBodySchema,
} from './validation';

import { InMemoryRunRepository } from './services/runRepository';
import cors from 'cors';
import { executeReconciliation } from './services/reconciliationService';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { existsSync, readFileSync } from 'node:fs';
import helmet from 'helmet';
import multer from 'multer';
import { dirname, join, resolve } from 'node:path';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { createApiMetrics } from './services/apiMetrics';

const readPackageJson = (
  directory: string,
): { scripts?: Record<string, unknown>; workspaces?: unknown } | null => {
  const packageJsonPath = join(directory, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, unknown>;
      workspaces?: unknown;
    };
  } catch {
    return null;
  }
};

const isRepoRootCandidate = (directory: string): boolean => {
  const packageJson = readPackageJson(directory);
  if (!packageJson) {
    return false;
  }

  const scripts = packageJson.scripts;
  const requiredDashboardScriptNames = [
    'test:unit',
    'test:integration',
    'test:e2e',
    'lint',
    'coverage',
  ] as const;
  const hasDashboardScripts = requiredDashboardScriptNames.every(
    (scriptName) => typeof scripts?.[scriptName] === 'string',
  );

  return hasDashboardScripts || Array.isArray(packageJson.workspaces);
};

const findRepoRoot = (startDirectory: string): string | null => {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    if (isRepoRootCandidate(currentDirectory)) {
      return currentDirectory;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
};

const moduleDirectory = typeof __dirname === 'string' ? __dirname : process.cwd();
const repoRoot = findRepoRoot(moduleDirectory) ?? findRepoRoot(process.cwd()) ?? process.cwd();
const gitExecutable = 'git';
const defaultDatabaseUrl =
  process.env.DATABASE_URL ??
  process.env.API_DATABASE_URL ??
  'postgresql://recon_app:change-local-password@localhost:5432/reconciliation_platform';
const developerStatusService = createDeveloperStatusService({
  repoRoot,
  defaultDatabaseUrl,
});
const developerRuntimeService = createDeveloperRuntimeService({
  repoRoot,
  gitExecutable,
});

const acceptedMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

type UploadFileMap = {
  bankFile?: Express.Multer.File[];
  qboFile?: Express.Multer.File[];
};

type ReconciliationRequestInput = {
  accountIdentifier?: string;
  periodLabel?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
  varianceOverrides?: Record<string, number>;
};

type ReconciliationUploadFiles = {
  bankFile: Express.Multer.File;
  qboFile: Express.Multer.File;
};

type QueuedReconciliationFiles = {
  bankFile: QueuedReconciliationFilePayload;
  qboFile: QueuedReconciliationFilePayload;
};

type LifecycleRegistrationContext = {
  runId: string;
  bankSourceFileId: string;
  qboSourceFileId: string;
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

const localLoginUsers: Record<string, { password: string; firstName: string; lastName: string }> = {
  rray: {
    password: 'rray',
    firstName: 'rray',
    lastName: '',
  },
  rray2: {
    password: 'rray2',
    firstName: 'rray2',
    lastName: '',
  },
  rray3: {
    password: 'rray3',
    firstName: 'rray3',
    lastName: '',
  },
  bray: {
    password: 'bray',
    firstName: 'bray',
    lastName: '',
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
): { username: string; firstName: string; lastName: string } | null => {
  const localUser = localLoginUsers[username];

  if (localUser?.password !== password) {
    return null;
  }

  return {
    username,
    firstName: localUser.firstName,
    lastName: localUser.lastName,
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
  qboSha256: string;
}): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        accountIdentifier: input.accountIdentifier ?? null,
        reconciliationFrequency: input.reconciliationFrequency ?? null,
        periodLabel: input.periodLabel ?? null,
        bankSha256: input.bankSha256,
        qboSha256: input.qboSha256,
      }),
    )
    .digest('hex');

const getUploadedReconciliationFiles = (files: UploadFileMap): ReconciliationUploadFiles | null => {
  const bankFile = files.bankFile?.[0];
  const qboFile = files.qboFile?.[0];

  if (!bankFile || !qboFile) {
    return null;
  }

  return { bankFile, qboFile };
};

const toQueuedReconciliationFiles = (
  files: ReconciliationUploadFiles,
): QueuedReconciliationFiles => ({
  bankFile: {
    originalname: files.bankFile.originalname,
    mimetype: files.bankFile.mimetype,
    buffer: files.bankFile.buffer.toString('base64'),
  },
  qboFile: {
    originalname: files.qboFile.originalname,
    mimetype: files.qboFile.mimetype,
    buffer: files.qboFile.buffer.toString('base64'),
  },
});

const fromQueuedReconciliationFiles = (
  files: QueuedReconciliationFiles,
): ReconciliationUploadFiles => {
  const bankBuffer = Buffer.from(files.bankFile.buffer, 'base64');
  const qboBuffer = Buffer.from(files.qboFile.buffer, 'base64');

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
    qboFile: {
      fieldname: 'qboFile',
      originalname: files.qboFile.originalname,
      encoding: '7bit',
      mimetype: files.qboFile.mimetype,
      size: qboBuffer.byteLength,
      buffer: qboBuffer,
      destination: '',
      filename: files.qboFile.originalname,
      path: '',
      stream: Readable.from(qboBuffer),
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
  input: ReconciliationRequestInput,
  files: ReconciliationUploadFiles,
): Promise<LifecycleRegistrationContext> => {
  const runId = randomUUID();
  const bankSourceFileId = randomUUID();
  const qboSourceFileId = randomUUID();

  if (!lifecycleStore) {
    return { runId, bankSourceFileId, qboSourceFileId };
  }

  const startedAt = new Date().toISOString();
  const bankSha256 = computeSha256Hex(files.bankFile.buffer);
  const qboSha256 = computeSha256Hex(files.qboFile.buffer);

  await lifecycleStore.createJob({
    jobId: runId,
    correlationId,
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
      qboSha256,
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
      },
      {
        id: qboSourceFileId,
        sourceSystem: 'qbo',
        sourceFormat: resolveSourceFormat(files.qboFile.originalname),
        fileName: files.qboFile.originalname,
        mimeType: files.qboFile.mimetype,
        sizeBytes: files.qboFile.size,
        sha256: qboSha256,
        uploadedAt: startedAt,
      },
    ],
  });

  return { runId, bankSourceFileId, qboSourceFileId };
};

const runReconciliationWorkflow = async (input: {
  body: Record<string, unknown>;
  files: ReconciliationUploadFiles;
  requestId: unknown;
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
    {
      accountIdentifier,
      periodLabel,
      reconciliationFrequency,
    },
    input.files,
  );

  input.requestLog.info({ action: 'reconciliation.run.received', accountIdentifier, periodLabel });

  const aliases = input.pool ? await loadPayeeAliases(input.pool, accountIdentifier) : [];

  const run = await executeReconciliation({
    correlationId,
    runId: lifecycleContext.runId,
    lifecycleStore: input.lifecycleStore,
    sourceFileIds: {
      bank: lifecycleContext.bankSourceFileId,
      qbo: lifecycleContext.qboSourceFileId,
    },
    bankFile: input.files.bankFile,
    qboFile: input.files.qboFile,
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
  lifecycleStore?: PostgresReconciliationLifecycleStore;
  persistenceJobId?: string;
  error: unknown;
}): Promise<void> => {
  if (input.lifecycleStore && input.persistenceJobId) {
    await input.lifecycleStore
      .markFailed({
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
  redisClient: {
    isOpen: boolean;
    quit: () => Promise<unknown>;
  } | null;
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
          200: { description: 'Authenticated user profile' },
          401: { description: 'Authentication failed' },
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
                required: ['bankFile', 'qboFile'],
                properties: {
                  bankFile: { type: 'string', format: 'binary' },
                  qboFile: { type: 'string', format: 'binary' },
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
});

const isDeveloperDiagnosticsEnabled = (): boolean => {
  const override = parseBooleanFlag(process.env.ENABLE_DEVELOPER_DIAGNOSTICS);
  if (override !== null) {
    return override;
  }

  return process.env.NODE_ENV !== 'production';
};

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
  const developerDiagnosticsEnabled = isDeveloperDiagnosticsEnabled();
  const httpLogger = pino({ level: resolveLogLevelAtLeastInfo(process.env.LOG_LEVEL) });
  const apiMetricsFlag = parseBooleanFlag(process.env.ENABLE_API_METRICS);
  const apiMetrics = apiMetricsFlag === true || apiMetricsFlag === null ? createApiMetrics() : null;
  const apiRateLimiter = createApiRateLimiter(httpLogger);
  const openApiSpec = buildOpenApiSpec();
  const queueConfiguration = resolveReconciliationQueueConfiguration();

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

  app.use((request, response, next) => {
    const started = Date.now();

    developerRuntimeService.noteRequestSeenForPath(request.originalUrl);

    response.on('finish', () => {
      if (response.statusCode < 400) {
        return;
      }

      developerRuntimeService.recordFailedRequest({
        timestamp: new Date().toISOString(),
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - started,
        correlationId: resolveCorrelationId(request.id),
      });
    });

    next();
  });

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

  const readModelHasRun = async (runId: string): Promise<boolean> => {
    if (!readModelStore) {
      return true;
    }

    const run = await readModelStore.findRunReportById(runId);
    return Boolean(run);
  };

  const loadLatestRunReport = async (): Promise<ReconciliationRunReport | undefined> => {
    return loadFromReadModelOrRepository(
      readModelStore ? () => readModelStore.findLatestRunReport() : undefined,
      () => toRunReport(repository.findLatest()),
    );
  };

  const loadRunReport = async (runId: string): Promise<ReconciliationRunReport | undefined> => {
    return loadFromReadModelOrRepository(
      readModelStore ? () => readModelStore.findRunReportById(runId) : undefined,
      () => toRunReport(repository.findById(runId)),
    );
  };

  const loadRunSummary = async (runId: string) => {
    return loadFromReadModelOrRepository(
      readModelStore ? () => readModelStore.findRunSummaryById(runId) : undefined,
      () => repository.findById(runId)?.summary,
    );
  };

  const loadRunExceptions = async (runId: string) => {
    return loadFromReadModelOrRepository(
      readModelStore ? () => readModelStore.listRunExceptions(runId) : undefined,
      () => repository.findById(runId)?.exceptions,
    );
  };

  const loadRunExceptionPage = async (
    runId: string,
    limit: number,
    offset: number,
    filters: ExceptionPageFilters = {},
  ): Promise<PaginatedExceptionsResult | undefined> => {
    if (readModelStore) {
      const runExists = await readModelHasRun(runId);
      if (!runExists) {
        return undefined;
      }

      return readModelStore.listRunExceptionsPage(runId, limit, offset, filters);
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

  const loadReviewerDecisions = async (runId: string) => {
    if (readModelStore) {
      const runExists = await readModelHasRun(runId);
      if (!runExists) {
        return undefined;
      }

      return readModelStore.listReviewerDecisions(runId);
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
        const localUser = authenticateWithLocalUsers(username, password);

        if (!localUser) {
          response.status(401).json({ message: invalidLoginMessage });
          return;
        }

        response.json(localUser);
        return;
      }

      const authenticatedUser = await pool.query<{
        user_name: string;
        first_name: string;
        last_name: string;
      }>(
        `
          SELECT user_name, first_name, last_name
          FROM reconciliation_user
          WHERE user_name = $1 AND password = $2
          LIMIT 1
        `,
        [username, password],
      );

      const user = authenticatedUser.rows[0];

      if (!user) {
        response.status(401).json({ message: invalidLoginMessage });
        return;
      }

      response.json({
        username: user.user_name,
        firstName: user.first_name,
        lastName: user.last_name,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/developer', (_request, response, next) => {
    if (developerDiagnosticsEnabled) {
      next();
      return;
    }

    response.status(403).json({
      message: 'Developer diagnostics are disabled in this environment.',
    });
  });

  app.get('/api/developer/status', async (request, response, next) => {
    try {
      const forceRefresh = request.query.force === '1' || request.query.force === 'true';
      request.log.info({ action: 'developer.status.requested', forceRefresh });
      const { payload, cache } = await developerStatusService.getStatus(forceRefresh);
      response.json({
        ...payload,
        cache,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/developer/runtime', async (_request, response, next) => {
    try {
      response.json(await developerRuntimeService.getRuntimeOverview());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/developer/runtime/requests', (request, response) => {
    const limit = parseLimit(request.query.limit, 10, 100);
    response.json({ items: developerRuntimeService.listFailedRequests(limit) });
  });

  app.get('/api/developer/runtime/exceptions', (request, response) => {
    const limit = parseLimit(request.query.limit, 10, 100);
    response.json({ items: developerRuntimeService.listExceptions(limit) });
  });

  app.get('/api/developer/runtime/runs', (request, response) => {
    const limit = parseLimit(request.query.limit, 10, 50);
    response.json({ items: developerRuntimeService.listReconciliationRuns(limit) });
  });

  app.post(
    '/api/reconciliation/run',
    upload.fields([
      { name: 'bankFile', maxCount: 1 },
      { name: 'qboFile', maxCount: 1 },
    ]),
    async (request, response, next) => {
      const started = Date.now();
      let persistenceJobId: string | undefined;
      try {
        const files = getUploadedReconciliationFiles((request.files ?? {}) as UploadFileMap);

        if (!files) {
          response.status(400).json({
            message: 'Both bankFile and qboFile must be provided as .xlsx uploads.',
          });
          return;
        }

        const body = (request.body ?? {}) as Record<string, unknown>;
        if (reconciliationQueue.enabled) {
          const queuedResponse: ReconciliationJobEnqueueResponse =
            await reconciliationQueue.enqueue({
              requestId: resolveCorrelationId(request.id),
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
        const run = await loadRunReport(queuedResult.runId);
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

  app.get('/api/reconciliation/latest', async (_request, response, next) => {
    try {
      const run = await loadLatestRunReport();
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
      const run = await loadRunReport(request.params.id);
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
      const summary = await loadRunSummary(request.params.id);
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
        const page = await loadRunExceptionPage(request.params.id, limit, offset, {
          category,
          severity,
        });

        if (!page) {
          response.status(404).json({ message: 'Reconciliation run not found.' });
          return;
        }

        response.json(page);
        return;
      }

      const exceptions = await loadRunExceptions(request.params.id);
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
      const decisions = await loadReviewerDecisions(request.params.id);
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
      const run = await loadRunReport(request.params.id);
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
        await lifecycleStore.persistReviewerDecision(savedDecision);
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
        const run = await loadRunReport(request.params.id);
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
          await lifecycleStore.deleteReviewerDecision(run.id, targetType, targetId);
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
      const aliases = await loadPayeeAliases(pool!, accountIdentifier);
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

      const input: CreatePayeeAliasInput = bodyResult.data;
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

      const alias = await updatePayeeAlias(pool!, request.params.id, bodyResult.data);

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
      const deactivated = await deactivatePayeeAlias(pool!, request.params.id);
      if (!deactivated) {
        response.status(404).json({ message: 'Alias not found.' });
        return;
      }
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reconciliation/:id/export/workbook', (request, response) => {
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
      const errorName = error instanceof Error ? error.name : 'UnknownError';

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
      developerRuntimeService.recordException({
        timestamp: new Date().toISOString(),
        method: request.method,
        path: request.originalUrl,
        statusCode,
        correlationId: resolveCorrelationId(request.id),
        errorName,
        message,
        stack,
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
