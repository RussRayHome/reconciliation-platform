import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';

/**
 * Fakes 'bullmq' the same way import-validation-queue-service.test.ts/reconciliation-queue-
 * service.test.ts do (Queue/Worker as no-op stand-ins for the producer/consumer this test doesn't
 * exercise), plus a real EventEmitter-backed QueueEvents so `queueEvents.on('progress', ...)`/
 * `.off(...)` behave exactly like BullMQ's own (itself an EventEmitter subclass) -- this lets a
 * test simulate a worker publishing a live checkpoint by calling `.emit('progress', {...})`
 * directly on the captured instance, with no real Redis involved.
 */
const bullmqState = vi.hoisted(() => ({
  queueEventsInstances: [] as Array<{ queueName: string; emitter: EventEmitter }>,
}));

vi.mock('bullmq', async () => {
  const { EventEmitter: NodeEventEmitter } = await import('node:events');

  class Queue {
    add = vi.fn();
    getJob = vi.fn();
    close = vi.fn(() => Promise.resolve(undefined));
  }

  class Worker {
    run = vi.fn(() => Promise.resolve(undefined));
    close = vi.fn(() => Promise.resolve(undefined));
    on = vi.fn();
  }

  class QueueEvents extends NodeEventEmitter {
    constructor(queueName: string) {
      super();
      bullmqState.queueEventsInstances.push({ queueName, emitter: this });
    }
    close = vi.fn(() => Promise.resolve(undefined));
  }

  return { Queue, Worker, QueueEvents };
});

import { createApp } from '../src/app';
import { PostgresReconciliationLifecycleStore } from '@recon/persistence';
import { authHeader } from './testHelpers/authToken';

interface RunRow {
  id: string;
  organization_id: string;
  matching_job_id: string | null;
}

interface AuditEventRow {
  job_id: string;
  organization_id: string;
  event_type: string;
  details_json: Record<string, unknown>;
  created_at: string;
}

/**
 * Minimal fake backing exactly what this route's two reads need: PostgresImportRunStore's
 * getRunSummary (the LEFT JOIN reconciliation_job shape already established by
 * imports-endpoints.test.ts's own fake) and PostgresReconciliationLifecycleStore's
 * getLatestAuditEvent.
 *
 * getRunSummary's real query (importRunStore.ts) filters only `WHERE r.id = $1` -- it relies
 * entirely on RLS (the session's app.current_organization_id) to scope by tenant, unlike
 * getLatestRunSummary's own explicit organization_id predicate. Since this file's cross-tenant
 * 404 test specifically depends on that enforcement, this fake simulates it: each connect()
 * tracks the organizationId most recently set via set_config on that client, matching how
 * runInTenantScope always SET LOCALs it before the real query runs on the same client.
 */
