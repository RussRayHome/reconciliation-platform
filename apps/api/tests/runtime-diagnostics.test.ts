import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RuntimeDiagnosticsModule from '../src/services/runtimeDiagnostics';

/**
 * runtimeDiagnostics keeps its ring buffers in module-level state, so each test re-imports a
 * fresh instance via vi.resetModules() (same pattern as telemetry.test.ts) instead of sharing
 * state across `it` blocks.
 */
const loadModule = async (): Promise<typeof RuntimeDiagnosticsModule> => {
  vi.resetModules();
  return import('../src/services/runtimeDiagnostics');
};

describe('runtimeDiagnostics', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('reports a null lastReconciliationRun and zero recent counts before anything is recorded', async () => {
    const module = await loadModule();
    const summary = module.getRuntimeSummary();

    expect(summary.apiStatus).toBe('reachable');
    expect(summary.lastReconciliationRun).toBeNull();
    expect(summary.failedRequestsLastWindow).toBe(0);
    expect(summary.exceptionsLastWindow).toBe(0);
    expect(summary.lastRequestAt).toBeNull();
  });

  it('tracks the most recent request timestamp after noteRequestSeen', async () => {
    const module = await loadModule();
    expect(module.getRuntimeSummary().lastRequestAt).toBeNull();

    module.noteRequestSeen();

    expect(module.getRuntimeSummary().lastRequestAt).not.toBeNull();
  });

  it('uses an explicit markServerStarted timestamp to compute uptime', async () => {
    const module = await loadModule();
    const startedAt = new Date(Date.now() - 5000).toISOString();

    module.markServerStarted(startedAt);
    const summary = module.getRuntimeSummary();

    expect(summary.startedAt).toBe(startedAt);
    expect(summary.uptimeMs).toBeGreaterThanOrEqual(5000);
  });

  it('counts only failed requests and exceptions within the recent window', async () => {
    const module = await loadModule();
    const now = Date.now();
    const recent = new Date(now).toISOString();
    const stale = new Date(now - 11 * 60 * 1000).toISOString();

    module.recordFailedRequest({
      timestamp: recent,
      method: 'GET',
      path: '/api/reconciliation/latest',
      statusCode: 500,
      durationMs: 12,
      correlationId: 'corr-recent',
    });
    module.recordFailedRequest({
      timestamp: stale,
      method: 'GET',
      path: '/api/reconciliation/latest',
      statusCode: 500,
      durationMs: 12,
      correlationId: 'corr-stale',
    });
    module.recordException({
      timestamp: recent,
      method: 'POST',
      path: '/api/reconciliation/run',
      statusCode: 500,
      correlationId: 'corr-exc-recent',
      errorName: 'Error',
      message: 'boom',
    });
    module.recordException({
      timestamp: stale,
      method: 'POST',
      path: '/api/reconciliation/run',
      statusCode: 500,
      correlationId: 'corr-exc-stale',
      errorName: 'Error',
      message: 'boom',
    });

    const summary = module.getRuntimeSummary();
    expect(summary.failedRequestsLastWindow).toBe(1);
    expect(summary.exceptionsLastWindow).toBe(1);
  });

  it('treats an unparseable timestamp as outside the recent window', async () => {
    const module = await loadModule();

    module.recordFailedRequest({
      timestamp: 'not-a-timestamp',
      method: 'GET',
      path: '/api/reconciliation/latest',
      statusCode: 500,
      durationMs: 1,
      correlationId: 'corr-invalid',
    });

    expect(module.getRuntimeSummary().failedRequestsLastWindow).toBe(0);
  });

  it('caps stack previews at four trimmed, non-empty lines', async () => {
    const module = await loadModule();

    module.recordException({
      timestamp: new Date().toISOString(),
      method: 'GET',
      path: '/api/reconciliation/latest',
      statusCode: 500,
      correlationId: 'corr-stack',
      errorName: 'Error',
      message: 'boom',
      stack: '  line one  \n\n  line two  \nline three\nline four\nline five',
    });

    const [exception] = module.listExceptions();
    expect(exception!.stackPreview).toEqual(['line one', 'line two', 'line three', 'line four']);
  });

  it('omits the stack preview when no stack is provided', async () => {
    const module = await loadModule();

    module.recordException({
      timestamp: new Date().toISOString(),
      method: 'GET',
      path: '/api/reconciliation/latest',
      statusCode: 500,
      correlationId: 'corr-no-stack',
      errorName: 'Error',
      message: 'boom',
    });

    const [exception] = module.listExceptions();
    expect(exception!.stackPreview).toBeUndefined();
  });

  it('omits the stack preview when the stack has no non-blank lines', async () => {
    const module = await loadModule();

    module.recordException({
      timestamp: new Date().toISOString(),
      method: 'GET',
      path: '/api/reconciliation/latest',
      statusCode: 500,
      correlationId: 'corr-blank-stack',
      errorName: 'Error',
      message: 'boom',
      stack: '   \n   \n',
    });

    const [exception] = module.listExceptions();
    expect(exception!.stackPreview).toBeUndefined();
  });

  it('drops the oldest entry once the failed-request ring buffer exceeds its bound', async () => {
    const module = await loadModule();

    for (let index = 0; index < 205; index += 1) {
      module.recordFailedRequest({
        timestamp: new Date().toISOString(),
        method: 'GET',
        path: '/api/reconciliation/latest',
        statusCode: 500,
        durationMs: index,
        correlationId: `corr-${index}`,
      });
    }

    const failedRequests = module.listFailedRequests(100);
    expect(failedRequests).toHaveLength(100);
    expect(failedRequests[0]!.correlationId).toBe('corr-204');
  });

  it('reports the most recently recorded reconciliation run first', async () => {
    const module = await loadModule();

    module.recordReconciliationRun({
      timestamp: new Date(Date.now() - 1000).toISOString(),
      status: 'Succeeded',
      correlationId: 'corr-run-1',
      durationMs: 100,
    });
    module.recordReconciliationRun({
      timestamp: new Date().toISOString(),
      status: 'Failed',
      correlationId: 'corr-run-2',
      durationMs: 50,
      failureReason: 'Parse error',
    });

    const summary = module.getRuntimeSummary();
    expect(summary.lastReconciliationRun?.correlationId).toBe('corr-run-2');
  });

  it('clamps list limits into their allowed ranges', async () => {
    const module = await loadModule();

    for (let index = 0; index < 5; index += 1) {
      module.recordFailedRequest({
        timestamp: new Date().toISOString(),
        method: 'GET',
        path: '/api/reconciliation/latest',
        statusCode: 500,
        durationMs: index,
        correlationId: `corr-${index}`,
      });
    }

    expect(module.listFailedRequests(0)).toHaveLength(1);
    expect(module.listFailedRequests(1000)).toHaveLength(5);
    expect(module.listFailedRequests()).toHaveLength(5);
  });
});
