// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError, type ImportRunSummary } from '../lib/api';
import {
  ImportValidationFailedError,
  type ImportRunSubmitPayload,
  type ImportRunSubmitResult,
} from './useImportRunSubmit';
import { useImportUploadTransfer, type ImportUploadTransferPayload } from './useImportUploadTransfer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PAYLOAD: ImportUploadTransferPayload = {
  bankFiles: [new File(['a'], '1234-bank.csv')],
  glFile: new File(['b'], 'gl.csv'),
  label: 'Test run',
  frequency: 'MONTHLY',
  periodYear: 2026,
};

/** Wraps `useImportRunSubmit`'s real mutation shape around a fake `mutationFn` so
 * `useImportUploadTransfer`'s `onError` branches can be exercised directly, without going through
 * the full app/XHR harness `App.test.tsx` uses for the end-to-end path. */
const renderTransfer = (mutationFn: (payload: ImportRunSubmitPayload) => Promise<ImportRunSubmitResult>) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );

  return renderHook(
    () => {
      const reconciliation = useMutation<ImportRunSubmitResult, Error, ImportRunSubmitPayload>({
        mutationFn,
      });
      return useImportUploadTransfer(reconciliation);
    },
    { wrapper },
  );
};

describe('useImportUploadTransfer', () => {
  it('lands an unrecognised error in `failed`, never `idle` (error-handling-build-plan.md EH4)', async () => {
    const { result } = renderTransfer(() =>
      Promise.reject(new ApiError('This feature requires a database connection, which is not configured in this environment.', 503, {
        code: 'RCN-DB-001',
        reference: '7f3a9c2e-4b11-4c00-8000-000000000000',
        retryable: false,
      })),
    );

    act(() => {
      result.current.start(PAYLOAD);
    });

    await waitFor(() => {
      expect(result.current.transfer.kind).toBe('failed');
    });

    expect(result.current.transfer).toMatchObject({
      kind: 'failed',
      message: 'This feature requires a database connection, which is not configured in this environment.',
      code: 'RCN-DB-001',
      reference: '7f3a9c2e-4b11-4c00-8000-000000000000',
      retryable: false,
    });
  });

  it('carries retryable:true through so a caller can offer retry', async () => {
    const { result } = renderTransfer(() =>
      Promise.reject(
        new ApiError('The service could not reach its database. Please try again shortly.', 503, {
          code: 'RCN-DB-002',
          reference: 'ref-1',
          retryable: true,
        }),
      ),
    );

    act(() => {
      result.current.start(PAYLOAD);
    });

    await waitFor(() => {
      expect(result.current.transfer.kind).toBe('failed');
    });

    expect(result.current.transfer).toMatchObject({ kind: 'failed', retryable: true });
  });

  it('falls back to a plain message with no code/reference for a non-ApiError failure', async () => {
    const { result } = renderTransfer(() => Promise.reject(new Error('Something went wrong.')));

    act(() => {
      result.current.start(PAYLOAD);
    });

    await waitFor(() => {
      expect(result.current.transfer.kind).toBe('failed');
    });

    expect(result.current.transfer).toMatchObject({
      kind: 'failed',
      message: 'Something went wrong.',
      code: undefined,
      reference: undefined,
      retryable: false,
    });
  });

  it('still routes an ImportValidationFailedError to idle, unchanged, so the run-summary view (driven off reconciliation.error) keeps rendering', async () => {
    const run = { id: 'run-1' } as unknown as ImportRunSummary;
    const { result } = renderTransfer(() => Promise.reject(new ImportValidationFailedError(run)));

    act(() => {
      result.current.start(PAYLOAD);
    });

    await waitFor(() => {
      expect(result.current.transfer.kind).toBe('idle');
    });
  });

  it('retries by resending the last payload', async () => {
    const mutationFn = vi
      .fn<(payload: ImportRunSubmitPayload) => Promise<ImportRunSubmitResult>>()
      .mockRejectedValueOnce(new ApiError('Not reachable.', 503, { code: 'RCN-DB-002', retryable: true }))
      .mockResolvedValueOnce({ kind: 'succeeded', report: {} } as ImportRunSubmitResult);

    const { result } = renderTransfer(mutationFn);

    act(() => {
      result.current.start(PAYLOAD);
    });

    await waitFor(() => {
      expect(result.current.transfer.kind).toBe('failed');
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.transfer.kind).toBe('idle');
    });

    expect(mutationFn).toHaveBeenCalledTimes(2);
    expect(mutationFn.mock.calls[1]?.[0]).toMatchObject({ label: PAYLOAD.label });
  });
});