const createFakeEventsPool = (runs: RunRow[], auditEvents: AuditEventRow[] = []) => {
  const queryForOrg = (
    text: string,
    params: unknown[],
    sessionOrganizationId: string | undefined,
  ): Promise<{ rows: unknown[]; rowCount: number }> => {
    if (text.includes('LEFT JOIN reconciliation_job')) {
      const [id] = params as [string];
      const run = runs.find(
        (candidate) => candidate.id === id && candidate.organization_id === sessionOrganizationId,
      );
      return Promise.resolve({
        rows: run
          ? [
              {
                id: run.id,
                organization_id: run.organization_id,
                label: 'Test Run',
                account_identifier: null,
                frequency: 'MONTHLY',
                period_year: 2026,
                period_month: 8,
                status: 'RECONCILING',
                created_at: '2026-08-01T00:00:00.000Z',
                matching_job_id: run.matching_job_id,
                job_current_state: run.matching_job_id ? 'MATCHING' : null,
                job_failure_code: null,
                job_failure_message: null,
                job_completed_at: null,
              },
            ]
          : [],
        rowCount: run ? 1 : 0,
      });
    }

    if (text.includes('FROM import_job')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes('FROM run_source_file rsf') && text.includes('JOIN import_file')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    if (text.includes('FROM reconciliation_audit_event')) {
      const [jobId, organizationId] = params as [string, string];
      const matches = auditEvents
        .filter((row) => row.job_id === jobId && row.organization_id === organizationId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const latest = matches[0];
      return Promise.resolve({
        rows: latest
          ? [
              {
                event_type: latest.event_type,
                details_json: latest.details_json,
                created_at: latest.created_at,
              },
            ]
          : [],
        rowCount: latest ? 1 : 0,
      });
    }

    if (text === 'SELECT 1') {
      // error-handling-build-plan.md EH7: requireDatabase now probes liveness on every guarded
      // request via checkDatabaseReachable(pool) -- this fake pool must answer it too.
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    throw new Error(`createFakeEventsPool: unexpected query: ${text}`);
  };

  return {
    query: (text: string, params: unknown[] = []) => queryForOrg(text, params, undefined),
    connect: () => {
      let sessionOrganizationId: string | undefined;
      const clientQuery = (text: string, params: unknown[] = []) => {
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (text.includes('set_config(')) {
          sessionOrganizationId = params[0] as string;
          return Promise.resolve({ rows: [{ set_config: sessionOrganizationId }], rowCount: 1 });
        }
        return queryForOrg(text, params, sessionOrganizationId);
      };
      return Promise.resolve({ query: clientQuery, release: () => undefined });
    },
  } as unknown as Pool;
};

/** error-handling-build-plan.md EH5: a pool whose `getRunSummary` query rejects outright, the way
 * a real driver does when the database is unreachable (ECONNREFUSED) rather than genuinely
 * returning zero rows -- these are different facts (EH-E) and must not both surface as 404. */
const createUnreachableEventsPool = (): Pool => {
  const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
    code: 'ECONNREFUSED',
  });
  return {
    query: () => Promise.reject(error),
    connect: () =>
      Promise.resolve({
        query: (text: string) => {
          if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
            return Promise.resolve({ rows: [], rowCount: 0 });
          }
          return Promise.reject(error);
        },
        release: () => undefined,
      }),
  } as unknown as Pool;
};

/** A pool that resolves `getRunSummary` normally but rejects the catch-up audit-event read -- EH5
 * step 3: this one degrades gracefully (skip catch-up, still connect) rather than failing the
 * whole request, unlike `getRunSummary`'s own failure above. */
