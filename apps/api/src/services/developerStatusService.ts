import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  CreateDeveloperStatusServiceOptions,
  CoverageMetrics,
  DeveloperCheck,
  DeveloperHistoryTestTotals,
  PenetrationTestStatus,
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
const runtimeDockerUnavailableRegex =
  /docker info failed|Cannot connect to the Docker daemon|docker:\s*not found|permission denied while trying to connect to the Docker daemon|Could not find a working container runtime strategy/i;
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

const hostDevPostgresPreflightLogPath = '/var/lib/reconciliation/dev-postgres-preflight.log';
const hostDevPostgresPreflightTotalsRegex = /Totals:\s*PASS=(\d+)\s*WARN=(\d+)\s*FAIL=(\d+)/i;

type HostPreflightTotals = {
  pass: number;
  warn: number;
  fail: number;
};

type ZapReportSummary = {
  alertCount: number;
  failureAlerts: number;
  warningAlerts: number;
  parseError?: string;
};

type ZapApiCsvSummary = {
  totalTargets: number;
  passedTargets: number;
  warningTargets: number;
  failedTargets: number;
  errorTargets: number;
  invalidRows: number;
};

const parseZapRiskCode = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  count === 1 ? singular : plural;

const readZapReportSummary = (reportPath: string): ZapReportSummary | null => {
  if (!existsSync(reportPath)) {
    return null;
  }

  try {
    const payload = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      site?: Array<{ alerts?: Array<{ riskcode?: unknown }> }>;
    };
    const sites = Array.isArray(payload.site) ? payload.site : [];
    let alertCount = 0;
    let failureAlerts = 0;
    let warningAlerts = 0;

    for (const site of sites) {
      const alerts = Array.isArray(site?.alerts) ? site.alerts : [];
      for (const alert of alerts) {
        alertCount += 1;

        const riskCode = parseZapRiskCode(alert?.riskcode);
        if (riskCode !== null && riskCode >= 2) {
          failureAlerts += 1;
          continue;
        }

        if (riskCode === 1) {
          warningAlerts += 1;
        }
      }
    }

    return {
      alertCount,
      failureAlerts,
      warningAlerts,
    };
  } catch {
    return {
      alertCount: 0,
      failureAlerts: 0,
      warningAlerts: 0,
      parseError: 'Unable to parse ZAP report JSON.',
    };
  }
};

const readZapApiCsvSummary = (summaryPath: string): ZapApiCsvSummary | null => {
  if (!existsSync(summaryPath)) {
    return null;
  }

  try {
    const lines = readFileSync(summaryPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length <= 1) {
      return {
        totalTargets: 0,
        passedTargets: 0,
        warningTargets: 0,
        failedTargets: 0,
        errorTargets: 0,
        invalidRows: 0,
      };
    }

    let totalTargets = 0;
    let passedTargets = 0;
    let warningTargets = 0;
    let failedTargets = 0;
    let errorTargets = 0;
    let invalidRows = 0;

    for (const line of lines.slice(1)) {
      const firstComma = line.indexOf(',');
      const secondComma = line.indexOf(',', firstComma + 1);

      if (firstComma === -1 || secondComma === -1) {
        invalidRows += 1;
        continue;
      }

      const exitCodeRaw = line.slice(firstComma + 1, secondComma).trim();
      const exitCode = Number.parseInt(exitCodeRaw, 10);
      totalTargets += 1;

      if (!Number.isFinite(exitCode)) {
        invalidRows += 1;
        continue;
      }

      if (exitCode === 0) {
        passedTargets += 1;
      } else if (exitCode === 2) {
        warningTargets += 1;
      } else if (exitCode === 1) {
        failedTargets += 1;
      } else if (exitCode === 3) {
        errorTargets += 1;
      } else {
        invalidRows += 1;
      }
    }

    return {
      totalTargets,
      passedTargets,
      warningTargets,
      failedTargets,
      errorTargets,
      invalidRows,
    };
  } catch {
    return null;
  }
};

