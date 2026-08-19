import { useCallback, useRef, useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';

import type { ReconciliationRunResponse } from '../lib/api';
import type { ImportRunSubmitPayload } from './useImportRunSubmit';

export type ImportUploadTransferPayload = Omit<ImportRunSubmitPayload, 'onProgress' | 'signal'>;

/** Client-side transfer status for Screen 02's upload cards. There's no chunked/resumable upload
 * backend here (see `ImportUploadCard`'s doc comment) -- "uploading" tracks the one combined
 * request's bytes sent so far (both bank workbooks plus the GL workbook), and a network failure
 * can only be retried by resending every file from the start, not resumed. */
export type ImportUploadTransferState =
  | { kind: 'idle' }
  | { kind: 'uploading'; loadedBytes: number }
  | { kind: 'network-failed'; stalledBytes: number };

const NETWORK_ERROR_MESSAGE = 'Network error while uploading source files.';

/** Drives Screen 02's upload cards on top of `useImportRunSubmit`'s mutation: starts the transfer
 * with an `AbortController` and a progress callback wired through `createImportRunRequest`,
 * exposes `cancel` (aborts in place, returns to idle) and `retry` (resends the last payload from
 * scratch after a network failure). Cancel/network-failure outcomes are absorbed here via
 * `reconciliation.reset()` so they don't also surface through the mutation's generic error
 * banner -- this hook's own state is the single source of truth for both. */
export const useImportUploadTransfer = (
  reconciliation: UseMutationResult<ReconciliationRunResponse, Error, ImportRunSubmitPayload>,
) => {
  const [transfer, setTransfer] = useState<ImportUploadTransferState>({ kind: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);
  const lastPayloadRef = useRef<ImportUploadTransferPayload | null>(null);

  const start = useCallback(
    (payload: ImportUploadTransferPayload) => {
      lastPayloadRef.current = payload;

      const controller = new AbortController();
      controllerRef.current = controller;
      setTransfer({ kind: 'uploading', loadedBytes: 0 });

      reconciliation.mutate(
        {
          ...payload,
          signal: controller.signal,
          onProgress: (event) => {
            setTransfer({ kind: 'uploading', loadedBytes: event.loadedBytes });
          },
        },
        {
          onSuccess: () => {
            setTransfer({ kind: 'idle' });
          },
          onError: (error) => {
            if (error instanceof DOMException && error.name === 'AbortError') {
              setTransfer({ kind: 'idle' });
              reconciliation.reset();
              return;
            }

            if (error.message === NETWORK_ERROR_MESSAGE) {
              setTransfer((previous) => ({
                kind: 'network-failed',
                stalledBytes: previous.kind === 'uploading' ? previous.loadedBytes : 0,
              }));
              reconciliation.reset();
              return;
            }

            setTransfer({ kind: 'idle' });
          },
        },
      );
    },
    [reconciliation],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    if (lastPayloadRef.current) {
      start(lastPayloadRef.current);
    }
  }, [start]);

  return { transfer, start, cancel, retry };
};
