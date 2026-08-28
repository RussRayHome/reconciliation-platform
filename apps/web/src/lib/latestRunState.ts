import type { ImportRunSummary } from './api';

/**
 * The RunBar's durable, cross-reload answer to "where is my process right now" (Issue #154),
 * derived purely from `GET /api/imports/runs/latest`'s response -- no dependency on a live
 * mutation being in memory. `succeeded` carries `matchingJobId` so the caller can resolve the
 * full `ReconciliationRunReport` via the existing `getReconciliationRunByIdRequest`.
 */
export type LatestRunPhase =
  | { kind: 'idle' }
  | { kind: 'queued'; run: ImportRunSummary }
  | { kind: 'running'; run: ImportRunSummary }
  | { kind: 'validation-failed'; run: ImportRunSummary }
  | { kind: 'matching-failed'; run: ImportRunSummary; message: string }
  | { kind: 'succeeded'; run: ImportRunSummary; matchingJobId: string };

/**
 * Precedence matters, and is deliberate, not incidental -- a `VALIDATION_FAILED` run with a stale
 * `matchingJobId` left over from an earlier attempt must never read as `succeeded`, and a Stage-2
 * failure must be caught via `validationJob.status` even when `run.status` still reads
 * `PENDING_APPROVAL` (Issue #154's own investigation: the live import-run path's failure catch
 * only marks `import_job` FAILED, never transitions `reconciliation_run.status` or links
 * `matching_job_id`).
 *
 * 1. No run at all -> idle.
 * 2. File Validation (Stage 1) failed -> validation-failed.
 * 3. Reconciliation/matching (Stage 2) failed via the linked `reconciliation_job` (legacy/queue
 *    path) -> matching-failed.
 * 4. Stage 2 failed via `import_job.status` (the path that actually fires on a live submission
 *    today) -> matching-failed.
 * 5. A matching job is linked and neither failure above applied -> succeeded.
 * 6. Stage 1 (file validation) is queued but hasn't started -> queued, distinct from `running` so
 *    a reload mid-queue shows the same phase the live path already committed to (R2 D1) -- a
 *    genuinely separate wait state from a run that's actively doing work.
 * 7. Still genuinely in flight (Stage 1 running, or Stage 2 queued/running) -> running.
 * 8. Anything else (e.g. `PENDING_APPROVAL` with no job linkage and no failure) -> idle; there is
 *    nothing concrete to report yet, so this deliberately doesn't guess at success.
 *
 * @param run The organization's latest import run, or `null` if it has never submitted one.
 */
export const resolveLatestRunPhase = (run: ImportRunSummary | null): LatestRunPhase => {
  if (!run) {
    return { kind: 'idle' };
  }

  if (run.status === 'VALIDATION_FAILED') {
    return { kind: 'validation-failed', run };
  }

  if (run.matchingJob?.currentState === 'FAILED') {
    return {
      kind: 'matching-failed',
      run,
      message: run.matchingJob.failureMessage ?? run.matchingJob.failureCode ?? 'Reconciliation failed.',
    };
  }

  if (run.validationJob?.status === 'FAILED') {
    return {
      kind: 'matching-failed',
      run,
      message: run.validationJob.errorSummary ?? 'Reconciliation failed.',
    };
  }

  if (run.matchingJobId) {
    return { kind: 'succeeded', run, matchingJobId: run.matchingJobId };
  }

  if (run.validationJob?.status === 'QUEUED') {
    return { kind: 'queued', run };
  }

  if (
    run.status === 'DRAFT' ||
    run.status === 'VALIDATING' ||
    run.validationJob?.status === 'RUNNING'
  ) {
    return { kind: 'running', run };
  }

  return { kind: 'idle' };
};
