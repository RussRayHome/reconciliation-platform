import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  CreateDeveloperStatusServiceOptions,
  CoverageMetrics,
  DeveloperCheck,
  DeveloperHistoryTestTotals,
  DeveloperStatusPayload,
  DeveloperStatusResult,
  DeveloperStatusSnapshot,
  TestBreakdown,
} from './developerStatusTypes';
export type {
  CreateDeveloperStatusServiceOptions,
  CoverageBenchmark,
  CoverageBenchmarkKey,
  CoverageMetrics,
  DeveloperCheck,
  DeveloperStatusPayload,
  DeveloperStatusResult,
} from './developerStatusTypes';

import {
  buildCoverageBenchmarks,
  formatCommand,
  parseAuditSummary,
  parseCoverageMetrics,
  parseSecurityHighlights,
  parseSecurityMetadata,
  parseTestHighlights,
  parseTestMetadata,
  summarizeLintOutput,
  summarizeTestOutput,
  summarizeTypecheckOutput,
  truncateOutput,
} from './developerStatusParsing';

const execFileAsync = promisify(execFile);
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const runtimeMissingToolRegex = /(?:^|\n)\s*(?:sh|\/bin\/sh):\s*([a-z0-9._-]+):\s*not found\b/i;
const runtimeAuditNetworkErrorRegex = /EAI_AGAIN|ENOTFOUND|audit endpoint returned an error/i;
const runtimePlaywrightBrowserMissingRegex =
  /browserType\.launch:\s*Executable doesn't exist at|Looks like Playwright was just installed or updated/i;
const runtimeSkippableChecks = new Set([
  'Unit tests',
  'Integration tests',
  'E2E tests',
  'Postgres DB tests',
  'Static analysis (lint)',
  'Static analysis (typecheck)',
  'Coverage',
]);

const isProductionRuntime = (): boolean => process.env.NODE_ENV === 'production';
const isContainerRuntime = (): boolean => existsSync('/.dockerenv');
const isToolingConstrainedRuntime = (): boolean => isProductionRuntime() || isContainerRuntime();

const buildRuntimeSkipResult = (
  name: string,
  command: string,
  durationMs: number,
  output: string,
  metadata: Partial<DeveloperCheck>,
): DeveloperCheck | null => {
  if (!isToolingConstrainedRuntime()) {
    return null;
  }

  if (runtimeSkippableChecks.has(name)) {
    const missingToolMatch = runtimeMissingToolRegex.exec(output);
    if (missingToolMatch?.[1]) {
      const tool = missingToolMatch[1];

      return {
        name,
        command,
        ok: true,
        exitCode: 0,
        durationMs,
        summary: `Skipped in container runtime: ${tool} is not installed`,
        details: truncateOutput(
          output.length > 0 ? output : 'Tool is not available in this runtime image.',
        ),
        highlights: [
          `Skipped because ${tool} is unavailable in the current API container image.`,
          'Run this check from the host workspace (or a dev-tooling image) for definitive results.',
        ],
        ...metadata,
      };
    }
  }

  if (name === 'E2E tests' && runtimePlaywrightBrowserMissingRegex.test(output)) {
    return {
      name,
      command,
      ok: true,
      exitCode: 0,
      durationMs,
      summary: 'Skipped in container runtime: Playwright browser binaries are not installed',
      details: truncateOutput(
        output.length > 0
          ? output
          : 'Playwright browser binaries are not available in this runtime image.',
      ),
      highlights: [
        'Skipped because Playwright browser binaries are unavailable in the current API container image.',
        'Run `npx playwright install --with-deps` and execute E2E tests from the host workspace for definitive results.',
      ],
      ...metadata,
    };
  }

  if (name === 'Security vulnerabilities' && runtimeAuditNetworkErrorRegex.test(output)) {
    return {
      name,
      command,
      ok: true,
      exitCode: 0,
      durationMs,
      summary: 'Skipped in container runtime: npm audit registry endpoint is not reachable',
      details: truncateOutput(
        output.length > 0 ? output : 'npm audit endpoint is not reachable from this runtime image.',
      ),
      highlights: [
        'Skipped because npm audit could not reach the registry endpoint from the current API container runtime.',
        'Run `npm run security:scan:components` on the host workspace for definitive security results.',
      ],
      ...metadata,
    };
  }

  return null;
};

const buildHistoryTestTotals = (checks: DeveloperCheck[]): DeveloperHistoryTestTotals => {
  const labelByType: Record<TestBreakdown['type'], string> = {
    unit: 'Unit',
    integration: 'Integration',
    e2e: 'E2E',
    postgres: 'Postgres DB',
  };

  const byType = checks
    .filter((check): check is DeveloperCheck & { testType: TestBreakdown['type'] } =>
      Boolean(check.testType),
    )
    .map((check) => ({
      type: check.testType,
      label: labelByType[check.testType],
      passed: check.passedCount ?? 0,
      failed: check.failedCount ?? 0,
      total: check.totalCount ?? (check.passedCount ?? 0) + (check.failedCount ?? 0),
    }));

  return {
    passed: byType.reduce((sum, item) => sum + item.passed, 0),
    failed: byType.reduce((sum, item) => sum + item.failed, 0),
    total: byType.reduce((sum, item) => sum + item.total, 0),
    byType,
  };
};

