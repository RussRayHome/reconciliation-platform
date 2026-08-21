/**
 * Shared shape for the live status push described in Issue #154's plan: a worker reports a
 * checkpoint once, and the same call both persists it (already durable via
 * `PostgresReconciliationLifecycleStore.recordAuditEvent`, wired into
 * `reconciliationService.ts`'s `appendAuditEvent`) and publishes it (`Job.updateProgress`, read
 * back out by `QueueEvents`'s `'progress'` event). Defined once here, not duplicated per queue
 * file, so `importValidationQueue.ts`/`reconciliationQueue.ts` and the business logic in
 * `app.ts`/`reconciliationService.ts`/`importValidationService.ts` all agree on the same shape.
 */
export type QueueStepReporter = (
  statusMessage: string,
  details?: Record<string, unknown>,
) => Promise<void>;

/**
 * The message a queue consumer publishes via `Job.updateProgress` -- exactly what `QueueEvents`'s
 * `'progress'` event delivers back out, carrying organization/process/queue identity so a
 * multi-tenant SSE listener can filter to the right connection without a Redis round-trip.
 */
export type QueueProgressMessage = {
  organizationId: string;
  /** The id a listener already knows and filters on: `reconciliation_run.id` for the import
   * validation queue, `requestId` for the standalone reconciliation queue (its own `runId` isn't
   * known until `registerLifecycleJob` resolves mid-processing, well after enqueue). */
  processId: string;
  queueType: 'import-validation' | 'reconciliation';
  statusMessage: string;
  details?: Record<string, unknown>;
};
