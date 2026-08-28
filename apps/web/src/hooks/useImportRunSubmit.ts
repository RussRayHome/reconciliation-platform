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

/** R2 V1: a queued submission is a real outcome, not a failure -- carries the just-created
 * `ImportRunSummary` so the caller can sync it into the durable phase (`lib/latestRunState.ts`)
 * immediately, without waiting for the next poll tick. `succeeded` keeps the exact report shape
 * every existing consumer of this mutation's `.data` already expects. */
export type ImportRunSubmitResult =
  | { kind: 'queued'; run: ImportRunSummary }
  | { kind: 'succeeded'; report: ReconciliationRunResponse };

/** Thrown instead of a plain `Error` when the run was created and submitted but failed
 * validation -- carries the run summary (already returned inline by `submitImportRunRequest`) so
 * the UI can show Screen 05/07's failure detail for the invalid file(s) rather than just a
 * generic error banner. */
export class ImportValidationFailedError extends Error {
  /** The run summary `submitImportRunRequest` already returned inline, carrying per-file
   * validation status so the UI can render Screen 05/06/07 without a second round trip. */
  readonly run: ImportRunSummary;

  /** @param run The run summary from the failed submit response. */
  constructor(run: ImportRunSummary) {
    super('Import run failed validation.');
    this.name = 'ImportValidationFailedError';
    this.run = run;
  }
}

/**
 * Creates a DRAFT import run, submits it, and -- once validation passes synchronously and
 * triggers matching -- fetches the resulting reconciliation report by its `matchingJobId`.
 *
 * R2 V1: a queued (async) submission is a resolved `{ kind: 'queued' }` result now, not a thrown
 * `Error` -- the mutation's error channel means "something went wrong" again, full stop. Live
 * progress for a queued run still isn't rendered from this hook directly (Screens 02/04/06/08);
 * the caller is expected to sync the returned `run` into the durable phase
 * (`lib/latestRunState.ts`) and let that drive the UI, same vocabulary as a reload would produce.
 * A validation failure still throws `ImportValidationFailedError`, carrying the run summary so
 * `SourceUploadSection` can render the Phase 11 failure screens -- a validation failure genuinely
 * is a failure.
 */
export const useImportRunSubmit = () =>
  useMutation<ImportRunSubmitResult, Error, ImportRunSubmitPayload>({
    mutationFn: async (payload) => {
      const run = await createImportRunRequest(payload);
      const result = await submitImportRunRequest(run.id);

      if (result.status === 'queued') {
        return { kind: 'queued', run };
      }

      if (result.status === 'failed') {
        throw new Error(result.reason);
      }

      if (!result.passed || !result.matchingJobId) {
        throw new ImportValidationFailedError(result.run);
      }

      const report = await getReconciliationRunByIdRequest(result.matchingJobId);
      return { kind: 'succeeded', report };
    },
  });
