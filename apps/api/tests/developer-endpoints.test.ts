/** Integration tests for developer-facing API endpoints and diagnostics. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleBankWorkbook, createSampleGlWorkbook } from '@recon/test-fixtures';
import { authedApp } from './testHelpers/authToken';


type ExecFileCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

type HealthResponseBody = {
  status: string;
  timestamp: string;
};

type DeveloperStatusResponseBody = {
  overallStatus: string;
  cache: {
    fromCache: boolean;
    stale?: boolean;
    refreshInProgress?: boolean;
  };
  checks: Array<{
    name: string;
    testType?: string;
    ok?: boolean;
    running?: boolean;
    passedFileCount?: number;
    failedFileCount?: number;
    totalFileCount?: number;
    passedCount?: number;
    failedCount?: number;
    areaLabel?: string;
    testItems?: Array<{ name: string; suite: string; status: string; reason?: string }>;
    lintIssues?: Array<{ rule: string; severity: string; file: string; line: number }>;
    dbTestItems?: Array<{ name: string; category: string; status: string }>;
    e2eSpecs?: Array<{ name: string; status: string }>;
    securityComponentScores?: Array<{
      component: string;
      critical: number;
      high: number;
      moderate: number;
      low: number;
      info: number;
      cveFindings?: Array<{
        id: string;
        severity: string;
        installedVersion?: string;
        fixedVersion?: string;
      }>;
    }>;
    securityCveFindings?: Array<{
      id: string;
      severity: string;
      component: string;
    }>;
  }>;
  history: Array<{
    testTotals: {
      passed: number;
      failed: number;
    };
    failingAreas: string[];
  }>;
  repoHealth: {
    overallStatus: string;
    failedChecks: number;
    lastCiRun: { status: string; durationMs: number; at: string };
    commitsThisWeek: number | null;
    branchFreshness: { remoteRef: string; aheadCount: number | null; behindCount: number | null };
    openPrCount: number | null;
  };
};

type RuntimeResponseBody = {
  apiStatus: string;
  gitContext: {
    branch: string;
    commit: string;
    isDirty: boolean | null;
  };
  promotionReadiness: {
    sync: {
      trackingBranch: string | null;
      remoteRef: string | null;
      localCommit: string | null;
      remoteCommit: string | null;
      aheadCount: number | null;
      behindCount: number | null;
      inSync: boolean | null;
    };
    baseline: {
      tagName: string;
      exists: boolean;
      commit: string | null;
      matchesHead: boolean | null;
    };
    overall: string;
    summary: string;
    environments: Array<{
      name: string;
      runtime: string;
      sourceBranch: string | null;
      targetRevision: string | null;
      status: string;
      note: string;
    }>;
  };
  recentReconciliationRuns: unknown[];
  recentFailedRequests: unknown[];
  recentExceptions: unknown[];
};

type ItemsResponseBody = {
  items: unknown[];
};

type ErrorResponseBody = {
  message: string;
};

type ExecFileResult = { stdout: string; stderr: string };
type ExecFileMatcher = {
  matches: (joined: string) => boolean;
  result: ExecFileResult;
  sideEffect?: (args: string[], options: { env?: Record<string, string> }) => void;
  /** Overrides `globalExecFileDelayMs` for this matcher specifically, e.g. to keep the detached
   *  E2E run artificially in-flight without slowing down every other check. */
  delayMs?: () => number;
  /** When set and truthy, the call rejects (mimicking a real non-zero exit) with this
   *  stdout/stderr instead of resolving with `result` -- lets a single test flip one command to
   *  the failure path without a bespoke mock for the whole file. */
  failure?: () => ExecFileResult | null;
};

/** Slows down every mocked execFile call that doesn't set its own `delayMs` -- used to keep a
 *  force-refresh request in flight long enough to reliably observe overlap with a second request,
 *  since the mocked commands otherwise resolve near-instantly and the request completes before a
 *  concurrent one can be fired. Reset to 0 in `afterEach`. */
let globalExecFileDelayMs = 0;
/** When set, the `npm run test:unit` mock fails instead of succeeding -- see `failure` on
 *  ExecFileMatcher. Reset to false in `afterEach`. */
let unitTestShouldFail = false;
/** Slows down only the `npm run test:e2e` mock, since it runs detached from the rest of the
 *  request (the response doesn't await it) -- delaying it is what makes the "running in the
 *  background" placeholder state observable in a single request instead of racing timing. */
let e2eExecFileDelayMs = 0;

/** Writes `content` to the path from an inline `flag=value` style arg (e.g. `--outputFile.json=`). */
const writeFixtureFromInlineArg = (args: string[], flagPrefix: string, content: string): void => {
  const targetPath = args.find((arg) => arg.startsWith(flagPrefix))?.slice(flagPrefix.length);
  if (!targetPath) return;
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, 'utf8');
};

