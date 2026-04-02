import { InMemoryRunRepository } from './services/runRepository';
import type { ReconciliationRun } from '@recon/domain';
import cors from 'cors';
import { executeReconciliation } from './services/reconciliationService';
import express from 'express';
import multer from 'multer';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const reconciliationFrequencies = new Set(['Monthly', 'Annual'] as const);

const acceptedMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

type UploadFileMap = {
  bankFile?: Express.Multer.File[];
  qboFile?: Express.Multer.File[];
};

const resolveCorrelationId = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  return randomUUID();
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

const sanitizeRun = (run: ReconciliationRun) => ({
  ...run,
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

type DeveloperCheck = {
  name: string;
  command: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  summary: string;
  details: string;
  highlights?: string[];
};

type DeveloperStatusSnapshot = {
  generatedAt: string;
  overallStatus: 'healthy' | 'attention-needed';
  failedChecks: number;
  totalChecks: number;
  totalDurationMs: number;
  failingCheckNames: string[];
  checks: Array<Pick<DeveloperCheck, 'name' | 'ok' | 'durationMs' | 'summary'>>;
};

type DeveloperStatusPayload = {
  generatedAt: string;
  repositoryPath: string;
  overallStatus: 'healthy' | 'attention-needed';
  failedChecks: number;
  passedChecks: number;
  totalChecks: number;
  totalDurationMs: number;
  checks: DeveloperCheck[];
  history: DeveloperStatusSnapshot[];
};

const STATUS_CACHE_TTL_MS = Number(process.env.DEV_STATUS_CACHE_TTL_MS ?? '60000');
const STATUS_HISTORY_LIMIT = Number(process.env.DEV_STATUS_HISTORY_LIMIT ?? '20');
let developerStatusCache: { payload: DeveloperStatusPayload; cachedAt: number } | null = null;
let developerStatusInFlight: Promise<DeveloperStatusPayload> | null = null;
const developerStatusHistory: DeveloperStatusSnapshot[] = [];

const formatCommand = (command: string, args: string[]): string =>
  [command, ...args].join(' ');

const truncateOutput = (value: string, limit = 6000): string => {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n...output truncated...`;
};

const stripAnsi = (value: string): string =>
  value
    .split('\u001b')
    .map((segment, index) => (index === 0 ? segment : segment.replace(/^\[[0-9;]*m/, '')))
    .join('');

const summarizeTestOutput = (stdout: string): string => {
  const clean = stripAnsi(stdout);
  const failedMatch = clean.match(/(\d+)\s+failed/i);
  const failedCount = Number(failedMatch?.[1] ?? '0');
  if (failedCount > 0) {
    return `${failedCount} test${failedCount === 1 ? '' : 's'} failed`;
  }

  const testFilesMatch = clean.match(/Test Files\s+(\d+)\s+passed/i);
  const testsMatch = clean.match(/Tests\s+(\d+)\s+passed/i);
  const playwrightPassedMatch = clean.match(/(\d+)\s+passed/i);
  if (testFilesMatch && testsMatch) {
    const testCount = Number(testsMatch[1] ?? '0');
    const fileCount = Number(testFilesMatch[1] ?? '0');
    return `${testCount} test${testCount === 1 ? '' : 's'} passed across ${fileCount} file${fileCount === 1 ? '' : 's'}`;
  }

  if (playwrightPassedMatch) {
    const passedCount = Number(playwrightPassedMatch[1] ?? '0');
    return `${passedCount} test${passedCount === 1 ? '' : 's'} passed`;
  }

  return 'Completed successfully';
};

const summarizeLintOutput = (stdout: string): string => {
  const problemsMatch = stdout.match(/(\d+) problems?/i);
  if (problemsMatch) {
    const problemCount = Number(problemsMatch[1]);
    return problemCount === 0 ? 'No lint problems' : `${problemCount} lint problems`;
  }

  return 'No lint problems';
};

const summarizeTypecheckOutput = (): string => 'No type errors';

type CoverageMetrics = {
  statements: string;
  branches: string;
  functions: string;
  lines: string;
};

const parseCoverageMetrics = (output: string): CoverageMetrics | null => {
  const clean = stripAnsi(output);
  const allFilesMatch = clean.match(
    /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/i,
  );
  if (!allFilesMatch) {
    return null;
  }

  const [, statements, branches, functions, lines] = allFilesMatch;
  return {
    statements: statements ?? '0',
    branches: branches ?? '0',
    functions: functions ?? '0',
    lines: lines ?? '0',
  };
};

const summarizeCoverageOutput = (stdout: string): string => {
  const metrics = parseCoverageMetrics(stdout);
  if (!metrics) {
    return 'Coverage run completed';
  }

  return `Coverage S/B/F/L: S ${metrics.statements}% | B ${metrics.branches}% | F ${metrics.functions}% | L ${metrics.lines}%`;
};

const parseCoverageHighlights = (output: string): string[] => {
  const metrics = parseCoverageMetrics(output);
  if (!metrics) {
    return [];
  }

  return [
    `S: ${metrics.statements}%`,
    `B: ${metrics.branches}%`,
    `F: ${metrics.functions}%`,
    `L: ${metrics.lines}%`,
  ];
};

const parseAuditSummary = (output: string): string => {
  try {
    const payload = JSON.parse(output) as {
      metadata?: {
        vulnerabilities?: {
          info?: number;
          low?: number;
          moderate?: number;
          high?: number;
          critical?: number;
          total?: number;
        };
      };
    };

    const vulnerabilities = payload.metadata?.vulnerabilities;
    if (!vulnerabilities) {
      return 'Security audit completed';
    }

    return `Vulnerabilities: total ${vulnerabilities.total ?? 0} (critical ${vulnerabilities.critical ?? 0}, high ${vulnerabilities.high ?? 0}, moderate ${vulnerabilities.moderate ?? 0}, low ${vulnerabilities.low ?? 0}, info ${vulnerabilities.info ?? 0})`;
  } catch {
    return 'Security audit completed';
  }
};

const parseSecurityHighlights = (output: string): string[] => {
  try {
    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return [];
    const payload = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
      metadata?: {
        vulnerabilities?: {
          info?: number;
          low?: number;
          moderate?: number;
          high?: number;
          critical?: number;
        };
      };
    };
    const v = payload.metadata?.vulnerabilities;
    if (!v) return [];
    return [
      `Critical: ${v.critical ?? 0}`,
      `High: ${v.high ?? 0}`,
      `Moderate: ${v.moderate ?? 0}`,
      `Low: ${v.low ?? 0}`,
      `Info: ${v.info ?? 0}`,
    ];
  } catch {
    return [];
  }
};

const parseTestHighlights = (output: string): string[] => {
  const clean = stripAnsi(output);
  const highlights: string[] = [];
  const hasFailure = /(^|\n)\s*(?:FAIL|✘)\b|\b\d+\s+failed\b|Test timeout|Error:/i.test(clean);

  if (!hasFailure) {
    return [];
  }

  const failingTestMatch = clean.match(/([^\s]+\.(?:spec|test)\.[^\s:]+:\d+:\d+)\s+›\s+([^\n]+)/);
  if (failingTestMatch) {
    highlights.push(`Failing test: ${failingTestMatch[1] ?? 'unknown'} - ${(failingTestMatch[2] ?? 'unknown').trim()}`);
  }

  const timeoutOrErrorMatch = clean.match(/(Test timeout[^\n]*|Error:\s*[^\n]*)/);
  if (timeoutOrErrorMatch) {
    highlights.push((timeoutOrErrorMatch[1] ?? 'Error').trim());
  }

  const tracePathMatch = clean.match(/(test-results\/[\w\-./]+\/trace\.zip)/);
  if (tracePathMatch) {
    highlights.push(`Trace: ${tracePathMatch[1] ?? 'not available'}`);
  }

  return highlights.slice(0, 3);
};

const runDeveloperCheck = async (
  name: string,
  args: string[],
  summarize: (stdout: string, stderr: string) => string,
  extractHighlights?: (output: string) => string[],
  timeout = 240000,
): Promise<DeveloperCheck> => {
  const started = Date.now();
  const command = formatCommand(npmExecutable, args);

  try {
    const result = await execFileAsync(npmExecutable, args, {
      cwd: repoRoot,
      timeout,
      maxBuffer: 1024 * 1024 * 6,
    });
    const durationMs = Date.now() - started;
    const stdout = result.stdout?.toString() ?? '';
    const stderr = result.stderr?.toString() ?? '';
    const output = `${stdout}\n${stderr}`.trim();
    const highlights = extractHighlights?.(output);

    return {
      name,
      command,
      ok: true,
      exitCode: 0,
      durationMs,
      summary: summarize(stdout, stderr),
      details: truncateOutput(output),
      highlights,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const failure = error as {
      code?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const stdout = typeof failure.stdout === 'string'
      ? failure.stdout
      : failure.stdout?.toString() ?? '';
    const stderr = typeof failure.stderr === 'string'
      ? failure.stderr
      : failure.stderr?.toString() ?? '';
    const output = `${stdout}\n${stderr}`.trim();
    const highlights = extractHighlights?.(output);

    return {
      name,
      command,
      ok: false,
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      durationMs,
      summary: summarize(stdout, stderr),
      details: truncateOutput(output.length > 0 ? output : failure.message ?? 'Command failed'),
      highlights,
    };
  }
};

const buildStatusSnapshot = (payload: DeveloperStatusPayload): DeveloperStatusSnapshot => ({
  generatedAt: payload.generatedAt,
  overallStatus: payload.overallStatus,
  failedChecks: payload.failedChecks,
  totalChecks: payload.totalChecks,
  totalDurationMs: payload.totalDurationMs,
  failingCheckNames: payload.checks.filter((check) => !check.ok).map((check) => check.name),
  checks: payload.checks.map((check) => ({
    name: check.name,
    ok: check.ok,
    durationMs: check.durationMs,
    summary: check.summary,
  })),
});

const collectDeveloperStatus = async (): Promise<DeveloperStatusPayload> => {
  const [unitTests, integrationTests, e2eTests, lint, typecheck, coverage, security] = await Promise.all([
    runDeveloperCheck('Unit tests', ['run', 'test:unit'], (stdout) => summarizeTestOutput(stdout), parseTestHighlights),
    runDeveloperCheck('Integration tests', ['run', 'test:integration'], (stdout) => summarizeTestOutput(stdout), parseTestHighlights),
    runDeveloperCheck('E2E tests', ['run', 'test:e2e'], (stdout) => summarizeTestOutput(stdout), parseTestHighlights, 420000),
    runDeveloperCheck('Static analysis (lint)', ['run', 'lint'], (stdout) => summarizeLintOutput(stdout)),
    runDeveloperCheck('Static analysis (typecheck)', ['run', 'typecheck'], () => summarizeTypecheckOutput()),
    runDeveloperCheck('Coverage', ['run', 'coverage'], (stdout) => summarizeCoverageOutput(stdout), parseCoverageHighlights, 420000),
    runDeveloperCheck('Security vulnerabilities', ['audit', '--json'], (stdout, stderr) => parseAuditSummary(stdout || stderr), parseSecurityHighlights, 300000),
  ]);

  const checks = [unitTests, integrationTests, e2eTests, lint, typecheck, coverage, security];
  const failedChecks = checks.filter((item) => !item.ok).length;
  const passedChecks = checks.length - failedChecks;
  const totalDurationMs = checks.reduce((sum, item) => sum + item.durationMs, 0);
  const overallStatus: 'healthy' | 'attention-needed' = failedChecks === 0 ? 'healthy' : 'attention-needed';

  const payload: DeveloperStatusPayload = {
    generatedAt: new Date().toISOString(),
    repositoryPath: repoRoot,
    overallStatus,
    failedChecks,
    passedChecks,
    totalChecks: checks.length,
    totalDurationMs,
    checks,
    history: [],
  };

  developerStatusHistory.unshift(buildStatusSnapshot(payload));
  if (developerStatusHistory.length > STATUS_HISTORY_LIMIT) {
    developerStatusHistory.length = STATUS_HISTORY_LIMIT;
  }

  payload.history = [...developerStatusHistory];

  return payload;
};

const getDeveloperStatus = async (
  forceRefresh = false,
): Promise<{ payload: DeveloperStatusPayload; fromCache: boolean }> => {
  const now = Date.now();

  if (!forceRefresh && developerStatusCache && now - developerStatusCache.cachedAt < STATUS_CACHE_TTL_MS) {
    return {
      payload: {
        ...developerStatusCache.payload,
        history: [...developerStatusHistory],
      },
      fromCache: true,
    };
  }

  if (developerStatusInFlight) {
    return developerStatusInFlight.then((payload) => ({ payload, fromCache: false }));
  }

  developerStatusInFlight = collectDeveloperStatus();

  try {
    const payload = await developerStatusInFlight;
    developerStatusCache = { payload, cachedAt: Date.now() };
    return { payload, fromCache: false };
  } finally {
    developerStatusInFlight = null;
  }
};

export const createApp = (repository = new InMemoryRunRepository()) => {
  const app = express();
  const upload = createUploadMiddleware(Number(process.env.MAX_UPLOAD_MB ?? '10'));

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      genReqId: (request) => request.headers['x-correlation-id']?.toString() ?? randomUUID(),
      quietReqLogger: false,
      // Log full error detail including stack trace for 4xx/5xx responses
      customErrorMessage: (_request, response) =>
        `request failed with status ${response.statusCode}`,
      customReceivedMessage: (request) =>
        `request received: ${request.method} ${request.url}`,
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

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/developer/status', async (request, response, next) => {
    try {
      const forceRefresh = request.query.force === '1' || request.query.force === 'true';
      request.log.info({ action: 'developer.status.requested', forceRefresh });
      const { payload, fromCache } = await getDeveloperStatus(forceRefresh);
      const cacheAgeMs = developerStatusCache ? Date.now() - developerStatusCache.cachedAt : 0;
      response.json({
        ...payload,
        cache: {
          ttlMs: STATUS_CACHE_TTL_MS,
          ageMs: cacheAgeMs,
          fromCache,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/reconciliation/run',
    upload.fields([
      { name: 'bankFile', maxCount: 1 },
      { name: 'qboFile', maxCount: 1 },
    ]),
    async (request, response, next) => {
      try {
        const files = (request.files ?? {}) as UploadFileMap;
        const bankFile = files?.bankFile?.[0];
        const qboFile = files?.qboFile?.[0];

        if (!bankFile || !qboFile) {
          response.status(400).json({
            message: 'Both bankFile and qboFile must be provided as .xlsx uploads.',
          });
          return;
        }

        const body = (request.body ?? {}) as Record<string, unknown>;
        const accountIdentifier = typeof body.accountIdentifier === 'string'
          ? body.accountIdentifier
          : undefined;
        const periodLabel = typeof body.periodLabel === 'string' ? body.periodLabel : undefined;
        const reconciliationFrequency =
          typeof body.reconciliationFrequency === 'string' &&
          reconciliationFrequencies.has(body.reconciliationFrequency as 'Monthly' | 'Annual')
            ? (body.reconciliationFrequency as 'Monthly' | 'Annual')
            : undefined;
        const correlationId = resolveCorrelationId(request.id);

        request.log.info({ action: 'reconciliation.run.received', accountIdentifier, periodLabel });

        const run = await executeReconciliation({
          correlationId,
          bankFile,
          qboFile,
          accountIdentifier,
          reconciliationFrequency,
          periodLabel,
        });

        repository.save(run);
        request.log.info({
          action: 'reconciliation.run.completed',
          runId: run.id,
          exceptions: run.exceptions.length,
        });

        response.status(201).json(sanitizeRun(run));
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/api/reconciliation/:id', (request, response) => {
    const run = repository.findById(request.params.id);
    if (!run) {
      response.status(404).json({ message: 'Reconciliation run not found.' });
      return;
    }

    response.json(sanitizeRun(run));
  });

  app.get('/api/reconciliation/:id/summary', (request, response) => {
    const run = repository.findById(request.params.id);
    if (!run) {
      response.status(404).json({ message: 'Reconciliation run not found.' });
      return;
    }

    response.json(run.summary);
  });

  app.get('/api/reconciliation/:id/exceptions', (request, response) => {
    const run = repository.findById(request.params.id);
    if (!run) {
      response.status(404).json({ message: 'Reconciliation run not found.' });
      return;
    }

    response.json(run.exceptions);
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

  app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    const stack = error instanceof Error ? error.stack : undefined;
    const statusCode = resolveUploadErrorStatus(error);

    request.log.error({ action: 'api.unhandled.error', statusCode, err: { message, stack } });
    response.status(statusCode).json({ message });
  });

  return app;
};
