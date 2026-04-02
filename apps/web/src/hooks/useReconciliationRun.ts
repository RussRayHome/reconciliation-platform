import { useMutation } from '@tanstack/react-query';

import {
  runReconciliationRequest,
  type ReconciliationRunResponse,
  type RunReconciliationPayload,
} from '../lib/api';

export const useReconciliationRun = () =>
  useMutation<ReconciliationRunResponse, Error, RunReconciliationPayload>({
    mutationFn: runReconciliationRequest,
  });
