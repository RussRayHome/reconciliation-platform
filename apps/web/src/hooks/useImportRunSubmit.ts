import { useMutation } from '@tanstack/react-query';

import {
  createImportRunRequest,
  getReconciliationRunByIdRequest,
  submitImportRunRequest,
  type CreateImportRunOptions,
  type CreateImportRunPayload,
  type ImportRunSummary,
  type ReconciliationRunResponse,
} from '../lib/api';

export type ImportRunSubmitPayload = CreateImportRunPayload & CreateImportRunOptions;

/** Thrown instead of a plain `Error` when the run was created and submitted but failed
 * validation -- carries the run summary (already returned inline by `submitImportRunRequest`) so
 * the UI can show Screen 05/07's failure detail for the invalid file(s) rather than just a
 * generic error banner. */
export class ImportValidationFailedError extends Error {
  readonly run: ImportRunSummary;

  constructor(run: ImportRunSummary) {
    super('Import run failed validation.');
    this.name = 'ImportValidationFailedError';
    this.run = run;
  }
}

/**
 * Creates a DRAFT import run, submits it, and -- once validation passes synchronously and
 * triggers matching -- fetches the resulting reconciliation report by its `matchingJobId`. Returns
 * the same `ReconciliationRunResponse` shape `useReconciliationRun` did, so every existing
 * consumer of that mutation's `{data, isPending, error}` (progress stepper, run bar, review tabs,
 * exports) keeps working unchanged.
 *
 * A queued (async) submission has no live-progress screen yet (Screens 02/04/06/08, not built
 * until later phases) and surfaces as a thrown `Error` through the mutation's existing `.error`
 * rendering. A validation failure throws `ImportValidationFailedError` instead, carrying the run
 * summary so `SourceUploadSection` can render the Phase 11 failure screens.
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
        throw new ImportValidationFailedError(result.run);
      }

      return getReconciliationRunByIdRequest(result.matchingJobId);
    },
  });
