import type {
  ErrorCategory,
  ReconciliationRun,
  ReconciliationRunReport,
  ReviewerDecision,
  ReviewerDecisionOutcome,
  ReviewerDecisionTargetType,
} from '@recon/domain';
import {
  computeSha256Hex,
  type PaginatedExceptionsResult,
  type PostgresReconciliationLifecycleStore,
  type PostgresReconciliationReadModelStore,
} from '@recon/persistence';
import { createHash, randomUUID } from 'node:crypto';
import { recordReconciliationRun } from './services/runtimeDiagnostics';
import { createDeveloperStatusService } from './services/developerStatusService';
import { createDeveloperRuntimeService } from './services/developerRuntimeService';

import { InMemoryRunRepository } from './services/runRepository';
import cors from 'cors';
import { errorCategories } from '@recon/domain';
import { executeReconciliation } from './services/reconciliationService';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import multer from 'multer';
import { dirname, join, resolve } from 'node:path';
import pino from 'pino';
import pinoHttp from 'pino-http';

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

const reconciliationFrequencies = new Set(['Monthly', 'Annual'] as const);

const acceptedMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

type UploadFileMap = {
  bankFile?: Express.Multer.File[];
  qboFile?: Express.Multer.File[];
};

type ReviewerDecisionRequestBody = {
  targetType?: unknown;
  targetId?: unknown;
  outcome?: unknown;
  finalCategory?: unknown;
  notes?: unknown;
  reviewerId?: unknown;
  reviewerName?: unknown;
};

type ReconciliationRequestInput = {
  accountIdentifier?: string;
  periodLabel?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
};

type ReconciliationUploadFiles = {
  bankFile: Express.Multer.File;
  qboFile: Express.Multer.File;
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

const reviewerDecisionTargetTypes = new Set<ReviewerDecisionTargetType>([
  'ProbableMatch',
  'AmbiguousReview',
  'ExceptionItem',
]);

const reviewerDecisionOutcomes = new Set<ReviewerDecisionOutcome>([
  'ApprovedMatch',
  'RejectedMatch',
  'ConfirmedException',
  'ReclassifiedException',
]);

const isErrorCategory = (value: unknown): value is ErrorCategory =>
  typeof value === 'string' && errorCategories.includes(value as ErrorCategory);

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

const isOutcomeAllowedForTarget = (
  targetType: ReviewerDecisionTargetType,
  outcome: ReviewerDecisionOutcome,
): boolean => {
  if (targetType === 'ExceptionItem') {
    return outcome === 'ConfirmedException' || outcome === 'ReclassifiedException';
  }

  return outcome === 'ApprovedMatch' || outcome === 'RejectedMatch';
};

const cleanOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

const parseReconciliationRequestInput = (
  body: Record<string, unknown>,
): ReconciliationRequestInput => ({
  accountIdentifier:
    typeof body.accountIdentifier === 'string' ? body.accountIdentifier : undefined,
  periodLabel: typeof body.periodLabel === 'string' ? body.periodLabel : undefined,
  reconciliationFrequency:
    typeof body.reconciliationFrequency === 'string' &&
    reconciliationFrequencies.has(body.reconciliationFrequency as 'Monthly' | 'Annual')
      ? (body.reconciliationFrequency as 'Monthly' | 'Annual')
      : undefined,
});

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
  requestLog: express.Request['log'];
  repository: InMemoryRunRepository;
  lifecycleStore?: PostgresReconciliationLifecycleStore;
}): Promise<ReconciliationWorkflowResult> => {
  const { accountIdentifier, periodLabel, reconciliationFrequency } =
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
  });

  input.repository.save(run);
  input.requestLog.info({
    action: 'reconciliation.run.completed',
    runId: run.id,
    exceptions: run.exceptions.length,
  });

  return {
    accountIdentifier,
    periodLabel,
    reconciliationFrequency,
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
) => {
  const app = express();
  const upload = createUploadMiddleware(Number(process.env.MAX_UPLOAD_MB ?? '10'));
  const developerDiagnosticsEnabled = isDeveloperDiagnosticsEnabled();
  const httpLogger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

  app.set('trust proxy', true);
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
  ): Promise<PaginatedExceptionsResult | undefined> => {
    if (readModelStore) {
      const runExists = await readModelHasRun(runId);
      if (!runExists) {
        return undefined;
      }

      return readModelStore.listRunExceptionsPage(runId, limit, offset);
    }

    const exceptions = repository.findById(runId)?.exceptions;
    if (!exceptions) {
      return undefined;
    }

    const items = exceptions.slice(offset, offset + limit);
    return {
      items,
      total: exceptions.length,
      limit,
      offset,
      hasMore: offset + items.length < exceptions.length,
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
        const workflowResult = await runReconciliationWorkflow({
          body,
          files,
          requestId: request.id,
          requestLog: request.log,
          repository,
          lifecycleStore,
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
      const limitRequested = request.query.limit !== undefined;
      const offsetRequested = request.query.offset !== undefined;

      if (limitRequested || offsetRequested) {
        const limit = parseLimit(request.query.limit, 50, 200);
        const offset = parseOffset(request.query.offset, 0);
        const page = await loadRunExceptionPage(request.params.id, limit, offset);

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

      const body = (request.body ?? {}) as ReviewerDecisionRequestBody;
      if (
        typeof body.targetType !== 'string' ||
        !reviewerDecisionTargetTypes.has(body.targetType as ReviewerDecisionTargetType)
      ) {
        response.status(400).json({ message: 'A valid reviewer decision targetType is required.' });
        return;
      }

      if (typeof body.targetId !== 'string' || body.targetId.trim().length === 0) {
        response.status(400).json({ message: 'A reviewer decision targetId is required.' });
        return;
      }

      if (
        typeof body.outcome !== 'string' ||
        !reviewerDecisionOutcomes.has(body.outcome as ReviewerDecisionOutcome)
      ) {
        response.status(400).json({ message: 'A valid reviewer decision outcome is required.' });
        return;
      }

      const targetType = body.targetType as ReviewerDecisionTargetType;
      const targetId = body.targetId.trim();
      const outcome = body.outcome as ReviewerDecisionOutcome;

      if (!findDecisionTarget(run, targetType, targetId)) {
        response
          .status(400)
          .json({ message: 'Reviewer decision target was not found on this reconciliation run.' });
        return;
      }

      if (!isOutcomeAllowedForTarget(targetType, outcome)) {
        response.status(400).json({
          message: 'Reviewer decision outcome is not valid for the specified target type.',
        });
        return;
      }

      if (outcome === 'ReclassifiedException' && !isErrorCategory(body.finalCategory)) {
        response
          .status(400)
          .json({ message: 'A valid finalCategory is required when reclassifying an exception.' });
        return;
      }

      const timestamp = new Date().toISOString();
      const decision: ReviewerDecision = {
        id: randomUUID(),
        runId: run.id,
        targetType,
        targetId,
        outcome,
        finalCategory: isErrorCategory(body.finalCategory) ? body.finalCategory : undefined,
        notes: cleanOptionalText(body.notes),
        reviewerId: cleanOptionalText(body.reviewerId),
        reviewerName: cleanOptionalText(body.reviewerName),
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

  return app;
};