/** Writes `content` to the path following a standalone flag arg (e.g. `--output-file <path>`). */
const writeFixtureFromFlagValue = (args: string[], flag: string, content: string): void => {
  const flagIndex = args.indexOf(flag);
  const targetPath = flagIndex === -1 ? undefined : args[flagIndex + 1];
  if (!targetPath) return;
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, 'utf8');
};

const vitestJsonFixture = (fullName: string, status: 'passed' | 'failed', suite: string): string =>
  JSON.stringify({
    testResults: [
      {
        name: suite,
        assertionResults: [
          { fullName, status, duration: 12, failureMessages: status === 'failed' ? ['boom'] : [] },
        ],
      },
    ],
  });

const execFileMatchers: ExecFileMatcher[] = [
  {
    matches: (joined) => joined.includes('git branch --show-current'),
    result: { stdout: 'feature/developer-dashboard-docs\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('git rev-parse --short HEAD'),
    result: { stdout: 'abc1234\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('git log -1 --pretty=%s'),
    result: { stdout: 'Latest commit\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('git status --porcelain'),
    result: { stdout: '', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('git symbolic-ref --short refs/remotes/origin/HEAD'),
    result: { stdout: 'origin/dev\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('git rev-parse --short origin/dev'),
    result: { stdout: 'abc1234\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('git rev-list --left-right --count origin/dev...HEAD'),
    result: { stdout: '0\t0\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('git rev-parse --short stable-baseline-2026-05-14^{}'),
    result: { stdout: 'abc1234\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('git rev-parse --short origin/stage'),
    result: { stdout: 'abc1234\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('git rev-parse --short origin/main'),
    result: { stdout: 'def5678\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('git rev-list --count --since=7 days ago HEAD'),
    result: { stdout: '17\n', stderr: '' },
  },
  {
    matches: (joined) =>
      joined.includes('git rev-list --left-right --count origin/stage...origin/dev'),
    result: { stdout: '1\t3\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('gh pr list'),
    result: { stdout: '2\n', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('npm') && joined.includes('run test:unit'),
    result: {
      stdout: 'Test Files  9 passed (9)\nTests  114 passed (114)\n',
      stderr: '',
    },
    failure: () =>
      unitTestShouldFail
        ? { stdout: 'Test Files  1 failed | 8 passed (9)\nTests  1 failed | 113 passed (114)\n', stderr: '' }
        : null,
    sideEffect: (args) =>
      writeFixtureFromInlineArg(
        args,
        '--outputFile.json=',
        unitTestShouldFail
          ? vitestJsonFixture('a broken unit test', 'failed', 'apps/web/src/App.test.tsx')
          : vitestJsonFixture('a skipped unit test', 'passed', 'apps/web/src/App.test.tsx'),
      ),
  },
  {
    matches: (joined) => joined.includes('npm') && joined.includes('run test:integration'),
    result: {
      stdout: 'Test Files  1 passed (1)\nTests  5 passed (5)\n',
      stderr: '',
    },
    sideEffect: (args) =>
      writeFixtureFromInlineArg(
        args,
        '--outputFile.json=',
        vitestJsonFixture('an integration test', 'passed', 'apps/api/tests/server.test.ts'),
      ),
  },
  {
    matches: (joined) => joined.includes('npm') && joined.includes('run test:e2e'),
    result: {
      stdout: 'Running 1 test using 1 worker\n\n  1 passed (7.0s)\n',
      stderr: '',
    },
    delayMs: () => e2eExecFileDelayMs,
    sideEffect: (_args, options) => {
      const target = options.env?.PLAYWRIGHT_JSON_OUTPUT_NAME;
      if (!target) return;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        JSON.stringify({
          suites: [
            {
              title: 'reconciliation.spec.ts',
              specs: [
                {
                  title: 'requires login',
                  ok: true,
                  tests: [
                    { results: [{ status: 'passed', duration: 500, retry: 0, attachments: [] }] },
                  ],
                },
              ],
            },
          ],
        }),
        'utf8',
      );
    },
  },
  {
    matches: (joined) => joined.includes('npm') && joined.includes('run test:postgres:dashboard'),
    result: {
      stdout: 'Test Files  2 passed (2)\nTests  11 passed (11)\n',
      stderr: '',
    },
  },
  {
    matches: (joined) =>
      joined.includes('npm') &&
      joined.includes('run test:postgres') &&
      joined.includes('--reporter=json'),
    result: { stdout: '', stderr: '' },
    sideEffect: (args) =>
      writeFixtureFromInlineArg(
        args,
        '--outputFile.json=',
        vitestJsonFixture(
          'migration_apply_clean_db',
          'passed',
          'packages/persistence/tests/liquibase-migrations.test.ts',
        ),
      ),
  },
  {
    matches: (joined) =>
      joined.includes('npm') && joined.includes('run lint') && joined.includes('--format'),
    result: { stdout: '', stderr: '' },
    sideEffect: (args) =>
      writeFixtureFromFlagValue(
        args,
        '--output-file',
        JSON.stringify([
          {
            filePath: '/app/apps/web/src/App.tsx',
            messages: [{ ruleId: 'no-unused-vars', severity: 1, line: 10, message: 'unused' }],
          },
        ]),
      ),
  },
  {
    matches: (joined) => joined.includes('npm') && joined.includes('run lint'),
    result: { stdout: '', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('npm') && joined.includes('run typecheck'),
    result: { stdout: '', stderr: '' },
  },
  {
    matches: (joined) => joined.includes('npm') && joined.includes('run coverage'),
    result: {
      stdout: 'All files          |   81.2 |    80.0 |   82.1 |   81.2',
      stderr: '',
    },
  },
  {
    matches: (joined) =>
      joined.includes('npm') && joined.includes('run security:scan:components --silent'),
    result: {
      stdout: JSON.stringify({
        components: [
          {
            component: 'API',
            scanner: 'npm audit',
            status: 'ok',
            critical: 0,
            high: 0,
            moderate: 0,
            low: 0,
            info: 0,
            total: 0,
          },
          {
            component: 'Database',
            scanner: 'Trivy + pgAudit',
            status: 'ok',
            critical: 0,
            high: 0,
            moderate: 0,
            low: 0,
            info: 0,
            total: 0,
            cveFindings: [
              {
                id: 'CVE-2026-33845',
                description: 'Sample database CVE',
                severity: 'CRITICAL',
                component: 'Database',
                scanner: 'Trivy + pgAudit',
              },
            ],
          },
          {
            component: 'Container Component',
            scanner: 'Trivy',
            status: 'ok',
            critical: 0,
            high: 0,
            moderate: 0,
            low: 0,
            info: 0,
            total: 0,
            cveFindings: [
              {
                id: 'CVE-2023-45853',
                description: 'Sample container CVE',
                severity: 'CRITICAL',
                component: 'Container Component',
                scanner: 'Trivy',
              },
            ],
          },
          {
            component: 'Web Server',
            scanner: 'npm audit',
            status: 'ok',
            critical: 0,
            high: 0,
            moderate: 0,
            low: 0,
            info: 0,
            total: 0,
          },
        ],
        aggregate: {
          critical: 0,
          high: 0,
          moderate: 0,
          low: 0,
          info: 0,
          total: 0,
        },
        cveFindings: [
          {
            id: 'CVE-2026-33845',
            description: 'Sample database CVE',
            severity: 'CRITICAL',
            component: 'Database',
            scanner: 'Trivy + pgAudit',
          },
          {
            id: 'CVE-2023-45853',
            description: 'Sample container CVE',
            severity: 'CRITICAL',
            component: 'Container Component',
            scanner: 'Trivy',
          },
        ],
      }),
      stderr: '',
    },
  },
];

const mockExecFile = vi.fn(
  (
    command: string,
    args: string[],
    options: { env?: Record<string, string> },
    callback: ExecFileCallback,
  ) => {
    const joined = [command, ...args].join(' ');

    const matched = execFileMatchers.find((matcher) => matcher.matches(joined));

    if (matched) {
      const delay = matched.delayMs ? matched.delayMs() : globalExecFileDelayMs;
      const failureResult = matched.failure?.() ?? null;
      const fire = () => {
        matched.sideEffect?.(args, options);
        if (failureResult) {
          // Mimics what Node's real execFile passes to its callback on a non-zero exit: an Error
          // with `code`/`stdout`/`stderr` attached, which runDeveloperCheck's catch branch reads.
          const error = Object.assign(new Error('Command failed'), {
            code: 1,
            stdout: failureResult.stdout,
            stderr: failureResult.stderr,
          });
          callback(error as Error & { code: number; stdout: string; stderr: string });
        } else {
          callback(null, matched.result);
        }
      };
      if (delay > 0) {
        setTimeout(fire, delay);
      } else {
        fire();
      }
      return;
    }

    callback(new Error(`Unexpected execFile call: ${joined}`));
  },
);

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

const importCreateApp = async () => {
  const module = await import('../src/app');
  return module.createApp;
};

describe('developer endpoints', () => {
  const originalEnv = { ...process.env };
  let statusCacheDir: string;

  beforeEach(() => {
    vi.resetModules();
    mockExecFile.mockClear();
    process.env = { ...originalEnv };
    process.env.ENABLE_DEVELOPER_DIAGNOSTICS = 'true';
    // vi.resetModules() gives every test a fresh authService.ts instance, which would otherwise
    // generate its own ephemeral JWT secret per test -- while authedApp() (testHelpers/authToken)
    // signs against the one statically-imported copy resolved when this file first loaded. An
    // explicit shared secret keeps mint and verify on the same value regardless of module resets.
    process.env.JWT_SECRET = 'test-secret-developer-endpoints';
    // Isolate every test from any real persisted developer-status cache
    // (present inside the tools container) so cold-start expectations hold.
    statusCacheDir = mkdtempSync(join(tmpdir(), 'dev-status-cache-'));
    process.env.DEV_STATUS_CACHE_PATH = join(statusCacheDir, 'developer-status-cache.json');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(statusCacheDir, { recursive: true, force: true });
    // Some checks write real JSON-reporter fixtures under the repo's own .dev-status-tmp
    // (mirroring what the real npm scripts would produce) — clean those up between tests.
    rmSync(join(process.cwd(), '.dev-status-tmp'), { recursive: true, force: true });
    globalExecFileDelayMs = 0;
    e2eExecFileDelayMs = 0;
    unitTestShouldFail = false;
  });

  it('returns health status', async () => {
    const createApp = await importCreateApp();
    const app = createApp();

    const response = await authedApp(app).get('/api/health').expect(200);
    const body = response.body as HealthResponseBody;

    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTypeOf('string');
  });

  it('returns Prometheus metrics payload', async () => {
    const createApp = await importCreateApp();
    const app = createApp();

    await authedApp(app).get('/api/health').expect(200);

    const response = await authedApp(app).get('/api/metrics').expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('recon_api_http_requests_total');
    expect(response.text).toContain('recon_api_http_request_duration_seconds');
  });

  it('returns 404 for metrics endpoint when metrics are disabled', async () => {
    process.env.ENABLE_API_METRICS = 'false';

    const createApp = await importCreateApp();
    const app = createApp();

    const response = await authedApp(app).get('/api/metrics').expect(404);

    expect(response.text).toContain('API metrics are disabled');
  });

  it('applies rate limiting to API routes while exempting health and metrics endpoints', async () => {
    process.env.DISABLE_API_RATE_LIMIT = 'false';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '1';
    process.env.RATE_LIMIT_USE_REDIS = 'false';

    const createApp = await importCreateApp();
    const app = createApp();

    await authedApp(app).get('/api/health').expect(200);
    await authedApp(app).get('/api/health').expect(200);

    await authedApp(app).get('/api/metrics').expect(200);
    await authedApp(app).get('/api/metrics').expect(200);

    await authedApp(app).get('/api/reconciliation/latest').expect(404);
    const throttledResponse = await authedApp(app).get('/api/reconciliation/latest').expect(429);

    const throttledBody = throttledResponse.body as ErrorResponseBody;
    expect(throttledBody.message).toContain('Too many requests');
  });

  it('returns developer status with test totals and cache metadata', async () => {
    const createApp = await importCreateApp();
    const app = createApp();

    const response = await authedApp(app).get('/api/developer/status?force=1').expect(200);
    const body = response.body as DeveloperStatusResponseBody;

    expect(body.overallStatus).toBe('healthy');
    expect(body.cache).toMatchObject({
      fromCache: false,
    });
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Unit tests',
          testType: 'unit',
          passedFileCount: 9,
          failedFileCount: 0,
          totalFileCount: 9,
          passedCount: 114,
          failedCount: 0,
          areaLabel: 'Unit',
        }),
        expect.objectContaining({
          name: 'Integration tests',
          testType: 'integration',
          passedFileCount: 1,
          failedFileCount: 0,
          totalFileCount: 1,
          passedCount: 5,
          failedCount: 0,
          areaLabel: 'Integration',
        }),
        expect.objectContaining({
          name: 'E2E tests',
          testType: 'e2e',
          passedCount: 1,
          failedCount: 0,
          areaLabel: 'E2E',
        }),
        expect.objectContaining({
          name: 'Postgres DB tests',
          testType: 'postgres',
          passedFileCount: 2,
          failedFileCount: 0,
          totalFileCount: 2,
          passedCount: 11,
          failedCount: 0,
          areaLabel: 'Postgres DB',
        }),
        expect.objectContaining({
          name: 'Static analysis (lint)',
          areaLabel: 'Static analysis',
        }),
        expect.objectContaining({
          name: 'Static analysis (typecheck)',
          areaLabel: 'Static analysis',
        }),
        expect.objectContaining({
          name: 'Security vulnerabilities',
          areaLabel: 'Security',
        }),
      ]),
    );
    expect(body.checks.map((check) => check.name)).toEqual([
      'Unit tests',
      'Integration tests',
      'Postgres DB tests',
      'Static analysis (lint)',
      'Static analysis (typecheck)',
      'Coverage',
      'Security vulnerabilities',
      'E2E tests',
    ]);

    const securityCheck = body.checks.find((check) => check.name === 'Security vulnerabilities');
    expect(securityCheck).toBeDefined();
    expect(securityCheck?.securityComponentScores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: 'API' }),
        expect.objectContaining({ component: 'Database' }),
        expect.objectContaining({ component: 'Container Component' }),
        expect.objectContaining({ component: 'Web Server' }),
      ]),
    );

    const databaseSecurityScore = securityCheck?.securityComponentScores?.find(
      (item) => item.component === 'Database',
    );
    expect(databaseSecurityScore).toBeDefined();
    expect(
      databaseSecurityScore?.cveFindings?.some(
        (finding) => finding.id === 'CVE-2026-33845' && finding.severity === 'CRITICAL',
      ),
    ).toBe(true);

    const containerSecurityScore = securityCheck?.securityComponentScores?.find(
      (item) => item.component === 'Container Component',
    );
    expect(containerSecurityScore).toBeDefined();
    expect(
      containerSecurityScore?.cveFindings?.some(
        (finding) => finding.id === 'CVE-2023-45853' && finding.severity === 'CRITICAL',
      ),
    ).toBe(true);

    expect(securityCheck?.securityCveFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'CVE-2026-33845',
          severity: 'CRITICAL',
          component: 'Database',
        }),
        expect.objectContaining({
          id: 'CVE-2023-45853',
          severity: 'CRITICAL',
          component: 'Container Component',
        }),
      ]),
    );

    expect(body.history[0]).toMatchObject({
      testTotals: {
        passed: 131,
        failed: 0,
      },
      failingAreas: [],
    });

    const unitCheck = body.checks.find((check) => check.name === 'Unit tests');
    // developerStatusService.ts intentionally reports every test item, not just failures, so the
    // dashboard can render a full per-test pass/fail listing -- this fixture's one passing item
    // included.
    expect(unitCheck?.testItems).toEqual([
      expect.objectContaining({ name: 'a skipped unit test', status: 'passed' }),
    ]);

    const postgresCheck = body.checks.find((check) => check.name === 'Postgres DB tests');
    expect(postgresCheck?.dbTestItems).toEqual([
      expect.objectContaining({
        name: 'migration_apply_clean_db',
        category: 'migration',
        status: 'passed',
      }),
    ]);

    const lintCheck = body.checks.find((check) => check.name === 'Static analysis (lint)');
    expect(lintCheck?.lintIssues).toEqual([
      expect.objectContaining({ rule: 'no-unused-vars', severity: 'warning', line: 10 }),
    ]);

    const e2eCheck = body.checks.find((check) => check.name === 'E2E tests');
    expect(e2eCheck?.e2eSpecs).toEqual([
      expect.objectContaining({
        name: expect.stringContaining('requires login'),
        status: 'passed',
      }),
    ]);

    expect(databaseSecurityScore?.cveFindings?.[0]).toMatchObject({
      id: 'CVE-2026-33845',
    });

    expect(body.repoHealth).toMatchObject({
      overallStatus: 'healthy',
      failedChecks: 0,
      commitsThisWeek: 17,
      branchFreshness: {
        remoteRef: 'origin/stage vs origin/dev',
        aheadCount: 1,
        behindCount: 3,
      },
      openPrCount: 2,
    });
    expect(body.repoHealth.lastCiRun.status).toBe('healthy');
  });

  it('returns warmup payload immediately for non-force cold starts in constrained runtimes', async () => {
    process.env.NODE_ENV = 'production';

    const createApp = await importCreateApp();
    const app = createApp();

    const response = await authedApp(app).get('/api/developer/status').expect(200);
    const body = response.body as DeveloperStatusResponseBody;

    expect(body.cache).toMatchObject({
      fromCache: false,
      stale: true,
      refreshInProgress: true,
    });
    expect(body.overallStatus).toBe('healthy');
    expect(body.checks).toHaveLength(0);
  });

  it('serves a persisted status snapshot immediately after a restart without re-running checks', async () => {
    const cachePath = process.env.DEV_STATUS_CACHE_PATH as string;
    const persisted = {
      payload: {
        generatedAt: new Date().toISOString(),
        repositoryPath: '/app',
        overallStatus: 'healthy',
        failedChecks: 0,
        passedChecks: 1,
        totalChecks: 1,
        totalDurationMs: 1234,
        checks: [
          {
            name: 'Unit tests',
            command: 'npm run test:unit',
            ok: true,
            exitCode: 0,
            durationMs: 1234,
            summary: 'Passed: 10, Failed: 0',
            details: '',
          },
        ],
        history: [],
        repoHealth: {
          overallStatus: 'healthy',
          failedChecks: 0,
          lastCiRun: { status: 'healthy', durationMs: 1234, at: new Date().toISOString() },
          commitsThisWeek: 5,
          branchFreshness: {
            remoteRef: 'origin/stage vs origin/dev',
            aheadCount: 0,
            behindCount: 0,
          },
          openPrCount: 1,
        },
      },
      cachedAt: Date.now(),
      history: [],
    };
    writeFileSync(cachePath, JSON.stringify(persisted), 'utf8');

    const createApp = await importCreateApp();
    const app = createApp();

    const response = await authedApp(app).get('/api/developer/status').expect(200);
    const body = response.body as DeveloperStatusResponseBody;

    expect(body.cache.fromCache).toBe(true);
    expect(body.cache.refreshInProgress).toBe(false);
    expect(body.checks).toHaveLength(1);
    expect(body.checks[0]?.name).toBe('Unit tests');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('serves a stale cached snapshot and kicks off a background refresh once it ages past the TTL', async () => {
    const cachePath = process.env.DEV_STATUS_CACHE_PATH as string;
    const persisted = {
      payload: {
        generatedAt: new Date().toISOString(),
        repositoryPath: '/app',
        overallStatus: 'healthy',
        failedChecks: 0,
        passedChecks: 1,
        totalChecks: 1,
        totalDurationMs: 1234,
        checks: [
          {
            name: 'Unit tests',
            command: 'npm run test:unit',
            ok: true,
            exitCode: 0,
            durationMs: 1234,
            summary: 'Passed: 10, Failed: 0',
            details: '',
          },
        ],
        history: [],
        repoHealth: {
          overallStatus: 'healthy',
          failedChecks: 0,
          lastCiRun: { status: 'healthy', durationMs: 1234, at: new Date().toISOString() },
          commitsThisWeek: 5,
          branchFreshness: {
            remoteRef: 'origin/stage vs origin/dev',
            aheadCount: 0,
            behindCount: 0,
          },
          openPrCount: 1,
        },
      },
      // Older than the default 10-minute cache TTL (DEV_STATUS_CACHE_TTL_MS), so getStatus treats
      // this as stale rather than fresh and serves it while refreshing in the background instead
      // of blocking the response on a full re-run.
      cachedAt: Date.now() - 700_000,
      history: [],
    };
    writeFileSync(cachePath, JSON.stringify(persisted), 'utf8');

    const createApp = await importCreateApp();
    const app = createApp();

    const response = await authedApp(app).get('/api/developer/status').expect(200);
    const body = response.body as DeveloperStatusResponseBody;

    expect(body.cache).toMatchObject({
      fromCache: true,
      stale: true,
      refreshInProgress: true,
    });
    expect(body.checks).toHaveLength(1);
    expect(body.checks[0]?.name).toBe('Unit tests');

    // Wait for the background refresh triggered above to actually land in the cache, then read
    // it back. The persisted fixture never had a Coverage/Security/E2E check to defer from, so
    // resolveDeferredHeavyChecks returns null and this light refresh runs everything except E2E
    // itself (which only starts on a heavy/force refresh) -- exercising the "E2E not run yet"
    // placeholder rather than the "running" or completed states the other tests cover.
    await vi.waitFor(
      () => {
        const invocations = mockExecFile.mock.calls.filter(([command, args]) =>
          [command as string, ...(args as string[])].join(' ').includes('run coverage'),
        );
        expect(invocations).toHaveLength(1);
      },
      { timeout: 2000 },
    );

    const refreshedResponse = await authedApp(app).get('/api/developer/status').expect(200);
    const refreshedBody = refreshedResponse.body as DeveloperStatusResponseBody;

    expect(refreshedBody.cache).toMatchObject({ fromCache: true, stale: false });
    const e2eCheck = refreshedBody.checks.find((check) => check.name === 'E2E tests');
    expect(e2eCheck?.ok).toBe(true);
    expect(e2eCheck?.running).not.toBe(true);
    expect(e2eCheck?.e2eSpecs).toEqual([]);
  });

  it('deduplicates concurrent force-refresh requests instead of running checks twice', async () => {
    // The mocked checks otherwise resolve near-instantly, so the first request would complete
    // (and clear developerStatusInFlight) before a second request could ever be fired -- slow
    // every check down enough that both requests are reliably in flight together.
    globalExecFileDelayMs = 30;

    const createApp = await importCreateApp();
    const app = createApp();

    // supertest/superagent requests are lazy until `.then()`/`.end()` is called, so wrapping in
    // `Promise.resolve()` is what actually sends this one -- otherwise it would just sit
    // unsent while `vi.waitFor` below spins.
    const firstRequest = Promise.resolve(authedApp(app).get('/api/developer/status?force=1'));
    // The first request sets `developerStatusInFlight` synchronously, before it issues its first
    // execFile call -- so waiting for that first call guarantees the in-flight marker is already
    // set before the second request is fired.
    await vi.waitFor(() => expect(mockExecFile).toHaveBeenCalled());

    const [first, second] = await Promise.all([
      firstRequest,
      authedApp(app).get('/api/developer/status?force=1'),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const unitTestInvocations = mockExecFile.mock.calls.filter(([command, args]) =>
      [command as string, ...(args as string[])].join(' ').includes('run test:unit'),
    );
    expect(unitTestInvocations).toHaveLength(1);

    expect((first.body as DeveloperStatusResponseBody).overallStatus).toBe('healthy');
    expect((second.body as DeveloperStatusResponseBody).overallStatus).toBe('healthy');
  });

  it('reports E2E as running in the background while its detached run is still in flight', async () => {
    // Keeps the E2E mock unresolved well past the point the rest of the force-refresh request
    // finishes, so the response is assembled while e2eBackgroundRun is still non-null.
    e2eExecFileDelayMs = 500;

    const createApp = await importCreateApp();
    const app = createApp();

    const response = await authedApp(app).get('/api/developer/status?force=1').expect(200);
    const body = response.body as DeveloperStatusResponseBody;

    const e2eCheck = body.checks.find((check) => check.name === 'E2E tests');
    expect(e2eCheck).toMatchObject({
      testType: 'e2e',
      ok: true,
      running: true,
    });
    expect(e2eCheck?.e2eSpecs).toEqual([]);

    // Poll until the detached run actually finishes so the delayed execFile call (and its
    // setTimeout) doesn't leak into the next test.
    await vi.waitFor(
      () => {
        const invocations = mockExecFile.mock.calls.filter(([command, args]) =>
          [command as string, ...(args as string[])].join(' ').includes('run test:e2e'),
        );
        expect(invocations).toHaveLength(1);
      },
      { timeout: 2000 },
    );
    await new Promise((resolve) => setTimeout(resolve, e2eExecFileDelayMs + 50));
  });

  it('upgrades to a full heavy run instead of reusing a lighter in-flight background refresh', async () => {
    // Slow enough that the light background refresh triggered by the stale-cache read below is
    // still running when the force-refresh request arrives immediately after it.
    globalExecFileDelayMs = 40;

    const cachePath = process.env.DEV_STATUS_CACHE_PATH as string;
    const persisted = {
      payload: {
        generatedAt: new Date().toISOString(),
        repositoryPath: '/app',
        overallStatus: 'healthy',
        failedChecks: 0,
        passedChecks: 1,
        totalChecks: 1,
        totalDurationMs: 1234,
        checks: [
          {
            name: 'Unit tests',
            command: 'npm run test:unit',
            ok: true,
            exitCode: 0,
            durationMs: 1234,
            summary: 'Passed: 10, Failed: 0',
            details: '',
          },
          // resolveDeferredHeavyChecks only defers Coverage/Security/E2E when the cached payload
          // already has all three -- without them a "light" background refresh falls back to
          // running everything anyway, defeating the point of this test.
          {
            name: 'Coverage',
            command: 'npm run coverage',
            ok: true,
            exitCode: 0,
            durationMs: 1234,
            summary: 'Coverage S/B/F/L: S 90% | B 90% | F 90% | L 90%',
            details: '',
          },
          {
            name: 'Security vulnerabilities',
            command: 'npm run security:scan:components --silent',
            ok: true,
            exitCode: 0,
            durationMs: 1234,
            summary: 'Vulnerabilities across 4 components: total 0',
            details: '',
          },
          {
            name: 'E2E tests',
            command: 'npm run test:e2e -- --reporter=list,json',
            ok: true,
            exitCode: 0,
            durationMs: 1234,
            summary: 'Passed: 1, Failed: 0',
            details: '',
          },
        ],
        history: [],
        repoHealth: {
          overallStatus: 'healthy',
          failedChecks: 0,
          lastCiRun: { status: 'healthy', durationMs: 1234, at: new Date().toISOString() },
          commitsThisWeek: 5,
          branchFreshness: {
            remoteRef: 'origin/stage vs origin/dev',
            aheadCount: 0,
            behindCount: 0,
          },
          openPrCount: 1,
        },
      },
      cachedAt: Date.now() - 700_000,
      history: [],
    };
    writeFileSync(cachePath, JSON.stringify(persisted), 'utf8');

    const createApp = await importCreateApp();
    const app = createApp();

    // Reads the stale cache and fires a background (non-heavy) refresh without waiting for it.
    const staleResponse = await authedApp(app).get('/api/developer/status').expect(200);
    expect((staleResponse.body as DeveloperStatusResponseBody).cache).toMatchObject({
      fromCache: true,
      stale: true,
      refreshInProgress: true,
    });

    // Arrives while that background refresh is still in flight (includeHeavyChecks: false), so
    // runRefresh must await it and then run its own heavy refresh rather than reusing its result.
    const forceResponse = await authedApp(app).get('/api/developer/status?force=1').expect(200);
    expect(forceResponse.status).toBe(200);

    const coverageInvocations = mockExecFile.mock.calls.filter(([command, args]) =>
      [command as string, ...(args as string[])].join(' ').includes('run coverage'),
    );
    // Coverage is deferred on a light refresh and only ever run as part of a heavy one -- exactly
    // one invocation proves the force request performed its own full run rather than short-
    // circuiting to the lighter in-flight refresh's (coverage-less) result.
    expect(coverageInvocations).toHaveLength(1);

    const unitTestInvocations = mockExecFile.mock.calls.filter(([command, args]) =>
      [command as string, ...(args as string[])].join(' ').includes('run test:unit'),
    );
    // Once for the light background refresh, once more for the force refresh's own heavy run.
    expect(unitTestInvocations).toHaveLength(2);
  });

  it('reports a failed check as attention-needed instead of masking it as healthy', async () => {
    // Every other test in this file mocks fully-successful commands, so runDeveloperCheck's
    // failure branch (a non-zero exit) and the overallStatus/failedChecks rollup it feeds are
    // otherwise never exercised.
    unitTestShouldFail = true;

    const createApp = await importCreateApp();
    const app = createApp();

    const response = await authedApp(app).get('/api/developer/status?force=1').expect(200);
    const body = response.body as DeveloperStatusResponseBody;

    expect(body.overallStatus).toBe('attention-needed');

    const unitCheck = body.checks.find((check) => check.name === 'Unit tests');
    expect(unitCheck?.ok).toBe(false);
    expect(unitCheck?.testItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'failed' })]),
    );

    expect(body.history[0]).toMatchObject({
      failingAreas: expect.arrayContaining([expect.any(String)]),
    });
  });

  it('returns runtime diagnostics and recent developer activity', async () => {
    const createApp = await importCreateApp();
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    await authedApp(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    await authedApp(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', Buffer.from('not-an-excel-file'), {
        filename: 'bank.txt',
        contentType: 'text/plain',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/octet-stream',
      })
      .expect(400);

    const runtime = await authedApp(app).get('/api/developer/runtime').expect(200);
    const runtimeBody = runtime.body as RuntimeResponseBody;

    expect(runtimeBody.apiStatus).toBe('reachable');
    expect(runtimeBody.gitContext).toMatchObject({
      branch: 'feature/developer-dashboard-docs',
      commit: 'abc1234',
      isDirty: null,
    });
    expect(runtimeBody.promotionReadiness.sync).toMatchObject({
      trackingBranch: 'dev',
      remoteRef: 'origin/dev',
      localCommit: 'abc1234',
      remoteCommit: 'abc1234',
      aheadCount: 0,
      behindCount: 0,
      inSync: true,
    });
    expect(runtimeBody.promotionReadiness.baseline).toMatchObject({
      tagName: 'stable-baseline-2026-05-14',
      exists: true,
      commit: 'abc1234',
      matchesHead: true,
    });
    expect(runtimeBody.promotionReadiness.overall).toBe('ready');
    expect(runtimeBody.promotionReadiness.environments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'dev',
          runtime: 'Docker Compose',
          sourceBranch: 'feature/developer-dashboard-docs',
          targetRevision: 'abc1234',
          status: 'ready',
        }),
        expect.objectContaining({
          name: 'stage',
          runtime: 'Docker Compose',
          sourceBranch: 'dev',
          targetRevision: 'abc1234',
          status: 'ready',
        }),
        expect.objectContaining({
          name: 'prod',
          runtime: 'AWS',
          sourceBranch: 'main',
          targetRevision: 'def5678',
          status: 'ready',
        }),
      ]),
    );
    expect(runtimeBody.recentReconciliationRuns.length).toBeGreaterThanOrEqual(1);
    expect(runtimeBody.recentFailedRequests.length).toBeGreaterThanOrEqual(1);
    expect(runtimeBody.recentExceptions.length).toBeGreaterThanOrEqual(1);

    const requests = await authedApp(app).get('/api/developer/runtime/requests?limit=1').expect(200);
    const requestsBody = requests.body as ItemsResponseBody;

    expect(requestsBody.items).toHaveLength(1);

    const exceptions = await authedApp(app)
      .get('/api/developer/runtime/exceptions?limit=1')
      .expect(200);
    const exceptionsBody = exceptions.body as ItemsResponseBody;

    expect(exceptionsBody.items).toHaveLength(1);

    const runs = await authedApp(app).get('/api/developer/runtime/runs?limit=1').expect(200);
    const runsBody = runs.body as ItemsResponseBody;

    expect(runsBody.items).toHaveLength(1);
  });

  it('blocks developer diagnostics when explicitly disabled', async () => {
    process.env.ENABLE_DEVELOPER_DIAGNOSTICS = 'false';
    const createApp = await importCreateApp();
    const app = createApp();

    const response = await authedApp(app).get('/api/developer/runtime').expect(403);
    const body = response.body as ErrorResponseBody;

    expect(body.message).toContain('Developer diagnostics are disabled');
  });

  it('returns 404 for missing reconciliation resources', async () => {
    const createApp = await importCreateApp();
    const app = createApp();

    await authedApp(app).get('/api/reconciliation/missing-id/summary').expect(404);
    await authedApp(app).get('/api/reconciliation/missing-id/exceptions').expect(404);
    await authedApp(app).get('/api/reconciliation/missing-id/export/workbook').expect(404);
  });
});
