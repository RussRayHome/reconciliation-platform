import { useMutation } from '@tanstack/react-query';

import {
  runReconciliationRequest,
  type ReconciliationRunResponse,
  type RunReconciliationPayload,
} from '../lib/api';

/** TanStack Query mutation hook for submitting a reconciliation run and tracking its loading/error state. */
export const useReconciliationRun = () =>
  useMutation<ReconciliationRunResponse, Error, RunReconciliationPayload>({
    mutationFn: runReconciliationRequest,
  });
