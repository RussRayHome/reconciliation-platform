import { useCallback, useRef, useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';

import type { AccountAssignmentConflict, ErrorCode } from '@recon/domain';

import { ApiError } from '../lib/api';
import {
  ImportValidationFailedError,
  type ImportRunSubmitPayload,
  type ImportRunSubmitResult,
} from './useImportRunSubmit';

export type ImportUploadTransferPayload = Omit<ImportRunSubmitPayload, 'onProgress' | 'signal'>;

/** Client-side transfer status for Screen 02's upload cards. There's no chunked/resumable upload
 * backend here (see `ImportUploadCard`'s doc comment) -- "uploading" tracks the one combined
 * request's bytes sent so far (both bank workbooks plus the GL workbook), and a network failure
 * can only be retried by resending every file from the start, not resumed. `failed` is
 * error-handling-build-plan.md EH4's typed terminal state for anything that isn't a cancel or a
 * network interruption -- e.g. a 503 because no database is configured (issue #187). */
export type ImportUploadTransferState =
  | { kind: 'idle' }
  | { kind: 'uploading'; loadedBytes: number }
  | { kind: 'network-failed'; stalledBytes: number }
  /** A-D1 (Issue #338): one or more statements disagree with the account they were assigned to.
   * Its own state rather than a `failed` variant because it is not a failure to retry -- the
   * operator either confirms the assignment as-is or picks a different account, and only they can
   * decide which. Retrying the identical request would be rejected identically. */
  | { kind: 'assignment-conflict'; conflicts: AccountAssignmentConflict[] }
  | { kind: 'failed'; message: string; code?: ErrorCode; reference?: string; retryable: boolean };

const NETWORK_ERROR_MESSAGE = 'Network error while uploading source files.';

/** Drives Screen 02's upload cards on top of `useImportRunSubmit`'s mutation: starts the transfer
 * with an `AbortController` and a progress callback wired through `createImportRunRequest`,
 * exposes `cancel` (aborts in place, returns to idle) and `retry` (resends the last payload from
 * scratch after a network failure). Cancel/network-failure outcomes are absorbed here via
 * `reconciliation.reset()` so they don't also surface through the mutation's generic error
 * banner -- this hook's own state is the single source of truth for both. */
export const useImportUploadTransfer = (
  reconciliation: UseMutationResult<ImportRunSubmitResult, Error, ImportRunSubmitPayload>,
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

            // A-D1 conflicts come back as a 409 carrying every disagreement. Surfaced for
            // confirm-or-reassign rather than absorbed into the generic failure banner, which
            // would leave the operator with no way to act on it.
            if (error instanceof ApiError && error.httpStatus === 409 && error.conflicts?.length) {
              setTransfer({ kind: 'assignment-conflict', conflicts: error.conflicts });
              reconciliation.reset();
              return;
            }

            if (error instanceof ImportValidationFailedError) {
              // Rendered by SourceUploadSection's own ImportValidationFailedError branch, which
              // reads `reconciliation.error` directly -- must not be cleared here.
              setTransfer({ kind: 'idle' });
              return;
            }

            // error-handling-build-plan.md EH4: any other error (e.g. a 503 because no database
            // is configured, issue #187) used to reset back to `idle`, discarding the signal and
            // returning the UI to a state that looks like nothing happened. Land it in `failed`
            // instead, carrying whatever typed detail `ApiError` parsed off the response.
            setTransfer({
              kind: 'failed',
              message: error.message,
              code: error instanceof ApiError ? error.code : undefined,
              reference: error instanceof ApiError ? error.reference : undefined,
              retryable: error instanceof ApiError ? error.retryable : false,
            });
            reconciliation.reset();
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
