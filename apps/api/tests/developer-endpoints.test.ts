/** Integration tests for developer-facing API endpoints and diagnostics. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleBankWorkbook, createSampleQboWorkbook } from '@recon/test-fixtures';

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
  };
  checks: Array<{
    name: string;
    testType?: string;
    passedCount?: number;
    failedCount?: number;
    areaLabel?: string;
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
};

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
    matches: (joined) => joined.includes('npm') && joined.includes('run test:unit'),
    result: {
      stdout: 'Test Files  9 passed (9)\nTests  114 passed (114)\n',
      stderr: '',
    },
  },
  {
    matches: (joined) => joined.includes('npm') && joined.includes('run test:integration'),
    result: {
      stdout: 'Test Files  1 passed (1)\nTests  5 passed (5)\n',
      stderr: '',
    },
  },
  {
    matches: (joined) => joined.includes('npm') && joined.includes('run test:e2e'),
    result: {
      stdout: 'Running 1 test using 1 worker\n\n  1 passed (7.0s)\n',
      stderr: '',
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
  (command: string, args: string[], _options: unknown, callback: ExecFileCallback) => {
    const joined = [command, ...args].join(' ');

    const matched = execFileMatchers.find((matcher) => matcher.matches(joined));

    if (matched) {
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

  beforeEach(() => {
    vi.resetModules();
    mockExecFile.mockClear();
    process.env = { ...originalEnv };
    process.env.ENABLE_DEVELOPER_DIAGNOSTICS = 'true';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
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

    const response = await request(app).get('/api/developer/status').expect(200);
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
          passedCount: 114,
          failedCount: 0,
          areaLabel: 'Unit',
        }),
        expect.objectContaining({
          name: 'Integration tests',
          testType: 'integration',
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
  });

  it('returns runtime diagnostics and recent developer activity', async () => {
    const createApp = await importCreateApp();
    const app = createApp();
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);

    await request(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'qbo.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(201);

    await request(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', Buffer.from('not-an-excel-file'), {
        filename: 'bank.txt',
        contentType: 'text/plain',
      })
      .attach('qboFile', qboBuffer, {
        filename: 'qbo.xlsx',
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
