import {
  createSampleBankWorkbook,
  createSampleQboWorkbook,
} from '@recon/test-fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const mockExecFile = vi.fn(
  (
    command: string,
    args: string[],
    _options: unknown,
    callback: ExecFileCallback,
  ) => {
    const joined = [command, ...args].join(' ');

    if (joined.includes('git branch --show-current')) {
      callback(null, { stdout: 'feature/developer-dashboard-docs\n', stderr: '' });
      return;
    }

    if (joined.includes('git rev-parse --short HEAD')) {
      callback(null, { stdout: 'abc1234\n', stderr: '' });
      return;
    }

    if (joined.includes('git log -1 --pretty=%s')) {
      callback(null, { stdout: 'Latest commit\n', stderr: '' });
      return;
    }

    if (joined.includes('git status --porcelain')) {
      callback(null, { stdout: '', stderr: '' });
      return;
    }

    if (joined.includes('npm') && joined.includes('run test:unit')) {
      callback(null, {
        stdout: 'Test Files  9 passed (9)\nTests  114 passed (114)\n',
        stderr: '',
      });
      return;
    }

    if (joined.includes('npm') && joined.includes('run test:integration')) {
      callback(null, {
        stdout: 'Test Files  1 passed (1)\nTests  5 passed (5)\n',
        stderr: '',
      });
      return;
    }

    if (joined.includes('npm') && joined.includes('run test:e2e')) {
      callback(null, {
        stdout: 'Running 1 test using 1 worker\n\n  1 passed (7.0s)\n',
        stderr: '',
      });
      return;
    }

    if (joined.includes('npm') && joined.includes('run lint')) {
      callback(null, { stdout: '', stderr: '' });
      return;
    }

    if (joined.includes('npm') && joined.includes('run typecheck')) {
      callback(null, { stdout: '', stderr: '' });
      return;
    }

    if (joined.includes('npm') && joined.includes('run coverage')) {
      callback(null, {
        stdout: [
          'All files          |   81.2 |    80.0 |   82.1 |   81.2',
        ].join('\n'),
        stderr: '',
      });
      return;
    }

    if (joined.includes('npm') && joined.includes('audit --json')) {
      callback(null, {
        stdout: JSON.stringify({
          metadata: {
            vulnerabilities: {
              info: 0,
              low: 0,
              moderate: 0,
              high: 0,
              critical: 0,
              total: 0,
            },
          },
        }),
        stderr: '',
      });
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
          name: 'Static analysis (lint)',
          areaLabel: 'Smells',
        }),
      ]),
    );
    expect(body.history[0]).toMatchObject({
      testTotals: {
        passed: 120,
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
    expect(runtimeBody.recentReconciliationRuns.length).toBeGreaterThanOrEqual(1);
    expect(runtimeBody.recentFailedRequests.length).toBeGreaterThanOrEqual(1);
    expect(runtimeBody.recentExceptions.length).toBeGreaterThanOrEqual(1);

    const requests = await request(app).get('/api/developer/runtime/requests?limit=1').expect(200);
    const requestsBody = requests.body as ItemsResponseBody;

    expect(requestsBody.items).toHaveLength(1);

    const exceptions = await request(app).get('/api/developer/runtime/exceptions?limit=1').expect(200);
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