const createEventsPoolWithFailingCatchUp = (run: RunRow): Pool => {
  const auditEventError = new Error('connection terminated unexpectedly');

  return {
    query: () => Promise.reject(new Error('createEventsPoolWithFailingCatchUp: unexpected query')),
    connect: () => {
      let sessionOrganizationId: string | undefined;
      const clientQuery = (text: string, params: unknown[] = []) => {
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (text.includes('set_config(')) {
          sessionOrganizationId = params[0] as string;
          return Promise.resolve({ rows: [{ set_config: sessionOrganizationId }], rowCount: 1 });
        }
        if (text.includes('FROM reconciliation_audit_event')) {
          return Promise.reject(auditEventError);
        }
        if (text.includes('FROM import_job')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (text.includes('FROM run_source_file rsf') && text.includes('JOIN import_file')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (text.includes('LEFT JOIN reconciliation_job')) {
          const [id] = params as [string];
          return sessionOrganizationId === run.organization_id && id === run.id
            ? Promise.resolve({
                rows: [
                  {
                    id: run.id,
                    organization_id: run.organization_id,
                    label: 'Test Run',
                    account_identifier: null,
                    frequency: 'MONTHLY',
                    period_year: 2026,
                    period_month: 8,
                    status: 'RECONCILING',
                    created_at: '2026-08-01T00:00:00.000Z',
                    matching_job_id: run.matching_job_id,
                    job_current_state: run.matching_job_id ? 'MATCHING' : null,
                    job_failure_code: null,
                    job_failure_message: null,
                    job_completed_at: null,
                  },
                ],
                rowCount: 1,
              })
            : Promise.resolve({ rows: [], rowCount: 0 });
        }
        throw new Error(`createEventsPoolWithFailingCatchUp: unexpected query: ${text}`);
      };
      return Promise.resolve({ query: clientQuery, release: () => undefined });
    },
  } as unknown as Pool;
};

let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
let baseUrl: string;

const startApp = async (pool: Pool): Promise<void> => {
  // resolveImportValidationQueueConfiguration() (app.ts) reads these at createApp() call time --
  // set before calling it so createImportValidationQueueEvents constructs a (fake) QueueEvents
  // instead of returning its disabled no-op stub.
  process.env.ENABLE_IMPORT_VALIDATION_QUEUE = 'true';
  process.env.IMPORT_VALIDATION_QUEUE_REDIS_URL = 'rediss://user:pass@localhost:6380/3';

  const lifecycleStore = new PostgresReconciliationLifecycleStore(pool);
  const app = createApp(undefined, lifecycleStore, undefined, pool, undefined);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server!.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
};

/** Reads NDJSON lines from a streaming fetch response until `count` lines have arrived or
 * `timeoutMs` elapses (whichever first) -- a connection that never sends anything is exactly what
 * the cross-tenant/cross-run isolation tests need to prove, so timing out with fewer than `count`
 * lines is a valid, asserted-on outcome, not a test failure by itself. */
const readLines = async (
  response: Response,
  count: number,
  timeoutMs = 500,
): Promise<string[]> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const lines: string[] = [];
  const deadline = Date.now() + timeoutMs;

  try {
    while (lines.length < count && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), remaining),
        ),
      ]);
      if (result.done) break;
      buffer += decoder.decode(result.value as Uint8Array, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        lines.push(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return lines;
};

beforeEach(() => {
  bullmqState.queueEventsInstances.length = 0;
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe('GET /api/imports/runs/:id/events (Issue #154 live status push)', () => {
  it('returns 404 with RCN-SUB-001 for a run that does not belong to the caller organization (error-handling-build-plan.md EH5)', async () => {
    const pool = createFakeEventsPool([{ id: 'run-1', organization_id: 'org-a', matching_job_id: null }]);
    await startApp(pool);

    const response = await fetch(`${baseUrl}/api/imports/runs/run-1/events`, {
      headers: { ...authHeader({ organizationId: 'org-b' }) },
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string; reference: string };
    expect(body.code).toBe('RCN-SUB-001');
    expect(body.reference.length).toBeGreaterThan(0);
  });

  it('returns a database code, not 404, when the database is unreachable (error-handling-build-plan.md EH5, closes EH-E)', async () => {
    const pool = createUnreachableEventsPool();
    await startApp(pool);

    const response = await fetch(`${baseUrl}/api/imports/runs/run-1/events`, {
      headers: { ...authHeader({ organizationId: 'org-a' }) },
    });

    expect(response.status).not.toBe(404);
    const body = (await response.json()) as { code: string; reference: string };
    expect(body.code).toBe('RCN-DB-002');
    expect(body.reference.length).toBeGreaterThan(0);
  });

  it('still connects and delivers live messages when the catch-up audit-event read fails (error-handling-build-plan.md EH5, step 3: graceful fallback stays, but observable now)', async () => {
    const pool = createEventsPoolWithFailingCatchUp({
      id: 'run-1',
      organization_id: 'org-a',
      matching_job_id: 'job-1',
    });
    await startApp(pool);

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/imports/runs/run-1/events`, {
      headers: { ...authHeader({ organizationId: 'org-a' }) },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    const importValidationEvents = bullmqState.queueEventsInstances.find(
      (instance) => instance.queueName === 'import-validation-runs',
    )!;
    importValidationEvents.emitter.emit('progress', {
      jobId: 'bullmq-job-4',
      data: {
        organizationId: 'org-a',
        processId: 'run-1',
        queueType: 'import-validation',
        statusMessage: 'still live after catch-up failed',
      },
    });

    // Reading exactly one line and getting the live message (not a catch-up line) proves both
    // halves at once: the failed catch-up read wrote nothing to the wire, and the live
    // subscription still started normally afterward.
    const [line] = await readLines(response, 1);
    expect(JSON.parse(line!)).toMatchObject({ statusMessage: 'still live after catch-up failed' });

    controller.abort();
  });

  it('delivers a live progress message published for this run', async () => {
    const pool = createFakeEventsPool([{ id: 'run-1', organization_id: 'org-a', matching_job_id: null }]);
    await startApp(pool);

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/imports/runs/run-1/events`, {
      headers: { ...authHeader({ organizationId: 'org-a' }) },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');

    const importValidationEvents = bullmqState.queueEventsInstances.find(
      (instance) => instance.queueName === 'import-validation-runs',
    )!;
    expect(importValidationEvents).toBeDefined();

    importValidationEvents.emitter.emit('progress', {
      jobId: 'bullmq-job-1',
      data: {
        organizationId: 'org-a',
        processId: 'run-1',
        queueType: 'import-validation',
        statusMessage: 'Validating uploaded files…',
      },
    });

    const [line] = await readLines(response, 1);
    expect(JSON.parse(line!)).toEqual({
      organizationId: 'org-a',
      processId: 'run-1',
      queueType: 'import-validation',
      statusMessage: 'Validating uploaded files…',
    });

    controller.abort();
  });

  it('Issue #154 adversarial: never delivers a message published for a different run in the same organization', async () => {
    const pool = createFakeEventsPool([
      { id: 'run-1', organization_id: 'org-a', matching_job_id: null },
      { id: 'run-2', organization_id: 'org-a', matching_job_id: null },
    ]);
    await startApp(pool);

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/imports/runs/run-1/events`, {
      headers: { ...authHeader({ organizationId: 'org-a' }) },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    const importValidationEvents = bullmqState.queueEventsInstances.find(
      (instance) => instance.queueName === 'import-validation-runs',
    )!;

    importValidationEvents.emitter.emit('progress', {
      jobId: 'bullmq-job-2',
      data: {
        organizationId: 'org-a',
        processId: 'run-2',
        queueType: 'import-validation',
        statusMessage: 'Message for the other run',
      },
    });

    const lines = await readLines(response, 1, 300);
    expect(lines).toHaveLength(0);

    controller.abort();
  });

  it('Issue #154 adversarial: never delivers a message published for a different organization on the same run id shape', async () => {
    const pool = createFakeEventsPool([{ id: 'run-1', organization_id: 'org-a', matching_job_id: null }]);
    await startApp(pool);

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/imports/runs/run-1/events`, {
      headers: { ...authHeader({ organizationId: 'org-a' }) },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    const importValidationEvents = bullmqState.queueEventsInstances.find(
      (instance) => instance.queueName === 'import-validation-runs',
    )!;

    // Same processId, wrong organizationId -- the naive bug this guards against is filtering on
    // processId alone.
    importValidationEvents.emitter.emit('progress', {
      jobId: 'bullmq-job-3',
      data: {
        organizationId: 'org-b',
        processId: 'run-1',
        queueType: 'import-validation',
        statusMessage: 'Message for the other organization',
      },
    });

    const lines = await readLines(response, 1, 300);
    expect(lines).toHaveLength(0);

    controller.abort();
  });

  it('sends the most recent durable audit event as a catch-up line before any live message', async () => {
    const pool = createFakeEventsPool(
      [{ id: 'run-1', organization_id: 'org-a', matching_job_id: 'job-1' }],
      [
        {
          job_id: 'job-1',
          organization_id: 'org-a',
          event_type: 'reconciliation.match.completed',
          details_json: { matchResultCount: 3 },
          created_at: '2026-08-01T00:00:01.000Z',
        },
      ],
    );
    await startApp(pool);

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/imports/runs/run-1/events`, {
      headers: { ...authHeader({ organizationId: 'org-a' }) },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    const [line] = await readLines(response, 1);
    expect(JSON.parse(line!)).toEqual({
      organizationId: 'org-a',
      processId: 'run-1',
      queueType: 'import-validation',
      statusMessage: 'reconciliation.match.completed',
      details: { matchResultCount: 3 },
    });

    controller.abort();
  });

  it('connects cleanly with zero catch-up lines when the run has no matching job yet', async () => {
    const pool = createFakeEventsPool([{ id: 'run-1', organization_id: 'org-a', matching_job_id: null }]);
    await startApp(pool);

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/imports/runs/run-1/events`, {
      headers: { ...authHeader({ organizationId: 'org-a' }) },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    const lines = await readLines(response, 1, 300);
    expect(lines).toHaveLength(0);

    controller.abort();
  });

  it('deregisters its progress listener when the client disconnects', async () => {
    const pool = createFakeEventsPool([{ id: 'run-1', organization_id: 'org-a', matching_job_id: null }]);
    await startApp(pool);

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/imports/runs/run-1/events`, {
      headers: { ...authHeader({ organizationId: 'org-a' }) },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    await response.body!.cancel();

    const importValidationEvents = bullmqState.queueEventsInstances.find(
      (instance) => instance.queueName === 'import-validation-runs',
    )!;

    // The server-side 'close' handler fires asynchronously after the client aborts -- poll
    // briefly rather than asserting immediately.
    const deadline = Date.now() + 1000;
    while (
      importValidationEvents.emitter.listenerCount('progress') > 0 &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(importValidationEvents.emitter.listenerCount('progress')).toBe(0);
  });
});
