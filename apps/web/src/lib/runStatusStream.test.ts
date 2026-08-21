import { afterEach, describe, expect, it, vi } from 'vitest';

import { subscribeToRunStatus, type RunStatusMessage } from './runStatusStream';

const encoder = new TextEncoder();

/** Builds a streaming Response whose body trickles out one chunk per `enqueue` call -- lets a
 * test control exactly when each NDJSON line "arrives" rather than delivering everything at once,
 * which is what a real live-progress connection actually does. */
const streamingResponse = (chunks: string[], options?: { closeImmediately?: boolean }) => {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      if (options?.closeImmediately !== false) {
        controller.close();
      }
    },
  });
  return { response: new Response(stream, { status: 200 }), controller: controllerRef! };
};

describe('subscribeToRunStatus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses and delivers NDJSON lines in order, including a line split across chunks', async () => {
    const line1: RunStatusMessage = {
      organizationId: 'org-1',
      processId: 'run-1',
      queueType: 'import-validation',
      statusMessage: 'Validating uploaded files…',
    };
    const line2: RunStatusMessage = {
      organizationId: 'org-1',
      processId: 'run-1',
      queueType: 'import-validation',
      statusMessage: 'File validation passed',
      details: { rowCount: 42 },
    };

    const { response } = streamingResponse([
      `${JSON.stringify(line1)}\n${JSON.stringify(line2).slice(0, 10)}`,
      `${JSON.stringify(line2).slice(10)}\n`,
    ]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    const received: RunStatusMessage[] = [];
    const unsubscribe = subscribeToRunStatus('run-1', (message) => received.push(message));

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received).toEqual([line1, line2]);

    unsubscribe();
  });

  it('requests the correctly-encoded per-run events URL', async () => {
    const { response } = streamingResponse([]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    const unsubscribe = subscribeToRunStatus('run with spaces', () => undefined);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/imports/runs/run%20with%20spaces/events');

    unsubscribe();
  });

  it('skips a malformed line without dropping the rest of the stream', async () => {
    const validMessage: RunStatusMessage = {
      organizationId: 'org-1',
      processId: 'run-1',
      queueType: 'import-validation',
      statusMessage: 'File validation passed',
    };
    const { response } = streamingResponse([`not json\n${JSON.stringify(validMessage)}\n`]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    const received: RunStatusMessage[] = [];
    const unsubscribe = subscribeToRunStatus('run-1', (message) => received.push(message));

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received).toEqual([validMessage]);

    unsubscribe();
  });

  it('the returned unsubscribe function aborts the underlying fetch', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      capturedSignal = (init as RequestInit | undefined)?.signal ?? undefined;
      return new Promise(() => undefined); // never resolves -- only the abort matters here
    });

    const unsubscribe = subscribeToRunStatus('run-1', () => undefined);
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal!.aborted).toBe(false);

    unsubscribe();
    expect(capturedSignal!.aborted).toBe(true);
  });

  it('does not throw when the response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

    const received: RunStatusMessage[] = [];
    const unsubscribe = subscribeToRunStatus('run-1', (message) => received.push(message));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toEqual([]);

    unsubscribe();
  });
});