const buildStatusSnapshot = (payload: DeveloperStatusPayload): DeveloperStatusSnapshot => {
  const failingChecks = payload.checks.filter((check) => !check.ok);

  return {
    generatedAt: payload.generatedAt,
    overallStatus: payload.overallStatus,
    failedChecks: payload.failedChecks,
    totalChecks: payload.totalChecks,
    totalDurationMs: payload.totalDurationMs,
    failingCheckNames: failingChecks.map((check) => check.name),
    failingAreas: [...new Set(failingChecks.map((check) => check.areaLabel ?? check.name))],
    testTotals: buildHistoryTestTotals(payload.checks),
    checks: payload.checks.map((check) => ({
      name: check.name,
      ok: check.ok,
      durationMs: check.durationMs,
      summary: check.summary,
    })),
  };
};

export const createDeveloperStatusService = ({
  repoRoot,
  defaultDatabaseUrl,
  statusCacheTtlMs = Number(process.env.DEV_STATUS_CACHE_TTL_MS ?? '60000'),
  statusHistoryLimit = Number(process.env.DEV_STATUS_HISTORY_LIMIT ?? '20'),
}: CreateDeveloperStatusServiceOptions) => {
  const coverageSummaryPath = join(repoRoot, 'coverage', 'coverage-summary.json');
  const coverageTempPath = join(repoRoot, 'coverage', '.tmp');

  let developerStatusCache: { payload: DeveloperStatusPayload; cachedAt: number } | null = null;
  let developerStatusInFlight: Promise<DeveloperStatusPayload> | null = null;
  const developerStatusHistory: DeveloperStatusSnapshot[] = [];

  const readCoverageSummaryMetrics = (): CoverageMetrics | null => {
    if (!existsSync(coverageSummaryPath)) {
      return null;
    }

    try {
      const payload = JSON.parse(readFileSync(coverageSummaryPath, 'utf8')) as {
        total?: {
          statements?: { pct?: number };
          branches?: { pct?: number };
          functions?: { pct?: number };
          lines?: { pct?: number };
        };
      };
      const total = payload.total;

      if (!total) {
        return null;
      }

      const metrics = {
        statements: total.statements?.pct,
        branches: total.branches?.pct,
        functions: total.functions?.pct,
        lines: total.lines?.pct,
      };

      if (
        Object.values(metrics).some((value) => typeof value !== 'number' || Number.isNaN(value))
      ) {
        return null;
      }

      return {
        statements: String(metrics.statements),
        branches: String(metrics.branches),
        functions: String(metrics.functions),
        lines: String(metrics.lines),
      };
    } catch {
      return null;
    }
  };

  const summarizeCoverageOutput = (stdout: string): string => {
    const metrics = parseCoverageMetrics(stdout) ?? readCoverageSummaryMetrics();
    if (!metrics) {
      return 'Coverage run completed';
    }

    return `Coverage S/B/F/L: S ${metrics.statements}% | B ${metrics.branches}% | F ${metrics.functions}% | L ${metrics.lines}%`;
  };

  const parseCoverageHighlights = (output: string): string[] => {
    const metrics = parseCoverageMetrics(output) ?? readCoverageSummaryMetrics();
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

  const runDeveloperCheck = async (
    name: string,
    args: string[],
    summarize: (stdout: string, stderr: string) => string,
    extractHighlights?: (output: string) => string[],
    timeout = 240000,
    parseMetadata?: (output: string) => Partial<DeveloperCheck>,
  ): Promise<DeveloperCheck> => {
    const started = Date.now();
    const command = formatCommand(npmExecutable, args);
    const checkEnv = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl,
    };

    if (name === 'Coverage') {
      mkdirSync(coverageTempPath, { recursive: true });
    }

    try {
      const result = await execFileAsync(npmExecutable, args, {
        cwd: repoRoot,
        env: checkEnv,
        timeout,
        maxBuffer: 1024 * 1024 * 6,
      });
      const durationMs = Date.now() - started;
      const stdout = result.stdout?.toString() ?? '';
      const stderr = result.stderr?.toString() ?? '';
      const output = `${stdout}\n${stderr}`.trim();
      const highlights = extractHighlights?.(output);
      const metadata = parseMetadata?.(output) ?? {};

      return {
        name,
        command,
        ok: true,
        exitCode: 0,
        durationMs,
        summary: summarize(stdout, stderr),
        details: truncateOutput(output),
        highlights,
        ...metadata,
      };
    } catch (error) {
      const durationMs = Date.now() - started;
      const failure = error as {
        code?: number;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        message?: string;
      };
      const stdout =
        typeof failure.stdout === 'string' ? failure.stdout : (failure.stdout?.toString() ?? '');
      const stderr =
        typeof failure.stderr === 'string' ? failure.stderr : (failure.stderr?.toString() ?? '');
      const output = `${stdout}\n${stderr}`.trim();
      const highlights = extractHighlights?.(output);
      const metadata = parseMetadata?.(output) ?? {};
      const runtimeSkipResult = buildRuntimeSkipResult(name, command, durationMs, output, metadata);

      if (runtimeSkipResult) {
        return runtimeSkipResult;
      }

      return {
        name,
        command,
        ok: false,
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
        durationMs,
        summary: summarize(stdout, stderr),
        details: truncateOutput(output.length > 0 ? output : (failure.message ?? 'Command failed')),
        highlights,
        ...metadata,
      };
    }
  };

  const collectDeveloperStatus = async (): Promise<DeveloperStatusPayload> => {
    const unitTests = await runDeveloperCheck(
      'Unit tests',
      ['run', 'test:unit'],
      (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
      parseTestHighlights,
      240000,
      parseTestMetadata('unit', 'Unit'),
    );

    const integrationTests = await runDeveloperCheck(
      'Integration tests',
      ['run', 'test:integration'],
      (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
      parseTestHighlights,
      240000,
      parseTestMetadata('integration', 'Integration'),
    );

    const e2eTests = await runDeveloperCheck(
      'E2E tests',
      ['run', 'test:e2e'],
      (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
      parseTestHighlights,
      420000,
      parseTestMetadata('e2e', 'E2E'),
    );

    const postgresTests = await runDeveloperCheck(
      'Postgres DB tests',
      ['run', 'test:postgres:dashboard'],
      (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
      parseTestHighlights,
      600000,
      parseTestMetadata('postgres', 'Postgres DB'),
    );

    const lint = await runDeveloperCheck(
      'Static analysis (lint)',
      ['run', 'lint'],
      (stdout) => summarizeLintOutput(stdout),
      undefined,
      240000,
      () => ({ areaLabel: 'Smells' }),
    );

    const typecheck = await runDeveloperCheck(
      'Static analysis (typecheck)',
      ['run', 'typecheck'],
      () => summarizeTypecheckOutput(),
      undefined,
      240000,
      () => ({ areaLabel: 'Types' }),
    );

    const coverage = await runDeveloperCheck(
      'Coverage',
      ['run', 'coverage'],
      (stdout) => summarizeCoverageOutput(stdout),
      parseCoverageHighlights,
      420000,
      (output) => ({
        areaLabel: 'Coverage',
        coverageBenchmarks: buildCoverageBenchmarks(output, readCoverageSummaryMetrics),
      }),
    );

    const security = await runDeveloperCheck(
      'Security vulnerabilities',
      ['run', 'security:scan:components', '--silent'],
      (stdout, stderr) => parseAuditSummary(stdout || stderr),
      parseSecurityHighlights,
      420000,
      (output) => ({ areaLabel: 'Security', ...parseSecurityMetadata(output) }),
    );

    const checks = [
      unitTests,
      integrationTests,
      e2eTests,
      postgresTests,
      lint,
      typecheck,
      coverage,
      security,
    ];
    const failedChecks = checks.filter((item) => !item.ok).length;
    const passedChecks = checks.length - failedChecks;
    const totalDurationMs = checks.reduce((sum, item) => sum + item.durationMs, 0);
    const overallStatus: 'healthy' | 'attention-needed' =
      failedChecks === 0 ? 'healthy' : 'attention-needed';

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
    if (developerStatusHistory.length > statusHistoryLimit) {
      developerStatusHistory.length = statusHistoryLimit;
    }

    payload.history = [...developerStatusHistory];

    return payload;
  };

  const getStatus = async (forceRefresh = false): Promise<DeveloperStatusResult> => {
    const now = Date.now();

    if (
      !forceRefresh &&
      developerStatusCache &&
      now - developerStatusCache.cachedAt < statusCacheTtlMs
    ) {
      return {
        payload: {
          ...developerStatusCache.payload,
          history: [...developerStatusHistory],
        },
        cache: {
          ttlMs: statusCacheTtlMs,
          ageMs: now - developerStatusCache.cachedAt,
          fromCache: true,
        },
      };
    }

    if (developerStatusInFlight !== null) {
      const payload = await developerStatusInFlight;
      return {
        payload,
        cache: {
          ttlMs: statusCacheTtlMs,
          ageMs: 0,
          fromCache: false,
        },
      };
    }

    developerStatusInFlight = collectDeveloperStatus();

    try {
      const payload = await developerStatusInFlight;
      developerStatusCache = { payload, cachedAt: Date.now() };
      return {
        payload,
        cache: {
          ttlMs: statusCacheTtlMs,
          ageMs: 0,
          fromCache: false,
        },
      };
    } finally {
      developerStatusInFlight = null;
    }
  };

  return {
    getStatus,
  };
};
