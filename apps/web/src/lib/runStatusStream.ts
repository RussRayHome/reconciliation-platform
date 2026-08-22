import { apiFetch } from './api';

/**
 * Mirrors `QueueProgressMessage` (apps/api/src/services/queueProgress.ts) -- one line of the
 * NDJSON stream `GET /api/imports/runs/:id/events` publishes.
 */
export type RunStatusMessage = {
  organizationId: string;
  processId: string;
  queueType: 'import-validation' | 'reconciliation';
  statusMessage: string;
  details?: Record<string, unknown>;
};

/**
 * Opens the live status stream for one run (Issue #154 -- Pub/Sub, not polling) and calls
 * `onMessage` for every NDJSON line the server publishes, in order, for as long as the connection
 * stays open. Not `EventSource`: the endpoint authenticates via `Authorization: Bearer` (this app
 * has no cookie-based session anywhere), which `EventSource` cannot send -- `apiFetch` + a raw
 * stream reader is the same auth path every other request in this module already uses.
 *
 * Returns an unsubscribe function that aborts the underlying connection -- call it from a
 * `useEffect` cleanup (component unmount, or the durable phase leaving `'running'`) so a stale
 * stream never keeps writing into state nobody reads anymore.
 */
export const subscribeToRunStatus = (
  runId: string,
  onMessage: (message: RunStatusMessage) => void,
): (() => void) => {
  const controller = new AbortController();

  const readStream = async (): Promise<void> => {
    let response: Response;
    try {
      response = await apiFetch(`/api/imports/runs/${encodeURIComponent(runId)}/events`, {
        signal: controller.signal,
      });
    } catch {
      // Aborted before the connection opened, or a network error -- the durable-state poll
      // (getLatestImportRunRequest) remains the source of truth either way, so this stays quiet.
      return;
    }

    if (!response.ok || !response.body) {
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf('\n');

          if (!line.trim()) {
            continue;
          }

          try {
            onMessage(JSON.parse(line) as RunStatusMessage);
          } catch {
            // One malformed line shouldn't take down the rest of the stream.
          }
        }
      }
    } catch {
      // Aborted (unsubscribe) or the connection dropped -- both are normal, not error states the
      // caller needs to react to.
    }
  };

  void readStream();

  return () => {
    controller.abort();
  };
};
