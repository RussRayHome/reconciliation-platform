import type { createReconciliationProducer } from '../src/services/reconciliationQueue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleBankWorkbook, createSampleGlWorkbook } from '@recon/test-fixtures';

import { InMemoryRunRepository } from '../src/services/runRepository';
import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

const queueState = vi.hoisted(() => ({
  enabled: true,
  enqueue: vi.fn(),
  getStatus: vi.fn(),
  close: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../src/services/reconciliationQueue', async () => {
  type ReconciliationQueueModule = {
    createReconciliationProducer: typeof createReconciliationProducer;
  };

  const actual = await vi.importActual<ReconciliationQueueModule>(
    '../src/services/reconciliationQueue',
  );

  return {
    ...actual,
    createReconciliationProducer: vi.fn(() => ({
      enabled: queueState.enabled,
      enqueue: queueState.enqueue,
      getStatus: queueState.getStatus,
      close: queueState.close,
    })),
  };
});

describe('reconciliation queue API', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    queueState.enabled = true;
    queueState.enqueue.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
    queueState.getStatus.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns 202 with job metadata when queue mode accepts a run', async () => {
    const app = createApp();
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const response = await authedApp(app)
      .post('/api/reconciliation/run')
      .field('accountIdentifier', 'OPERATING-001')
      .field('reconciliationFrequency', 'Monthly')
      .field('periodLabel', 'Queue Test')
      .attach('bankFile', bankBuffer, {
        filename: 'bank.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .attach('glFile', glBuffer, {
        filename: 'gl.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(202);

    expect(response.body).toEqual({ jobId: 'job-1', status: 'queued' });
    expect(queueState.enqueue).toHaveBeenCalledTimes(1);

    const [payload] = queueState.enqueue.mock.calls[0] as [
      {
        requestId: string;
        body: Record<string, unknown>;
        files: {
          bankFile: { originalname: string; buffer: string };
          glFile: { originalname: string; buffer: string };
        };
      },
    ];

    expect(payload.requestId).toBeTypeOf('string');
    expect(payload.body).toMatchObject({
      accountIdentifier: 'OPERATING-001',
      reconciliationFrequency: 'Monthly',
      periodLabel: 'Queue Test',
    });
    expect(payload.files.bankFile.originalname).toBe('bank.xlsx');
    expect(payload.files.glFile.originalname).toBe('gl.xlsx');
    expect(payload.files.bankFile.buffer.length).toBeGreaterThan(0);
    expect(payload.files.glFile.buffer.length).toBeGreaterThan(0);
  });

  it('returns 404 for job status when queue mode is disabled', async () => {
    queueState.enabled = false;
    const app = createApp();

    const response = await authedApp(app).get('/api/reconciliation/jobs/job-1').expect(404);
    expect((response.body as { message: string }).message).toContain('disabled');
  });

  it('returns queued and processing queue states', async () => {
    const app = createApp();

    queueState.getStatus.mockResolvedValueOnce({ status: 'queued' });
    const queuedResponse = await authedApp(app)
      .get('/api/reconciliation/jobs/job-queued')
      .expect(200);
    expect(queuedResponse.body).toMatchObject({ status: 'queued' });

    queueState.getStatus.mockResolvedValueOnce({ status: 'processing' });
    const processingResponse = await authedApp(app)
      .get('/api/reconciliation/jobs/job-processing')
      .expect(200);
    expect(processingResponse.body).toMatchObject({ status: 'processing' });
  });

  it('returns failed queue status with reason details', async () => {
    const app = createApp();
    queueState.getStatus.mockResolvedValue({
      status: 'failed',
      failedAt: '2026-06-27T00:00:00.000Z',
      reason: 'Queue worker failed',
    });

    const response = await authedApp(app).get('/api/reconciliation/jobs/job-failed').expect(200);

    expect(response.body).toMatchObject({
      status: 'failed',
      failedAt: '2026-06-27T00:00:00.000Z',
      reason: 'Queue worker failed',
    });
  });

  it('hydrates completed queue status with run details when only runId is present', async () => {
    const repository = new InMemoryRunRepository();

    queueState.enabled = false;
    const syncApp = createApp(repository);
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);

    const syncRunResponse = await authedApp(syncApp)
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

    const seededRunId = (syncRunResponse.body as { id: string }).id;

    queueState.enabled = true;
    queueState.getStatus.mockResolvedValue({
      status: 'completed',
      runId: seededRunId,
    });

    const queuedApp = createApp(repository);
    const queuedResponse = await authedApp(queuedApp)
      .get('/api/reconciliation/jobs/job-done')
      .expect(200);

    const payload = queuedResponse.body as {
      status: string;
      runId: string;
      run?: { id: string };
    };

    expect(payload.status).toBe('completed');
    expect(payload.runId).toBe(seededRunId);
    expect(payload.run?.id).toBe(seededRunId);
  });

  it('returns 404 when queue status is unknown', async () => {
    const app = createApp();
    queueState.getStatus.mockResolvedValue(undefined);

    const response = await authedApp(app).get('/api/reconciliation/jobs/missing-job').expect(404);
    expect((response.body as { message: string }).message).toContain('not found');
  });
});
