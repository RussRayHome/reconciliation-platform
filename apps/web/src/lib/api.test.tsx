// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  apiFetch,
  createImportRunRequest,
  downloadWorkbookRequest,
  getReconciliationRunByIdRequest,
  identityConfirmRequest,
  logoutRequest,
  runReconciliationRequest,
} from './api';
import { clearAuthToken, setAuthToken } from './authToken';

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
  glFile: new File(['gl-bytes'], 'gl.xlsx', {
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

describe('apiFetch', () => {
  afterEach(() => {
    clearAuthToken();
    vi.restoreAllMocks();
  });

  it('calls fetch with a single argument when there is no token and no init', async () => {
    clearAuthToken();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await apiFetch('/api/rules/catalog');

    expect(fetchMock).toHaveBeenCalledWith('/api/rules/catalog');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toHaveLength(1);
  });

  it('forwards init untouched when there is no token', async () => {
    clearAuthToken();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await apiFetch('/api/rules/catalog', { method: 'POST' });

    expect(fetchMock).toHaveBeenCalledWith('/api/rules/catalog', { method: 'POST' });
  });

  it('attaches a bearer token header when a token is present', async () => {
    setAuthToken('token-123');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await apiFetch('/api/rules/catalog');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-123');
  });
});

describe('parseResponse via request wrappers', () => {
  afterEach(() => {
    clearAuthToken();
    vi.restoreAllMocks();
  });

  it('throws the server-provided message for a non-ok JSON response', async () => {
    clearAuthToken();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Run not found.' }), { status: 404 }),
    );

    await expect(getReconciliationRunByIdRequest('missing-run')).rejects.toThrow(
      'Run not found.',
    );
  });

  it('falls back to a generic message when a non-ok response has no JSON body', async () => {
    clearAuthToken();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 500 }));

    await expect(getReconciliationRunByIdRequest('broken-run')).rejects.toThrow('Request failed.');
  });

  it('rejects with an ApiError carrying code/reference/retryable from the envelope (error-handling-build-plan.md EH4)', async () => {
    clearAuthToken();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'The service could not reach its database. Please try again shortly.',
          code: 'RCN-DB-002',
          reference: 'ref-abc-123',
          retryable: true,
        }),
        { status: 503 },
      ),
    );

    await expect(getReconciliationRunByIdRequest('missing-run')).rejects.toMatchObject({
      name: 'ApiError',
      httpStatus: 503,
      code: 'RCN-DB-002',
      reference: 'ref-abc-123',
      retryable: true,
    });
  });

  it('defaults retryable to false and leaves code/reference undefined when the envelope omits them', async () => {
    clearAuthToken();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Run not found.' }), { status: 404 }),
    );

    const error = await getReconciliationRunByIdRequest('missing-run').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ httpStatus: 404, code: undefined, reference: undefined, retryable: false });
  });

  it('returns undefined for a 204 No Content response', async () => {
    clearAuthToken();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await expect(identityConfirmRequest('123456')).resolves.toBeUndefined();
  });
});

describe('downloadWorkbookRequest', () => {
  afterEach(() => {
    clearAuthToken();
    vi.restoreAllMocks();
  });

  it('throws the server-provided message when the export request fails', async () => {
    clearAuthToken();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Export not ready.' }), { status: 409 }),
    );

    await expect(downloadWorkbookRequest('run-1', 'run-1.xlsx')).rejects.toThrow(
      'Export not ready.',
    );
  });
});

describe('logoutRequest', () => {
  afterEach(() => {
    clearAuthToken();
    vi.restoreAllMocks();
  });

  it('clears the local token even when the server-side revoke call fails', async () => {
    setAuthToken('token-to-clear');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(logoutRequest()).resolves.toBeUndefined();
  });
});

/** Minimal fake for `createImportRunRequest`'s `XMLHttpRequest` -- just enough to drive
 * load/error/abort and upload-progress, mirroring `App.test.tsx`'s `FakeImportRunXhr` at a
 * smaller scope (this file only needs the stall-watchdog behaviour, not App.tsx's whole
 * create->submit->report flow). */
class FakeXhr {
  static instances: FakeXhr[] = [];
  readonly upload = new EventTarget();
  private readonly target = new EventTarget();
  status = 0;
  responseText = '';

  open(): void {}
  setRequestHeader(): void {}
  addEventListener(type: string, handler: EventListener): void {
    this.target.addEventListener(type, handler);
  }
  send(): void {
    FakeXhr.instances.push(this);
  }
  abort(): void {
    this.target.dispatchEvent(new Event('abort'));
  }
  emitProgress(loaded: number, total: number): void {
    this.upload.dispatchEvent(
      Object.assign(new Event('progress'), { lengthComputable: true, loaded, total }),
    );
  }
  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.target.dispatchEvent(new Event('load'));
  }
}

const latestFakeXhr = (): FakeXhr => {
  const xhr = FakeXhr.instances.at(-1);
  if (!xhr) {
    throw new Error('Expected createImportRunRequest to have constructed an XMLHttpRequest.');
  }
  return xhr;
};

const createImportRunPayload = () => ({
  bankFiles: [new File(['bank-bytes'], 'bank.xlsx')],
  // A-D1 (Issue #338): one explicit account assignment per bank file.
  bankAccountAssignments: [{ accountId: '11111111-1111-4111-8111-111111111111' }],
  glFile: new File(['gl-bytes'], 'gl.xlsx'),
  label: 'Stall watchdog test',
  frequency: 'MONTHLY' as const,
  periodYear: 2026,
  periodMonth: 8,
});

describe('createImportRunRequest stall watchdog (Issue #251)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves normally when the response arrives before the stall window elapses', async () => {
    const promise = createImportRunRequest(createImportRunPayload());
    const xhr = latestFakeXhr();
    await vi.advanceTimersByTimeAsync(1000);
    xhr.respond(201, { id: 'run-1' });

    await expect(promise).resolves.toEqual({ id: 'run-1' });
  });

  it('rejects with a network-error message if nothing happens for the full stall window -- the observed real-world hang (server logs a 200, but the XHR load event never fires)', async () => {
    const promise = createImportRunRequest(createImportRunPayload());
    const rejection = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30_000);

    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Network error while uploading source files.');
  });

  it('resets the stall window on every upload-progress tick, so a slow-but-live large transfer is not punished', async () => {
    const promise = createImportRunRequest(createImportRunPayload());
    const xhr = latestFakeXhr();

    // Three ticks spaced under the 30s window, spanning 60s total -- would have fired a flat
    // overall timeout, but each progress event resets the watchdog.
    await vi.advanceTimersByTimeAsync(20_000);
    xhr.emitProgress(1_000, 3_000);
    await vi.advanceTimersByTimeAsync(20_000);
    xhr.emitProgress(2_000, 3_000);
    await vi.advanceTimersByTimeAsync(20_000);
    xhr.respond(201, { id: 'run-1' });

    await expect(promise).resolves.toEqual({ id: 'run-1' });
  });

  it('still rejects with AbortError (not the network-error message) for a genuine caller-initiated abort', async () => {
    const controller = new AbortController();
    const promise = createImportRunRequest({ ...createImportRunPayload(), signal: controller.signal });
    const rejection = promise.catch((error: unknown) => error);

    controller.abort();

    const error = await rejection;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });
});