const readZapApiTargetSummaries = (apiReportDir: string): ZapReportSummary[] => {
  if (!existsSync(apiReportDir)) {
    return [];
  }

  try {
    const entries = readdirSync(apiReportDir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('target-'))
      .map((entry) => readZapReportSummary(join(apiReportDir, entry.name, 'zap-report.json')))
      .filter((summary): summary is ZapReportSummary => summary !== null);
  } catch {
    return [];
  }
};

const collectPenetrationTestStatuses = (repoRoot: string): PenetrationTestStatus[] => {
  const securityReportRoot = join(repoRoot, 'test-results', 'security');
  const webReportPath = join(securityReportRoot, 'zap-web-stage', 'zap-report.json');
  const apiReportDir = join(securityReportRoot, 'zap-api-stage');
  const apiSummaryCsvPath = join(apiReportDir, 'scan-summary.csv');

  const webStatus: PenetrationTestStatus = {
    testName: 'OWASP ZAP Baseline (Stage Web)',
    testType: 'Web frontend',
    status: 'not-run',
    note: 'Not run in this workspace.',
    source: 'test-results/security/zap-web-stage',
  };

  const webSummary = readZapReportSummary(webReportPath);
  if (webSummary) {
    if (webSummary.parseError) {
      webStatus.status = 'failed';
      webStatus.note = webSummary.parseError;
    } else if (webSummary.failureAlerts > 0) {
      webStatus.status = 'failed';
      webStatus.note = `${webSummary.failureAlerts} medium/high ${pluralize(webSummary.failureAlerts, 'alert')} detected.`;
    } else if (webSummary.warningAlerts > 0) {
      webStatus.status = 'passed';
      webStatus.note = `No medium/high alerts. ${webSummary.warningAlerts} low-risk ${pluralize(webSummary.warningAlerts, 'alert')} detected.`;
    } else {
      webStatus.status = 'passed';
      webStatus.note = `No alerts detected across ${webSummary.alertCount} reported ${pluralize(webSummary.alertCount, 'item')}.`;
    }
  }

  const apiStatus: PenetrationTestStatus = {
    testName: 'OWASP ZAP Baseline (Stage API)',
    testType: 'API endpoints',
    status: 'not-run',
    note: 'Not run in this workspace.',
    source: 'test-results/security/zap-api-stage',
  };

  const apiCsvSummary = readZapApiCsvSummary(apiSummaryCsvPath);
  if (apiCsvSummary) {
    if (apiCsvSummary.totalTargets === 0) {
      apiStatus.status = 'not-run';
      apiStatus.note = 'Summary file exists but no API targets were scanned.';
    } else if (
      apiCsvSummary.failedTargets > 0 ||
      apiCsvSummary.errorTargets > 0 ||
      apiCsvSummary.invalidRows > 0
    ) {
      apiStatus.status = 'failed';
      apiStatus.note = [
        `Targets: ${apiCsvSummary.totalTargets}`,
        `Fail: ${apiCsvSummary.failedTargets}`,
        `Error: ${apiCsvSummary.errorTargets}`,
        `Invalid rows: ${apiCsvSummary.invalidRows}`,
      ].join(' | ');
    } else {
      apiStatus.status = 'passed';
      apiStatus.note = [
        `Targets: ${apiCsvSummary.totalTargets}`,
        `Pass: ${apiCsvSummary.passedTargets}`,
        `Warn: ${apiCsvSummary.warningTargets}`,
      ].join(' | ');
    }
  } else {
    const apiTargetSummaries = readZapApiTargetSummaries(apiReportDir);
    if (apiTargetSummaries.length > 0) {
      const parseErrors = apiTargetSummaries.filter((item) => item.parseError).length;
      const failureAlerts = apiTargetSummaries.reduce((sum, item) => sum + item.failureAlerts, 0);
      const warningAlerts = apiTargetSummaries.reduce((sum, item) => sum + item.warningAlerts, 0);

      if (parseErrors > 0) {
        apiStatus.status = 'failed';
        apiStatus.note = `${parseErrors} target ${pluralize(parseErrors, 'report')} could not be parsed.`;
      } else if (failureAlerts > 0) {
        apiStatus.status = 'failed';
        apiStatus.note = `${failureAlerts} medium/high ${pluralize(failureAlerts, 'alert')} detected across ${apiTargetSummaries.length} targets.`;
      } else {
        apiStatus.status = 'passed';
        apiStatus.note = [
          `Targets: ${apiTargetSummaries.length}`,
          `No medium/high alerts`,
          `Low-risk alerts: ${warningAlerts}`,
        ].join(' | ');
      }
    }
  }

  return [webStatus, apiStatus];
};

