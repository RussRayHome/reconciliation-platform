import type { NormalizedRecord, RowIssueObserver } from '@recon/core';
import { validateFile } from '@recon/core';
import type {
  BlobStorage,
  CanonicalRecordInput,
  ImportRunFileSummary,
  PostgresImportRunStore,
  PostgresImportValidationStore,
} from '@recon/persistence';
import type pino from 'pino';

import type { QueueStepReporter } from './queueProgress';

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
 * Express.Multer.File that the reconciliation pipeline actually reads (buffer/originalname), not the
 * whole Multer type, since these bytes came from BlobStorage, not a fresh upload. */
export interface ImportValidationFileBytes {
  buffer: Buffer;
  originalname: string;
}

/** Issue #137: the matching trigger now receives the already-validated `NormalizedRecord[]`
 * alongside the original bytes, instead of only bytes to re-parse. `bytes`/`originalname` are
 * still needed to register this file into the old pipeline's own audit trail
 * (reconciliation_source_file/reconciliation_source_file_content) -- `matching_job_id` links a
 * reconciliation_run back to that trail (changeset 0048) -- but they are never re-parsed. */
export interface ImportValidationTriggerFile extends ImportValidationFileBytes {
  normalized: NormalizedRecord[];
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
    bankFile: ImportValidationTriggerFile;
    glFile: ImportValidationTriggerFile;
  }) => Promise<{ matchingJobId: string }>;
  /** Live push half of Issue #154 (Pub/Sub, not polling) -- present only when this job is
   * processing inside the import validation queue worker; undefined on the synchronous
   * in-request fallback. Stage 1 (file validation) doesn't get its own durable per-gate audit
   * trail the way Stage 2 (matching) does via `reconciliation_audit_event` -- `import_job.status`/
   * timestamps already durably record start/finish (see `markJobRunning`/`finalizeRun` below), so
   * `onStep` here is publish-only: a start and a terminal pass/fail checkpoint, matching the
   * plan's "keep checkpoints modest for v1" guidance. */
  onStep?: QueueStepReporter;
}

export interface RunImportValidationWorkflowResult {
  passed: boolean;
  matchingJobId?: string;
}

/** Issue #137: neither the Bank nor GL template carries a currency column -- the system assumes
 * single-currency USD for now (docs/transaction-csv-spec.md §1), so this is an explicit constant,
 * not a silently-dropped field. */
const ASSUMED_CURRENCY_CODE = 'USD';

const toCanonicalRecordInput = (record: NormalizedRecord): CanonicalRecordInput => ({
  sourceType: record.sourceSystem,
  recordId: record.recordId,
  // Neither template carries an account column (docs/transaction-csv-spec.md §2/§3) -- account
  // context is sourced from the bank file's filename once Issue #141's parsing lands, not here.
  account: record.account ?? '',
  date: record.date,
  currencyCode: ASSUMED_CURRENCY_CODE,
  signedAmount: record.signedAmount,
  direction: record.direction,
  magnitude: record.magnitude,
  description: record.description,
  reference: record.referenceNumber ?? record.checkNumber,
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
  await input.importValidationStore.markJobRunning(
    input.organizationId,
    input.importJobId,
    input.workerId,
  );
  await input.onStep?.('Validating uploaded files…').catch(() => undefined);

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
    normalized: NormalizedRecord[];
    passed: boolean;
  }> = [];

  const debugEnabled = input.logger.isLevelEnabled('debug');

  for (const file of run.files) {
    // Issue #141: a run now carries the two raw per-account bank uploads (BANK_ACCOUNT_A/B,
    // audit/re-download only) alongside the merged dataset that actually flows through File
    // Validation and matching (BANK_MERGED). Only BANK_MERGED/GL get individually validated --
    // the raw files never get their own validation_issue/canonical_record rows.
    if (file.role !== 'BANK_MERGED' && file.role !== 'GL') {
      continue;
    }

    const fileType = assertBankOrGl(file);
    const bytes = await input.blobStorage.get(file.importFileId, input.organizationId);

    const onIssue: RowIssueObserver | undefined = debugEnabled
      ? (issue) =>
          input.logger.debug({
            action: 'import-validation.row.issue',
            runId: input.runId,
            importJobId: input.importJobId,
            importFileId: file.importFileId,
            role: file.role,
            ...issue,
          })
      : undefined;

    const outcome = await validateFile({ bytes, fileFormat: file.fileFormat, fileType, onIssue });

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

    fileOutcomes.push({
      file,
      bytes,
      normalized: outcome.normalized,
      passed: recorded.validationStatus !== 'INVALID',
    });
  }

  const passed = fileOutcomes.every((entry) => entry.passed);

  await input.importValidationStore.finalizeRun(
    input.organizationId,
    input.runId,
    input.importJobId,
    {
      passed,
    },
  );

  if (!passed) {
    input.logger.info({ action: 'import-validation.run.failed', runId: input.runId });
    await input.onStep?.('File validation failed').catch(() => undefined);
    return { passed: false };
  }

  await input.onStep?.('File validation passed').catch(() => undefined);

  const bankEntry = fileOutcomes.find((entry) => entry.file.role === 'BANK_MERGED');
  const glEntry = fileOutcomes.find((entry) => entry.file.role === 'GL');
  if (!bankEntry || !glEntry) {
    throw new Error(
      `reconciliation_run ${input.runId} passed validation without both a BANK and GL file.`,
    );
  }

  const { matchingJobId } = await input.triggerMatching({
    bankFile: {
      buffer: bankEntry.bytes,
      originalname: bankEntry.file.originalFilename,
      normalized: bankEntry.normalized,
    },
    glFile: {
      buffer: glEntry.bytes,
      originalname: glEntry.file.originalFilename,
      normalized: glEntry.normalized,
    },
  });

  await input.importValidationStore.recordMatchingJobId(
    input.organizationId,
    input.runId,
    matchingJobId,
  );

  input.logger.info({ action: 'import-validation.run.matched', runId: input.runId, matchingJobId });

  return { passed: true, matchingJobId };
};
