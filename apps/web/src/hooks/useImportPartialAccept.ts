import { useMutation } from '@tanstack/react-query';

import {
  getReconciliationRunByIdRequest,
  importPartialRunRequest,
  type ReconciliationRunResponse,
} from '../lib/api';

/**
 * Screen 06's "Import N rows & submit" -- accepts a VALIDATION_FAILED run's already-passing rows
 * and, once matching fires, resolves to the same `ReconciliationRunResponse` shape
 * `useImportRunSubmit` does, so it can feed the same downstream success flow (persisted run,
 * navigate to Review) without App.tsx needing a second code path for it.
 */
export const useImportPartialAccept = () =>
  useMutation<ReconciliationRunResponse, Error, { runId: string }>({
    mutationFn: async ({ runId }) => {
      const result = await importPartialRunRequest(runId);

      if (!result.matchingJobId) {
        throw new Error('Partial import was accepted, but no matching run was triggered.');
      }

      return getReconciliationRunByIdRequest(result.matchingJobId);
    },
  });
