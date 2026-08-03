/** Integration tests for developer-facing API endpoints and diagnostics. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleBankWorkbook, createSampleGlWorkbook } from '@recon/test-fixtures';

import request from 'supertest';

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
};

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
    sideEffect: (args) =>
      writeFixtureFromInlineArg(
        args,
        '--outputFile.json=',
        vitestJsonFixture('a skipped unit test', 'passed', 'apps/web/src/App.test.tsx'),
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
      matched.sideEffect?.(args, options);
      callback(null, matched.result);
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
  });

  it('returns health status', async () => {
    const createApp = await importCreateApp();
    const app = createApp();

    const response = await request(app).get('/api/health').expect(200);
    const body = response.body as HealthResponseBody;

    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTypeOf('string');
  });

  it('returns Prometheus metrics payload', async () => {
    const createApp = await importCreateApp();
    const app = createApp();

    await request(app).get('/api/health').expect(200);

    const response = await request(app).get('/api/metrics').expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('recon_api_http_requests_total');
    expect(response.text).toContain('recon_api_http_request_duration_seconds');
  });

  it('returns 404 for metrics endpoint when metrics are disabled', async () => {
    process.env.ENABLE_API_METRICS = 'false';

    const createApp = await importCreateApp();
    const app = createApp();

    const response = await request(app).get('/api/metrics').expect(404);

    expect(response.text).toContain('API metrics are disabled');
  });

  it('applies rate limiting to API routes while exempting health and metrics endpoints', async () => {
    process.env.DISABLE_API_RATE_LIMIT = 'false';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '1';
    process.env.RATE_LIMIT_USE_REDIS = 'false';

    const createApp = await importCreateApp();
    const app = createApp();

    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/health').expect(200);

    await request(app).get('/api/metrics').expect(200);
    await request(app).get('/api/metrics').expect(200);

    await request(app).get('/api/reconciliation/latest').expect(404);
    const throttledResponse = await request(app).get('/api/reconciliation/latest').expect(429);

    const throttledBody = throttledResponse.body as ErrorResponseBody;
    expect(throttledBody.message).toContain('Too many requests');
  });

  it('returns developer status with test totals and cache metadata', async () => {
    const createApp = await importCreateApp();
    const app = createApp();

    const response = await request(app).get('/api/developer/status?force=1').expect(200);
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
    expect(unitCheck?.testItems).toEqual([]);

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

    const response = await request(app).get('/api/developer/status').expect(200);
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

    const response = await request(app).get('/api/developer/status').expect(200);
    const body = response.body as DeveloperStatusResponseBody;

    expect(body.cache.fromCache).toBe(true);
    expect(body.cache.refreshInProgress).toBe(false);
    expect(body.checks).toHaveLength(1);
    expect(body.checks[0]?.name).toBe('Unit tests');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns runtime diagnostics and recent developer activity', async () => {
    const createApp = await importCreateApp();
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    await request(app)
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

    await request(app)
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

    const runtime = await request(app).get('/api/developer/runtime').expect(200);
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

    const requests = await request(app).get('/api/developer/runtime/requests?limit=1').expect(200);
    const requestsBody = requests.body as ItemsResponseBody;

    expect(requestsBody.items).toHaveLength(1);

    const exceptions = await request(app)
      .get('/api/developer/runtime/exceptions?limit=1')
      .expect(200);
    const exceptionsBody = exceptions.body as ItemsResponseBody;

    expect(exceptionsBody.items).toHaveLength(1);

    const runs = await request(app).get('/api/developer/runtime/runs?limit=1').expect(200);
    const runsBody = runs.body as ItemsResponseBody;

    expect(runsBody.items).toHaveLength(1);
  });

  it('blocks developer diagnostics when explicitly disabled', async () => {
    process.env.ENABLE_DEVELOPER_DIAGNOSTICS = 'false';
    const createApp = await importCreateApp();
    const app = createApp();

    const response = await request(app).get('/api/developer/runtime').expect(403);
    const body = response.body as ErrorResponseBody;

    expect(body.message).toContain('Developer diagnostics are disabled');
  });

  it('returns 404 for missing reconciliation resources', async () => {
    const createApp = await importCreateApp();
    const app = createApp();

    await request(app).get('/api/reconciliation/missing-id/summary').expect(404);
    await request(app).get('/api/reconciliation/missing-id/exceptions').expect(404);
    await request(app).get('/api/reconciliation/missing-id/export/workbook').expect(404);
  });
});