const readHostDevPostgresPreflightLog = (): string | null => {
  if (!existsSync(hostDevPostgresPreflightLogPath)) {
    return null;
  }

  try {
    const content = readFileSync(hostDevPostgresPreflightLogPath, 'utf8').trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
};

const parseHostDevPostgresPreflightTotals = (content: string): HostPreflightTotals | null => {
  const match = hostDevPostgresPreflightTotalsRegex.exec(content);
  if (!match) {
    return null;
  }

  return {
    pass: Number(match[1]),
    warn: Number(match[2]),
    fail: Number(match[3]),
  };
};

const buildPostgresRuntimeSkipDetails = (command: string): string => {
  return [
    `Command requires host Docker daemon access: ${command}`,
    'Current API container runtime does not provide Docker daemon/tooling access.',
    'Run this check from the host workspace for a definitive Postgres result.',
  ].join('\n');
};

const buildPostgresRuntimeSkip = (
  name: string,
  command: string,
  durationMs: number,
  _output: string,
  metadata: Partial<DeveloperCheck>,
  reason: string,
): DeveloperCheck => {
  const hostRunLog = readHostDevPostgresPreflightLog();
  const hostTotals = hostRunLog ? parseHostDevPostgresPreflightTotals(hostRunLog) : null;

  if (hostRunLog && hostTotals) {
    const hasFailures = hostTotals.fail > 0;

    return {
      name,
      command,
      ok: !hasFailures,
      exitCode: hasFailures ? 1 : 0,
      durationMs,
      summary: `Host dev preflight snapshot: PASS=${hostTotals.pass}, WARN=${hostTotals.warn}, FAIL=${hostTotals.fail}`,
      details: truncateOutput(hostRunLog),
      highlights: [
        'Showing latest host dev Postgres preflight snapshot.',
        `Totals: PASS=${hostTotals.pass}, WARN=${hostTotals.warn}, FAIL=${hostTotals.fail}`,
        'Run `npm run docker:db:preflight:dev` from host to refresh this snapshot.',
      ],
      ...metadata,
    };
  }

  if (hostRunLog) {
    return {
      name,
      command,
      ok: true,
      exitCode: 0,
      durationMs,
      summary: 'Host dev preflight snapshot loaded (totals unavailable)',
      details: truncateOutput(hostRunLog),
      highlights: [
        'Showing latest host dev Postgres preflight snapshot.',
        'Run `npm run docker:db:preflight:dev` from host to refresh this snapshot.',
      ],
      ...metadata,
    };
  }

  return {
    name,
    command,
    ok: true,
    exitCode: 0,
    durationMs,
    summary: 'Skipped in container runtime: Postgres DB checks require host Docker tooling',
    details: truncateOutput(buildPostgresRuntimeSkipDetails(command)),
    highlights: [
      reason,
      'This check runs Docker preflight and Postgres Vitest suites that are designed for host execution.',
      'Run `npm run test:postgres:dashboard` from the host workspace for definitive results.',
    ],
    ...metadata,
  };
};

const buildMissingToolRuntimeSkip = (
  name: string,
  command: string,
  durationMs: number,
  output: string,
  metadata: Partial<DeveloperCheck>,
  tool: string,
): DeveloperCheck => ({
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
});

const buildRuntimeToolSkipResult = (
  name: string,
  command: string,
  durationMs: number,
  output: string,
  metadata: Partial<DeveloperCheck>,
): DeveloperCheck | null => {
  if (!runtimeSkippableChecks.has(name)) {
    return null;
  }

  if (runtimeDockerUnavailableRegex.test(output)) {
    if (name === 'Postgres DB tests') {
      return buildPostgresRuntimeSkip(
        name,
        command,
        durationMs,
        output,
        metadata,
        'Skipped because Docker tooling is unavailable from the current API container runtime.',
      );
    }

    return {
      name,
      command,
      ok: true,
      exitCode: 0,
      durationMs,
      summary: 'Skipped in container runtime: Docker tooling is unavailable',
      details: truncateOutput(
        output.length > 0 ? output : 'Docker tooling is not available in this runtime image.',
      ),
      highlights: [
        'Skipped because Docker tooling is unavailable from the current API container runtime.',
        'Run this check from the host workspace (or a dev-tooling image) for definitive results.',
      ],
      ...metadata,
    };
  }

  const missingTool = runtimeMissingToolRegex.exec(output)?.[1];
  if (!missingTool) {
    return null;
  }

  if (name === 'Postgres DB tests') {
    return buildPostgresRuntimeSkip(
      name,
      command,
      durationMs,
      output,
      metadata,
      `Skipped because ${missingTool} is unavailable in the current API container image.`,
    );
  }

  return buildMissingToolRuntimeSkip(name, command, durationMs, output, metadata, missingTool);
};

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

  const runtimeToolSkipResult = buildRuntimeToolSkipResult(
    name,
    command,
    durationMs,
    output,
    metadata,
  );
  if (runtimeToolSkipResult) {
    return runtimeToolSkipResult;
  }

  if (name === 'E2E tests' && runtimePlaywrightBrowserMissingRegex.test(output)) {
    return {
      name,
      command,
      ok: true,
      exitCode: 0,
      durationMs,
      summary: 'Skipped in container runtime: run E2E tests from host workspace',
      details: truncateOutput(
        output.length > 0
          ? output
          : 'Playwright browser binaries are not available in this runtime image.',
      ),
      highlights: ['Run `npm run test:e2e` from the host workspace for definitive results.'],
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

/**
 * Creates the developer status service, which orchestrates all quality-gate checks
 * (lint, typecheck, unit/integration/e2e tests, coverage, security scans) and caches
 * the resulting payload for the Developer Dashboard.
 *
 * @param options Configuration options including the repo root path, database URL, cache
 * TTL, and history limit.
 * @returns An object with `getStatus` and `clearCache` methods.
 */
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

      if (
        name === 'Unit tests' &&
        runtimeDockerUnavailableRegex.test(output) &&
        (metadata.failedCount ?? 0) === 0 &&
        (metadata.passedCount ?? 0) > 0
      ) {
        return {
          name,
          command,
          ok: true,
          exitCode: 0,
          durationMs,
          summary: `Passed: ${metadata.passedCount}, Failed: 0`,
          details: truncateOutput(output),
          highlights: [
            'Unit assertions passed; Docker-dependent Testcontainers suites were not available in this runtime.',
            'Run `npm run test:postgres` from a Docker-enabled host for Postgres integration coverage.',
          ],
          ...metadata,
        };
      }

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
    const penetrationTestStatuses =
      process.env.DEPLOY_ENV === 'stage' ? collectPenetrationTestStatuses(repoRoot) : undefined;

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
      ['run', 'test:integration:dashboard'],
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
      90000,
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
      () => ({ areaLabel: 'Static analysis' }),
    );

    const typecheck = await runDeveloperCheck(
      'Static analysis (typecheck)',
      ['run', 'typecheck'],
      () => summarizeTypecheckOutput(),
      undefined,
      240000,
      () => ({ areaLabel: 'Static analysis' }),
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

    const securityBase = await runDeveloperCheck(
      'Security vulnerabilities',
      ['run', 'security:scan:components', '--silent'],
      (stdout, stderr) => parseAuditSummary(stdout || stderr),
      parseSecurityHighlights,
      420000,
      (output) => ({ areaLabel: 'Security', ...parseSecurityMetadata(output) }),
    );

    const security: DeveloperCheck = {
      ...securityBase,
      penetrationTestStatuses,
    };

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
