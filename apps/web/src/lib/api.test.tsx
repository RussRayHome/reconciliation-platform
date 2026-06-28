// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runReconciliationRequest } from './api';

const resolveUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
};

const createResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const createPayload = () => ({
  bankFile: new File(['bank-bytes'], 'bank.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }),
  qboFile: new File(['qbo-bytes'], 'qbo.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }),
  accountIdentifier: 'OPERATING-001',
  reconciliationFrequency: 'Monthly' as const,
  periodLabel: 'Queue Polling Test',
});

describe('reconciliation API client queue polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls queue status until a completed payload with run data is available', async () => {
    const runPayload = { id: 'run-embedded' };
    let statusRequestCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = resolveUrl(input);

      if (url === '/api/reconciliation/run') {
        return Promise.resolve(createResponse({ status: 'queued', jobId: 'job-1' }, 202));
      }

      if (url === '/api/reconciliation/jobs/job-1') {
        statusRequestCount += 1;

        if (statusRequestCount === 1) {
          return Promise.resolve(createResponse({ status: 'queued' }));
        }

        if (statusRequestCount === 2) {
          return Promise.resolve(createResponse({ status: 'processing' }));
        }

        return Promise.resolve(createResponse({ status: 'completed', run: runPayload }));
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const resultPromise = runReconciliationRequest(createPayload());

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const result = (await resultPromise) as { id: string };
    expect(result.id).toBe('run-embedded');
  });

  it('fetches the run by id when queue status completes without embedded run payload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = resolveUrl(input);

      if (url === '/api/reconciliation/run') {
        return Promise.resolve(createResponse({ status: 'queued', jobId: 'job-2' }, 202));
      }

      if (url === '/api/reconciliation/jobs/job-2') {
        return Promise.resolve(createResponse({ status: 'completed', runId: 'run-42' }));
      }

      if (url === '/api/reconciliation/run-42') {
        return Promise.resolve(createResponse({ id: 'run-42' }));
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = (await runReconciliationRequest(createPayload())) as { id: string };

    expect(result.id).toBe('run-42');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reconciliation/run',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/reconciliation/jobs/job-2');
    expect(fetchMock).toHaveBeenCalledWith('/api/reconciliation/run-42');
  });

  it('throws queue failure reason when queued reconciliation fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = resolveUrl(input);

      if (url === '/api/reconciliation/run') {
        return Promise.resolve(createResponse({ status: 'queued', jobId: 'job-3' }, 202));
      }

      if (url === '/api/reconciliation/jobs/job-3') {
        return Promise.resolve(createResponse({ status: 'failed', reason: 'Worker exploded' }));
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await expect(runReconciliationRequest(createPayload())).rejects.toThrow('Worker exploded');
  });

  it('times out when queued reconciliation does not complete in polling window', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = resolveUrl(input);

      if (url === '/api/reconciliation/run') {
        return Promise.resolve(createResponse({ status: 'queued', jobId: 'job-4' }, 202));
      }

      if (url === '/api/reconciliation/jobs/job-4') {
        return Promise.resolve(createResponse({ status: 'processing' }));
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const rejection = runReconciliationRequest(createPayload()).then(
      () => new Error('Expected timeout rejection'),
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();

    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'Timed out while waiting for queued reconciliation to complete.',
    );
  });
});
