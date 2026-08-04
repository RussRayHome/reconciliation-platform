import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type {
  CreateDeveloperStatusServiceOptions,
  CoverageFileEntry,
  CoverageMetrics,
  DeveloperCheck,
  DeveloperHistoryTestTotals,
  PenetrationTestStatus,
  DeveloperStatusPayload,
  DeveloperStatusResult,
  DeveloperStatusSnapshot,
  RepoHealthKpis,
  TestBreakdown,
  TestItem,
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
  parseCoverageSummaryJson,
  parseDbTestItems,
  parseEslintJsonIssues,
  parsePlaywrightJsonSpecs,
  parseSecurityHighlights,
  parseSecurityMetadata,
  parseTestHighlights,
  parseTestMetadata,
  parseVitestJsonTestItems,
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
// packages/persistence/tests/{liquibase-migrations,postgresLifecycleStore}.test.ts spawn sibling
// `docker run -v <path>:...` invocations that require a real host Docker CLI (see
// packages/persistence/tests/testHelpers/liquibase.ts) — from inside this container's own
// Docker-outside-of-Docker setup, that bind-mount source path only exists in the container's own
// filesystem, so the host daemon rejects it. Both tests fail this exact way every time here.
const dockerSiblingMountPathDeniedRegex =
  /mounts denied|is not shared from the host and is not known to Docker/i;
// `unit-data`'s globalSetup (packages/persistence/tests/globalSetup.ts) starts a Testcontainers
// Postgres and runs Liquibase against it via a *sibling* `docker run` with a bind mount -- and
// that setup runs once per project, unconditionally, as long as ANY file in the project is
// selected. Excluding just the two Testcontainers-heavy test files (the original approach here)
// does not help: every other unit-data file still matches, so the same globalSetup still runs and
// still fails the same way. The only fix is dropping the whole project, which is what
// `coverage:docker-fallback` (package.json) does relative to `coverage`.
//
// Only list sources whose *sole* coverage comes from unit-data: postgres.ts, readModelStore.ts,
// and stateMachine.ts keep their own src-level unit tests (verified: they report real non-zero
// numbers even with unit-data entirely absent) and must stay measured. reconciliationLifecycleStore.ts
// does not -- it reports ~8% from other projects alone, which would unfairly drag down the overall
// score for code that unit-data actually covers well.
//
// Passed via env rather than `--coverage.exclude`: that CLI flag REPLACES coverage.exclude from
// vitest.config.ts instead of merging with it, which would silently pull dist/, scripts/,
// server.ts, and types.ts back into the denominator. vitest.config.ts reads this variable and
// appends, keeping the base exclude list defined in exactly one place.
const coverageDockerIncompatibleSourceExcludes = [
  'packages/persistence/src/reconciliationLifecycleStore.ts',
];
const coverageExtraExcludesEnvVar = 'COVERAGE_EXTRA_EXCLUDES';
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
const heavyDeveloperCheckNames = {
  e2e: 'E2E tests',
  coverage: 'Coverage',
  security: 'Security vulnerabilities',
} as const;
// The E2E suite runs 49 specs with workers: 1 (see playwright.config.ts — visual-baseline specs
// race when parallel). That is minutes of wall clock, far longer than a status request should
// block for, and the old inline 240s budget killed the subprocess before Playwright could write
// its JSON report — which is why the dashboard's E2E panel was permanently empty. It now runs
// detached with a real budget, and the payload carries a placeholder until it lands.
const e2eBackgroundTimeoutMs = Number(process.env.DEV_STATUS_E2E_TIMEOUT_MS ?? '1800000');
const e2eRunningHighlight =
  'E2E tests are running in the background. This section refreshes automatically once they finish.';
const e2eNotRunHighlight =
  'E2E tests have not run yet in this session. Use Force refresh to start them in the background.';
const deferredHeavyCheckHighlight =
  'Result reused from the last force refresh. Use Force refresh to run this check now.';

const isProductionRuntime = (): boolean => process.env.NODE_ENV === 'production';
const isContainerRuntime = (): boolean => existsSync('/.dockerenv');
const isToolingConstrainedRuntime = (): boolean => isProductionRuntime() || isContainerRuntime();
const shouldRequireE2EInContainer = (): boolean =>
  isContainerRuntime() && process.env.NODE_ENV === 'test';

const hostDevPostgresPreflightLogPath = '/var/lib/reconciliation/dev-postgres-preflight.log';
const defaultDeveloperStatusCachePath = '/var/lib/reconciliation/developer-status-cache.json';
const hostDevPostgresPreflightTotalsRegex = /Totals:\s*PASS=(\d+)\s*WARN=(\d+)\s*FAIL=(\d+)/i;

type HostPreflightTotals = {
  pass: number;
  warn: number;
  fail: number;
};

type CollectDeveloperStatusOptions = {
  includeHeavyChecks: boolean;
  cachedPayload?: DeveloperStatusPayload | null;
};

type DeveloperStatusInFlight = {
  promise: Promise<DeveloperStatusPayload>;
  includeHeavyChecks: boolean;
};

type PersistedDeveloperStatus = {
  payload: DeveloperStatusPayload;
  cachedAt: number;
  history: DeveloperStatusSnapshot[];
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
    const passedCount = hostTotals.pass + hostTotals.warn;
    const failedCount = hostTotals.fail;
    const totalCount = passedCount + failedCount;

    return {
      ...metadata,
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
      passedCount,
      failedCount,
      totalCount,
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
    if (shouldRequireE2EInContainer()) {
      return {
        name,
        command,
        ok: false,
        exitCode: 1,
        durationMs,
        summary: 'E2E runtime misconfigured: Playwright browser binaries are missing',
        details: truncateOutput(
          output.length > 0
            ? output
            : 'Playwright browser binaries are not available in this tools runtime.',
        ),
        highlights: [
          'This tools container is configured to execute E2E checks in-container.',
          'Run `npx playwright install --with-deps chromium` in the tools container (or restart tools) to install matching browser binaries.',
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
  statusCacheTtlMs = Number(process.env.DEV_STATUS_CACHE_TTL_MS ?? '600000'),
  statusHistoryLimit = Number(process.env.DEV_STATUS_HISTORY_LIMIT ?? '20'),
  statusCachePath = process.env.DEV_STATUS_CACHE_PATH ?? defaultDeveloperStatusCachePath,
}: CreateDeveloperStatusServiceOptions) => {
  const coverageSummaryPath = join(repoRoot, 'coverage', 'coverage-summary.json');
  const coverageTempPath = join(repoRoot, 'coverage', '.tmp');
  // Vitest's own --coverage flag uses coverage/.tmp internally for raw per-worker V8 data, so
  // these dashboard-only JSON reports must live in a separate directory — sharing coverage/.tmp
  // corrupts the Coverage check's own run (it deletes/recreates that directory mid-run).
  const devStatusTempPath = join(repoRoot, '.dev-status-tmp');
  const unitJsonReportPath = join(devStatusTempPath, 'unit-results.json');
  const integrationJsonReportPath = join(devStatusTempPath, 'integration-results.json');
  const postgresJsonReportPath = join(devStatusTempPath, 'postgres-results.json');
  const e2eJsonReportPath = join(devStatusTempPath, 'e2e-results.json');
  const lintJsonReportPath = join(devStatusTempPath, 'lint-results.json');

  let developerStatusCache: { payload: DeveloperStatusPayload; cachedAt: number } | null = null;
  let developerStatusInFlight: DeveloperStatusInFlight | null = null;
  const developerStatusHistory: DeveloperStatusSnapshot[] = [];
  // Detached E2E run. `e2eBackgroundRun` is non-null only while a run is in flight, so it doubles
  // as the "is it running" flag the payload placeholder is built from.
  let e2eBackgroundRun: Promise<void> | null = null;
  let lastCompletedE2eCheck: DeveloperCheck | null = null;

  // The check cache/history are otherwise in-memory only, so a tools-container
  // restart (e.g. a redeploy) wipes them and the dashboard shows an empty,
  // "refresh in progress" state until a full re-run completes. Persist the last
  // successful snapshot so the dashboard warms instantly after a restart.
  const persistDeveloperStatus = (): void => {
    if (!developerStatusCache) {
      return;
    }

    try {
      mkdirSync(dirname(statusCachePath), { recursive: true });
      const snapshot: PersistedDeveloperStatus = {
        payload: developerStatusCache.payload,
        cachedAt: developerStatusCache.cachedAt,
        history: [...developerStatusHistory],
      };
      writeFileSync(statusCachePath, JSON.stringify(snapshot), 'utf8');
    } catch {
      // Best-effort persistence; ignore when the state directory is unwritable.
    }
  };

  const loadPersistedDeveloperStatus = (): void => {
    if (!existsSync(statusCachePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(
        readFileSync(statusCachePath, 'utf8'),
      ) as Partial<PersistedDeveloperStatus> | null;

      if (
        !parsed ||
        typeof parsed.cachedAt !== 'number' ||
        !parsed.payload ||
        !Array.isArray(parsed.payload.checks) ||
        // Discard cache files written by an older payload shape (e.g. missing repoHealth)
        // rather than serving a malformed payload the frontend isn't prepared for.
        !parsed.payload.repoHealth
      ) {
        return;
      }

      if (Array.isArray(parsed.history)) {
        developerStatusHistory.splice(
          0,
          developerStatusHistory.length,
          ...parsed.history.slice(0, statusHistoryLimit),
        );
      }

      developerStatusCache = { payload: parsed.payload, cachedAt: parsed.cachedAt };
    } catch {
      // Ignore malformed cache files; a refresh will regenerate them.
    }
  };

  loadPersistedDeveloperStatus();

  const appendUniqueHighlight = (highlights: string[] | undefined, value: string): string[] => {
    const next = [...(highlights ?? [])];
    if (!next.includes(value)) {
      next.push(value);
    }

    return next;
  };

  const cloneDeferredHeavyCheck = (check: DeveloperCheck): DeveloperCheck => ({
    ...check,
    durationMs: 0,
    summary: check.summary.includes('(cached)') ? check.summary : `${check.summary} (cached)`,
    highlights: appendUniqueHighlight(check.highlights, deferredHeavyCheckHighlight),
  });

  const resolveDeferredHeavyChecks = (
    cachedPayload?: DeveloperStatusPayload | null,
  ): {
    e2eTests: DeveloperCheck;
    coverage: DeveloperCheck;
    security: DeveloperCheck;
  } | null => {
    const checksByName = new Map((cachedPayload?.checks ?? []).map((check) => [check.name, check]));
    const cachedE2e = checksByName.get(heavyDeveloperCheckNames.e2e);
    const cachedCoverage = checksByName.get(heavyDeveloperCheckNames.coverage);
    const cachedSecurity = checksByName.get(heavyDeveloperCheckNames.security);

    if (!cachedE2e || !cachedCoverage || !cachedSecurity) {
      return null;
    }

    return {
      e2eTests: cloneDeferredHeavyCheck(cachedE2e),
      coverage: cloneDeferredHeavyCheck(cachedCoverage),
      security: cloneDeferredHeavyCheck(cachedSecurity),
    };
  };

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

  const readCoverageFiles = (): CoverageFileEntry[] => {
    if (!existsSync(coverageSummaryPath)) {
      return [];
    }

    try {
      return parseCoverageSummaryJson(readFileSync(coverageSummaryPath, 'utf8'), repoRoot);
    } catch {
      return [];
    }
  };

  const readJsonReportFile = <T>(path: string, parse: (raw: string) => T[]): T[] => {
    if (!existsSync(path)) {
      return [];
    }

    try {
      return parse(readFileSync(path, 'utf8'));
    } catch {
      return [];
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
    extraEnv?: Record<string, string>,
  ): Promise<DeveloperCheck> => {
    const started = Date.now();
    const command = formatCommand(npmExecutable, args);
    const checkEnv = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl,
      ...extraEnv,
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

  const gitExecutable = 'git';

  const readGitCommandOutput = async (args: string[]): Promise<string | null> => {
    try {
      const result = await execFileAsync(gitExecutable, args, {
        cwd: repoRoot,
        timeout: 5000,
        killSignal: 'SIGKILL',
      });
      const value = result.stdout?.toString().trim() ?? '';
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  };

  const getCommitsThisWeek = async (): Promise<number | null> => {
    const output = await readGitCommandOutput([
      'rev-list',
      '--count',
      '--since=7 days ago',
      'HEAD',
    ]);
    if (output === null) {
      return null;
    }

    const count = Number.parseInt(output, 10);
    return Number.isFinite(count) ? count : null;
  };

  const getBranchFreshness = async (): Promise<RepoHealthKpis['branchFreshness']> => {
    const remoteRef = 'origin/stage vs origin/dev';
    const output = await readGitCommandOutput([
      'rev-list',
      '--left-right',
      '--count',
      'origin/stage...origin/dev',
    ]);

    if (output === null) {
      return { remoteRef, aheadCount: null, behindCount: null };
    }

    const [aheadRaw, behindRaw] = output.split(/\s+/u);
    const aheadCount = Number.parseInt(aheadRaw ?? '', 10);
    const behindCount = Number.parseInt(behindRaw ?? '', 10);

    return {
      remoteRef,
      aheadCount: Number.isFinite(aheadCount) ? aheadCount : null,
      behindCount: Number.isFinite(behindCount) ? behindCount : null,
    };
  };

  const getOpenPrCount = async (): Promise<{ openPrCount: number | null; openPrNote?: string }> => {
    try {
      const result = await execFileAsync(
        'gh',
        ['pr', 'list', '--state', 'open', '--json', 'number', '--jq', 'length'],
        { cwd: repoRoot, timeout: 8000, killSignal: 'SIGKILL' },
      );
      const count = Number.parseInt(result.stdout?.toString().trim() ?? '', 10);
      return Number.isFinite(count) ? { openPrCount: count } : { openPrCount: null };
    } catch {
      return {
        openPrCount: null,
        openPrNote: 'gh CLI is unavailable or not authenticated in this runtime.',
      };
    }
  };

  const collectRepoHealthKpis = async (
    overallStatus: RepoHealthKpis['overallStatus'],
    failedChecks: number,
    totalDurationMs: number,
    generatedAt: string,
  ): Promise<RepoHealthKpis> => {
    const [commitsThisWeek, branchFreshness, openPr] = await Promise.all([
      getCommitsThisWeek(),
      getBranchFreshness(),
      getOpenPrCount(),
    ]);

    return {
      overallStatus,
      failedChecks,
      lastCiRun: { status: overallStatus, durationMs: totalDurationMs, at: generatedAt },
      commitsThisWeek,
      branchFreshness,
      openPrCount: openPr.openPrCount,
      openPrNote: openPr.openPrNote,
    };
  };

  const e2eCommand = formatCommand(npmExecutable, [
    'run',
    'test:e2e',
    '--',
    '--reporter=list,json',
  ]);

  /** Placeholder shown while the detached E2E run is still going. */
  const buildE2eRunningCheck = (): DeveloperCheck => ({
    name: heavyDeveloperCheckNames.e2e,
    command: e2eCommand,
    // Deliberately not `false`: a run in progress is neither passed nor failed, and marking it
    // failed would flip overallStatus to attention-needed for the whole dashboard.
    ok: true,
    running: true,
    exitCode: 0,
    durationMs: 0,
    summary: 'Running in the background',
    details: e2eRunningHighlight,
    highlights: [e2eRunningHighlight],
    areaLabel: 'E2E',
    testType: 'e2e',
    e2eSpecs: [],
  });

  /** Placeholder for a session where E2E has not been started yet. */
  const buildE2eNotRunCheck = (): DeveloperCheck => ({
    name: heavyDeveloperCheckNames.e2e,
    command: e2eCommand,
    ok: true,
    exitCode: 0,
    durationMs: 0,
    summary: 'Not run yet',
    details: e2eNotRunHighlight,
    highlights: [e2eNotRunHighlight],
    areaLabel: 'E2E',
    testType: 'e2e',
    e2eSpecs: [],
  });

  const runE2eCheck = async (): Promise<DeveloperCheck> => {
    const check = await runDeveloperCheck(
      heavyDeveloperCheckNames.e2e,
      ['run', 'test:e2e', '--', '--reporter=list,json'],
      (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
      parseTestHighlights,
      e2eBackgroundTimeoutMs,
      parseTestMetadata('e2e', 'E2E'),
      { PLAYWRIGHT_JSON_OUTPUT_NAME: e2eJsonReportPath },
    );
    check.e2eSpecs = readJsonReportFile(e2eJsonReportPath, parsePlaywrightJsonSpecs);
    return check;
  };

  /**
   * Swaps the finished E2E result into the cached payload so the next poll picks it up, and
   * recomputes the pass/fail tallies the placeholder was excluded from.
   */
  const applyE2eResultToCache = (completed: DeveloperCheck): void => {
    const cached = developerStatusCache;
    if (!cached) {
      return;
    }

    const checks = cached.payload.checks.map((check) =>
      check.name === heavyDeveloperCheckNames.e2e ? completed : check,
    );
    const failedChecks = checks.filter((check) => !check.ok && check.running !== true).length;

    developerStatusCache = {
      payload: {
        ...cached.payload,
        checks,
        failedChecks,
        passedChecks: checks.length - failedChecks,
        overallStatus: failedChecks > 0 ? 'attention-needed' : 'healthy',
      },
      cachedAt: cached.cachedAt,
    };
    persistDeveloperStatus();
  };

  /** Starts the detached E2E run unless one is already in flight. Never throws. */
  const startE2eBackgroundRun = (): void => {
    if (e2eBackgroundRun !== null) {
      return;
    }

    e2eBackgroundRun = (async () => {
      try {
        const completed = await runE2eCheck();
        lastCompletedE2eCheck = completed;
        applyE2eResultToCache(completed);
      } catch {
        // Swallowed on purpose: a failed background run must not reject an unhandled promise or
        // wipe the last good result. The next force refresh retries.
      } finally {
        e2eBackgroundRun = null;
      }
    })();
  };

  const resolveE2eCheck = (): DeveloperCheck =>
    e2eBackgroundRun !== null
      ? buildE2eRunningCheck()
      : (lastCompletedE2eCheck ?? buildE2eNotRunCheck());

  const collectDeveloperStatus = async ({
    includeHeavyChecks,
    cachedPayload,
  }: CollectDeveloperStatusOptions): Promise<DeveloperStatusPayload> => {
    const penetrationTestStatuses =
      process.env.DEPLOY_ENV === 'stage' ? collectPenetrationTestStatuses(repoRoot) : undefined;

    mkdirSync(devStatusTempPath, { recursive: true });

    // Every test item, not just failures -- the dashboard renders a full per-test pass/fail
    // listing (TestItem is small: name/suite/status/reason?/durationMs?, so this doesn't bloat
    // the payload even for hundreds of tests).
    const allTestItems = (path: string): TestItem[] =>
      readJsonReportFile(path, (raw) => parseVitestJsonTestItems(raw, repoRoot));

    const unitTests = await runDeveloperCheck(
      'Unit tests',
      [
        'run',
        'test:unit',
        '--',
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${unitJsonReportPath}`,
      ],
      (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
      parseTestHighlights,
      240000,
      parseTestMetadata('unit', 'Unit'),
    );
    unitTests.testItems = allTestItems(unitJsonReportPath);

    const integrationTests = await runDeveloperCheck(
      'Integration tests',
      [
        'run',
        'test:integration:dashboard',
        '--',
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${integrationJsonReportPath}`,
      ],
      (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
      parseTestHighlights,
      240000,
      parseTestMetadata('integration', 'Integration'),
    );
    integrationTests.testItems = allTestItems(integrationJsonReportPath);

    const postgresTests = await runDeveloperCheck(
      'Postgres DB tests',
      ['run', 'test:postgres:dashboard'],
      (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
      parseTestHighlights,
      600000,
      parseTestMetadata('postgres', 'Postgres DB'),
    );
    // Best-effort: the preflight script above stays the authority for pass/fail, but the
    // Database tests detail panel wants the real migration/constraint test names — run the
    // actual Vitest postgres suite's JSON reporter separately and fold in whatever it produces.
    // If Docker/Testcontainers aren't available in this runtime, this just yields an empty list.
    try {
      await execFileAsync(
        npmExecutable,
        [
          'run',
          'test:postgres',
          '--',
          '--reporter=json',
          `--outputFile.json=${postgresJsonReportPath}`,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl },
          timeout: 300000,
          maxBuffer: 1024 * 1024 * 6,
        },
      );
    } catch {
      // Ignored — dbTestItems below simply stays empty when this can't run here.
    }
    postgresTests.dbTestItems = readJsonReportFile(postgresJsonReportPath, (raw) =>
      parseDbTestItems(raw, repoRoot),
    );

    const lint = await runDeveloperCheck(
      'Static analysis (lint)',
      ['run', 'lint'],
      (stdout) => summarizeLintOutput(stdout),
      undefined,
      240000,
      () => ({ areaLabel: 'Static analysis' }),
    );
    // Best-effort second pass purely for structured issue rows — ESLint can't emit its default
    // human-readable summary and --format json in the same invocation, and the check above
    // already determined lint's pass/fail from the default formatter.
    try {
      await execFileAsync(
        npmExecutable,
        ['run', 'lint', '--', '--format', 'json', '--output-file', lintJsonReportPath],
        { cwd: repoRoot, timeout: 240000, maxBuffer: 1024 * 1024 * 6 },
      );
    } catch {
      // ESLint exits non-zero when it finds issues even though --output-file was written
      // successfully — that's expected, not a failure of this best-effort pass.
    }
    lint.lintIssues = readJsonReportFile(lintJsonReportPath, (raw) =>
      parseEslintJsonIssues(raw, repoRoot),
    );

    const typecheck = await runDeveloperCheck(
      'Static analysis (typecheck)',
      ['run', 'typecheck'],
      () => summarizeTypecheckOutput(),
      undefined,
      240000,
      () => ({ areaLabel: 'Static analysis' }),
    );

    // E2E is deliberately absent here — it is started detached by startE2eBackgroundRun() and
    // reconciled into the cache when it finishes, so a force refresh returns as soon as coverage
    // and security are done rather than blocking for the whole Playwright suite.
    const runHeavyChecks = async (): Promise<{
      coverage: DeveloperCheck;
      security: DeveloperCheck;
    }> => {
      const runCoverageCheck = (
        args: string[],
        extraEnv?: Record<string, string>,
      ): Promise<DeveloperCheck> =>
        runDeveloperCheck(
          heavyDeveloperCheckNames.coverage,
          args,
          (stdout) => summarizeCoverageOutput(stdout),
          parseCoverageHighlights,
          420000,
          (output) => ({
            areaLabel: 'Coverage',
            coverageBenchmarks: buildCoverageBenchmarks(output, readCoverageSummaryMetrics),
            coverageFiles: readCoverageFiles(),
          }),
          extraEnv,
        );

      let coverage = await runCoverageCheck(['run', 'coverage']);

      if (!coverage.ok && dockerSiblingMountPathDeniedRegex.test(coverage.details)) {
        coverage = await runCoverageCheck(['run', 'coverage:docker-fallback'], {
          [coverageExtraExcludesEnvVar]: coverageDockerIncompatibleSourceExcludes.join(','),
        });
        coverage.highlights = appendUniqueHighlight(
          coverage.highlights,
          'Dropped the unit-data project entirely: its globalSetup spawns a sibling Docker ' +
            'container (Testcontainers Postgres) and runs Liquibase against it via a bind mount ' +
            'that needs a real host Docker CLI, unavailable from this runtime. Excluding ' +
            'individual test files does not help — the same globalSetup still runs for any other ' +
            'file left in the project.',
        );
        coverage.highlights = appendUniqueHighlight(
          coverage.highlights,
          'Also dropped the sources unit-data solely covers ' +
            `(${coverageDockerIncompatibleSourceExcludes.join(', ')}) from the coverage ` +
            'denominator — measuring them here understates them. Run `npm run coverage` from a ' +
            'Docker-enabled host for a complete figure.',
        );
      }

      const securityBase = await runDeveloperCheck(
        heavyDeveloperCheckNames.security,
        ['run', 'security:scan:components', '--silent'],
        (stdout, stderr) => parseAuditSummary(stdout || stderr),
        parseSecurityHighlights,
        420000,
        (output) => ({ areaLabel: 'Security', ...parseSecurityMetadata(output) }),
      );

      return {
        coverage,
        security: {
          ...securityBase,
          penetrationTestStatuses,
        },
      };
    };

    const deferredHeavyChecks = includeHeavyChecks
      ? null
      : resolveDeferredHeavyChecks(cachedPayload ?? developerStatusCache?.payload);

    if (includeHeavyChecks) {
      // Kick E2E off before awaiting coverage/security so it overlaps with them instead of
      // queueing behind them.
      startE2eBackgroundRun();
    }

    const { coverage, security } = deferredHeavyChecks ?? (await runHeavyChecks());
    // An in-flight run always wins, so a poll during the run shows "running" rather than the
    // stale result it is about to replace. Otherwise fall back to the cached result.
    const e2eTests =
      e2eBackgroundRun !== null
        ? buildE2eRunningCheck()
        : (deferredHeavyChecks?.e2eTests ?? resolveE2eCheck());

    const checks = [
      unitTests,
      integrationTests,
      postgresTests,
      lint,
      typecheck,
      coverage,
      security,
      e2eTests,
    ];
    // A check still running in the background counts as neither passed nor failed.
    const failedChecks = checks.filter((item) => !item.ok && item.running !== true).length;
    const passedChecks = checks.length - failedChecks;
    const totalDurationMs = checks.reduce((sum, item) => sum + item.durationMs, 0);
    const overallStatus: 'healthy' | 'attention-needed' =
      failedChecks === 0 ? 'healthy' : 'attention-needed';
    const generatedAt = new Date().toISOString();
    const repoHealth = await collectRepoHealthKpis(
      overallStatus,
      failedChecks,
      totalDurationMs,
      generatedAt,
    );

    const payload: DeveloperStatusPayload = {
      generatedAt,
      repositoryPath: repoRoot,
      overallStatus,
      failedChecks,
      passedChecks,
      totalChecks: checks.length,
      totalDurationMs,
      checks,
      history: [],
      repoHealth,
    };

    developerStatusHistory.unshift(buildStatusSnapshot(payload));
    if (developerStatusHistory.length > statusHistoryLimit) {
      developerStatusHistory.length = statusHistoryLimit;
    }

    payload.history = [...developerStatusHistory];

    return payload;
  };

  const toCachedPayload = (payload: DeveloperStatusPayload): DeveloperStatusPayload => ({
    ...payload,
    history: [...developerStatusHistory],
  });

  const createCacheInfo = ({
    ageMs,
    fromCache,
    stale,
    refreshInProgress,
  }: {
    ageMs: number;
    fromCache: boolean;
    stale: boolean;
    refreshInProgress: boolean;
  }) => ({
    ttlMs: statusCacheTtlMs,
    ageMs,
    fromCache,
    stale,
    refreshInProgress,
  });

  const createWarmupPayload = (): DeveloperStatusPayload => ({
    generatedAt: new Date().toISOString(),
    repositoryPath: repoRoot,
    overallStatus: 'healthy',
    failedChecks: 0,
    passedChecks: 0,
    totalChecks: 0,
    totalDurationMs: 0,
    checks: [],
    history: [...developerStatusHistory],
    repoHealth: {
      overallStatus: 'healthy',
      failedChecks: 0,
      lastCiRun: { status: 'healthy', durationMs: 0, at: new Date().toISOString() },
      commitsThisWeek: null,
      branchFreshness: {
        remoteRef: 'origin/stage vs origin/dev',
        aheadCount: null,
        behindCount: null,
      },
      openPrCount: null,
    },
  });

  const runRefresh = async (includeHeavyChecks: boolean): Promise<DeveloperStatusPayload> => {
    if (developerStatusInFlight !== null) {
      if (!includeHeavyChecks || developerStatusInFlight.includeHeavyChecks) {
        return developerStatusInFlight.promise;
      }

      try {
        await developerStatusInFlight.promise;
      } catch {
        // Ignore in-flight failures so a force refresh can retry with heavy checks.
      }
    }

    const refreshPromise = collectDeveloperStatus({
      includeHeavyChecks,
      cachedPayload: developerStatusCache?.payload ?? null,
    });
    developerStatusInFlight = {
      promise: refreshPromise,
      includeHeavyChecks,
    };

    try {
      const payload = await refreshPromise;
      developerStatusCache = { payload, cachedAt: Date.now() };
      persistDeveloperStatus();
      return payload;
    } finally {
      if (developerStatusInFlight?.promise === refreshPromise) {
        developerStatusInFlight = null;
      }
    }
  };

  const triggerBackgroundRefresh = (): void => {
    if (developerStatusInFlight !== null) {
      return;
    }

    void runRefresh(false).catch(() => undefined);
  };

  const getStatus = async (forceRefresh = false): Promise<DeveloperStatusResult> => {
    const now = Date.now();
    const cacheAgeMs = developerStatusCache ? now - developerStatusCache.cachedAt : 0;
    const hasFreshCache = developerStatusCache !== null && cacheAgeMs < statusCacheTtlMs;

    if (!forceRefresh && developerStatusCache && hasFreshCache) {
      return {
        payload: toCachedPayload(developerStatusCache.payload),
        cache: createCacheInfo({
          ageMs: cacheAgeMs,
          fromCache: true,
          stale: false,
          refreshInProgress: developerStatusInFlight !== null,
        }),
      };
    }

    if (!forceRefresh && developerStatusCache) {
      triggerBackgroundRefresh();

      return {
        payload: toCachedPayload(developerStatusCache.payload),
        cache: createCacheInfo({
          ageMs: cacheAgeMs,
          fromCache: true,
          stale: true,
          refreshInProgress: true,
        }),
      };
    }

    if (!forceRefresh && developerStatusCache === null && isToolingConstrainedRuntime()) {
      triggerBackgroundRefresh();

      return {
        payload: createWarmupPayload(),
        cache: createCacheInfo({
          ageMs: 0,
          fromCache: false,
          stale: true,
          refreshInProgress: true,
        }),
      };
    }

    const payload = await runRefresh(true);
    return {
      payload,
      cache: createCacheInfo({
        ageMs: 0,
        fromCache: false,
        stale: false,
        refreshInProgress: false,
      }),
    };
  };

  return {
    getStatus,
  };
};
