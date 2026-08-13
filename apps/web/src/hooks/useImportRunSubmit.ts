import { useMutation } from '@tanstack/react-query';

import {
  createImportRunRequest,
  getReconciliationRunByIdRequest,
  submitImportRunRequest,
  type CreateImportRunOptions,
  type CreateImportRunPayload,
  type ReconciliationRunResponse,
} from '../lib/api';

export type ImportRunSubmitPayload = CreateImportRunPayload & CreateImportRunOptions;

/**
 * Creates a DRAFT import run, submits it, and -- once validation passes synchronously and
 * triggers matching -- fetches the resulting reconciliation report by its `matchingJobId`. Returns
 * the same `ReconciliationRunResponse` shape `useReconciliationRun` did, so every existing
 * consumer of that mutation's `{data, isPending, error}` (progress stepper, run bar, review tabs,
 * exports) keeps working unchanged.
 *
 * Two outcomes have no live-progress screen yet (Screens 02/05-07, not built until later phases):
 * a queued (async) submission, and a run that fails validation. Both surface as a thrown Error
 * through the mutation's existing `.error` rendering rather than silently doing nothing -- an
 * honest placeholder, not a full progress UI.
 */
export const useImportRunSubmit = () =>
  useMutation<ReconciliationRunResponse, Error, ImportRunSubmitPayload>({
    mutationFn: async (payload) => {
      const run = await createImportRunRequest(payload);
      const result = await submitImportRunRequest(run.id);

      if (result.status === 'queued') {
        throw new Error(
          'Import run submitted and queued for validation. Live progress for queued runs ' +
            "isn't available in this view yet -- check Approvals › Imported files once " +
            'validation completes.',
        );
      }

      if (result.status === 'failed') {
        throw new Error(result.reason);
      }

      if (!result.passed || !result.matchingJobId) {
        throw new Error(
          'Import run failed validation. Row-level details aren\'t available in this view yet ' +
            '-- check Approvals › Imported files (Rejected tab).',
        );
      }

      return getReconciliationRunByIdRequest(result.matchingJobId);
    },
  });
