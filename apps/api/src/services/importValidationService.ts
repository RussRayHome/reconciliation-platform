import type { NormalizedRecord } from '@recon/core';
import { validateFile } from '@recon/core';
import type {
  BlobStorage,
  CanonicalRecordInput,
  ImportRunFileSummary,
  PostgresImportRunStore,
  PostgresImportValidationStore,
} from '@recon/persistence';
import type pino from 'pino';

/** Exactly the read this workflow needs from PostgresImportRunStore -- Pick<>, not the whole
 * class, so a test double can satisfy it with a plain object (a class with a private `pool`
 * field can't structurally match an object literal). */
export type ImportRunSummaryReader = Pick<PostgresImportRunStore, 'getRunSummary'>;

/** Exactly the writes this workflow needs from PostgresImportValidationStore, same reasoning. */
export type ImportValidationWriter = Pick<
  PostgresImportValidationStore,
  | 'markJobRunning'
  | 'loadActiveValidationRuleVersionIds'
  | 'recordFileValidationOutcome'
  | 'finalizeRun'
  | 'recordMatchingJobId'
>;

/** One already-fetched source file, handed to the matching trigger -- shaped like the pieces of
 * Express.Multer.File that executeReconciliation actually reads (buffer/originalname), not the
 * whole Multer type, since these bytes came from BlobStorage, not a fresh upload. */
export interface ImportValidationFileBytes {
  buffer: Buffer;
  originalname: string;
}

export interface RunImportValidationWorkflowInput {
  organizationId: string;
  runId: string;
  importJobId: string;
  workerId: string;
  logger: pino.Logger;
  blobStorage: BlobStorage;
  importRunStore: ImportRunSummaryReader;
  importValidationStore: ImportValidationWriter;
  /** Fires the existing GL<->Bank matching pipeline (apps/api/src/app.ts's own
   * runReconciliationWorkflow, wired in by the caller rather than imported here -- it's a private
   * helper local to createApp, not exported, matching how reconciliationQueue's own processJob
   * closes over it directly rather than this module reaching in to grab it). Only called when
   * both files pass validation. */
  triggerMatching: (files: {
    bankFile: ImportValidationFileBytes;
    glFile: ImportValidationFileBytes;
  }) => Promise<{ matchingJobId: string }>;
}

export interface RunImportValidationWorkflowResult {
  passed: boolean;
  matchingJobId?: string;
}

const toCanonicalRecordInput = (record: NormalizedRecord): CanonicalRecordInput => ({
  sourceType: record.sourceSystem,
  recordId: record.recordId,
  account: record.account,
  date: record.date,
  currencyCode: record.currencyCode,
  signedAmount: record.signedAmount,
  direction: record.direction,
  magnitude: record.magnitude,
  description: record.description,
  reference: record.reference,
  sourceLineNumber: record.sourceLineNumber,
  raw: record.raw,
});

const assertBankOrGl = (file: ImportRunFileSummary): 'BANK' | 'GL' => {
  if (file.sourceType !== 'BANK' && file.sourceType !== 'GL') {
    // import_file.source_type's CHECK constraint already allows the full 14-value taxonomy
    // (changeset 0044, for the other source types tracked as GitHub issue #121) even though this
    // build only ever creates BANK/GL runs -- this is the seam where that gap would first bite,
    // so it fails loudly and specifically rather than silently miscategorizing the file.
    throw new Error(
      `Import validation only supports BANK/GL source types today; got "${file.sourceType}" for import_file ${file.importFileId}.`,
    );
  }
  return file.sourceType;
};

/**
 * Phase 6: runs the File Validation Engine against both of a run's files, persists the results,
 * and -- only when both pass -- triggers the existing GL<->Bank matching pipeline immediately
 * (reconciliation_run's own table comment, changeset 0042: validation passing is never gated by
 * the parallel Comptroller approval trail). Each file's outcome is recorded independently before
 * the pass/fail decision is made, so a file that individually fails still leaves its
 * validation_issue/canonical_record rows in place for Screen 06's partial-import review.
 */
export const runImportValidationWorkflow = async (
  input: RunImportValidationWorkflowInput,
): Promise<RunImportValidationWorkflowResult> => {
  await input.importValidationStore.markJobRunning(input.organizationId, input.importJobId, input.workerId);

  const run = await input.importRunStore.getRunSummary(input.organizationId, input.runId);
  if (!run) {
    throw new Error(
      `reconciliation_run ${input.runId} not found while processing import_job ${input.importJobId}.`,
    );
  }

  const ruleVersionIds = await input.importValidationStore.loadActiveValidationRuleVersionIds(
    input.organizationId,
  );

  const fileOutcomes: Array<{
    file: ImportRunFileSummary;
    bytes: Buffer;
    passed: boolean;
  }> = [];

  for (const file of run.files) {
    const fileType = assertBankOrGl(file);
    const bytes = await input.blobStorage.get(file.importFileId, input.organizationId);

    const outcome = await validateFile({ bytes, fileFormat: file.fileFormat, fileType });

    const recorded = await input.importValidationStore.recordFileValidationOutcome(
      input.organizationId,
      {
        importJobId: input.importJobId,
        importFileId: file.importFileId,
        reconciliationRunId: input.runId,
        totalRowCount: outcome.totalRowCount,
        issues: outcome.issues,
        normalized: outcome.normalized.map(toCanonicalRecordInput),
      },
      ruleVersionIds,
    );

    input.logger.info({
      action: 'import-validation.file.recorded',
      runId: input.runId,
      importFileId: file.importFileId,
      role: file.role,
      validationStatus: recorded.validationStatus,
      errorCount: recorded.errorCount,
      warningCount: recorded.warningCount,
    });

    fileOutcomes.push({ file, bytes, passed: recorded.validationStatus !== 'INVALID' });
  }

  const passed = fileOutcomes.every((entry) => entry.passed);

  await input.importValidationStore.finalizeRun(input.organizationId, input.runId, input.importJobId, {
    passed,
  });

  if (!passed) {
    input.logger.info({ action: 'import-validation.run.failed', runId: input.runId });
    return { passed: false };
  }

  const bankEntry = fileOutcomes.find((entry) => entry.file.role === 'BANK');
  const glEntry = fileOutcomes.find((entry) => entry.file.role === 'GL');
  if (!bankEntry || !glEntry) {
    throw new Error(`reconciliation_run ${input.runId} passed validation without both a BANK and GL file.`);
  }

  const { matchingJobId } = await input.triggerMatching({
    bankFile: { buffer: bankEntry.bytes, originalname: bankEntry.file.originalFilename },
    glFile: { buffer: glEntry.bytes, originalname: glEntry.file.originalFilename },
  });

  await input.importValidationStore.recordMatchingJobId(input.organizationId, input.runId, matchingJobId);

  input.logger.info({ action: 'import-validation.run.matched', runId: input.runId, matchingJobId });

  return { passed: true, matchingJobId };
};
