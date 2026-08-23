import {
  buildSummaryMetrics,
  classifyExceptions,
  exportWorkbook,
  reconcileMatches,
  type CandidateOutcomeObserver,
} from '@recon/core';
import {
  defaultReconciliationConfig,
  resolveReconciliationConfig,
  sampleAccountOverrides,
} from '@recon/config';

import type { PostgresReconciliationLifecycleStore } from '@recon/persistence';

import type {
  AuditEvent,
  NormalizedTransaction,
  PayeeAlias,
  RawTransactionRow,
  ReconciliationConfig,
  ReconciliationRun,
  SourceFile,
} from '@recon/domain';
import pino from 'pino';
import { resolveLogLevelAtLeastInfo } from './logLevel';
import type { QueueStepReporter } from './queueProgress';

// Module-level logger used for service-layer tracing outside HTTP context.
// When called from an HTTP route, call-site logs via request.log supplement these.
const serviceLogger = pino({
  name: 'reconciliation-service',
  level: resolveLogLevelAtLeastInfo(process.env.LOG_LEVEL),
});

interface RunReconciliationPipelineInput {
  correlationId: string;
  runId: string;
  organizationId: string;
  lifecycleStore?: PostgresReconciliationLifecycleStore;
  sourceFiles: SourceFile[];
  /** Raw rows for the lifecycle store's IMPORTING/IMPORTED state-machine step
   * (`persistParsedRows`). For File-Validation-sourced runs (Issue #137's
   * `executeReconciliationFromNormalized`), these are repackaged from `NormalizedRecord.raw` via
   * `@recon/core`'s `toRawTransactionRows` rather than a real parse -- see that function's doc
   * comment for why this isn't invented data. */
  rawRows: RawTransactionRow[];
  /** Lazy, not a pre-resolved value: called inside this function's own try/catch so a throw here
   * (e.g. `executeReconciliation`'s `normalizeTransactions` call) is logged and rethrown exactly
   * like every other pipeline-stage failure, matching pre-Issue-#137 behavior where normalization
   * lived inside this same try block. `executeReconciliationFromNormalized` just returns its
   * already-built array. */
  getNormalizedTransactions: () => NormalizedTransaction[];
  config: ReconciliationConfig;
  accountIdentifier?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
  periodLabel?: string;
  aliases: PayeeAlias[];
  t0: number;
  log: pino.Logger;
  /** Live push half of Issue #154 (Pub/Sub, not polling) -- present only when this run is
   * processing inside a queue worker (see `reconciliationQueue.ts`/`importValidationQueue.ts`'s
   * `Worker` callbacks); undefined on the synchronous in-request fallback path, where there's no
   * `Job` to call `updateProgress` on. `appendAuditEvent` below already persists every checkpoint
   * unconditionally (Issue #154, changeset-independent of this) -- `onStep` only adds the publish
   * side, so its absence never loses data, only live status text. */
  onStep?: QueueStepReporter;
}

/** Fault-finding detail for the vetting phase, LOG_LEVEL=debug only -- undefined (not a no-op)
 * when debug isn't enabled, so the O(bank x gl) scoring loop this feeds from pays zero per-pair
 * overhead in normal operation; gated on the same logger instance that will do the emitting, so
 * the gate and the emission can never drift out of sync with each other. */
const buildCandidateOutcomeObserver = (log: pino.Logger): CandidateOutcomeObserver | undefined =>
  log.isLevelEnabled('debug')
    ? (candidate, disposition) =>
        log.debug({
          action: 'service.match.candidate.outcome',
          bankTransactionId: candidate.bankTransactionId,
          glTransactionId: candidate.glTransactionId,
          ruleName: candidate.ruleName,
          score: candidate.score,
          confidence: candidate.confidence,
          disposition,
        })
    : undefined;

/**
 * The shared tail of the reconciliation pipeline -- persistence lifecycle, matching, exception
 * classification, summary, and export -- factored out of `executeReconciliation` (Issue #137) so
 * both that function (parses + normalizes via the old alias-based pathway) and
 * `executeReconciliationFromNormalized` (takes File-Validation-sourced `NormalizedTransaction[]`
 * directly, no parse) share identical behavior downstream of "we have normalized transactions."
 */
const runReconciliationPipeline = async ({
  correlationId,
  runId,
  organizationId,
  lifecycleStore,
  sourceFiles,
  rawRows,
  getNormalizedTransactions,
  config,
  accountIdentifier,
  reconciliationFrequency,
  periodLabel,
  aliases,
  t0,
  log,
  onStep,
}: RunReconciliationPipelineInput): Promise<ReconciliationRun> => {
  const runPersistStep = async <T>(action: string, fn: () => Promise<T>): Promise<T> => {
    const stepStart = Date.now();
    const result = await fn();
    log.debug({ action, durationMs: Date.now() - stepStart });
    return result;
  };

  if (lifecycleStore) {
    await runPersistStep('service.persist.parsedRows.completed', () =>
      lifecycleStore.persistParsedRows(organizationId, runId, sourceFiles, rawRows),
    );
  }

  // ── 3. Core reconciliation pipeline ───────────────────────────────────────
  const reconStart = Date.now();
  log.debug({
    action: 'service.reconciliation.pipeline.start',
    totalRawRows: rawRows.length,
  });

  let auditEvents: AuditEvent[] = [
    {
      timestamp: new Date().toISOString(),
      action: 'reconciliation.run.started',
      details: {
        runId,
        correlationId,
        sourceFileCount: sourceFiles.length,
      },
    },
  ];

  // Issue #154: appends to the in-memory array (still returned as part of the ReconciliationRun
  // shape API consumers already read) *and* writes the same event durably and immediately via
  // lifecycleStore.recordAuditEvent -- unlike the old batch-at-the-end write, this survives a
  // failure partway through the pipeline. Write failures are swallowed (never let a database
  // hiccup on an audit row fail the actual reconciliation run); this is telemetry, not the work
  // itself. Also fires onStep (the live-push half, present only inside a queue worker) with the
  // same action string as the statusMessage -- one checkpoint, both effects, so persist and
  // publish can never drift out of sync with each other.
  const appendAuditEvent = async (
    action: AuditEvent['action'],
    details: AuditEvent['details'],
  ): Promise<void> => {
    auditEvents = [
      ...auditEvents,
      {
        timestamp: new Date().toISOString(),
        action,
        details,
      },
    ];

    if (lifecycleStore) {
      await lifecycleStore
        .recordAuditEvent(organizationId, runId, action, details)
        .catch((error: unknown) => {
          log.warn({
            action: 'service.auditEvent.persist.failed',
            auditEventAction: action,
            err: error instanceof Error ? { message: error.message } : error,
          });
        });
    }

    await onStep?.(action, details).catch((error: unknown) => {
      log.warn({
        action: 'service.auditEvent.publish.failed',
        auditEventAction: action,
        err: error instanceof Error ? { message: error.message } : error,
      });
    });
  };

  let normalizedTransactions: NormalizedTransaction[];
  let matching: ReturnType<typeof reconcileMatches>;
  let exceptionOutput: ReturnType<typeof classifyExceptions>;
  let summary: ReturnType<typeof buildSummaryMetrics>;
  let outputWorkbook: Awaited<ReturnType<typeof exportWorkbook>>;

  try {
    normalizedTransactions = getNormalizedTransactions();
    const excludedTransactions = normalizedTransactions.filter((t) => t.isExcluded);
    const dataQualityTransactions = normalizedTransactions.filter(
      (t) => t.dataQualityIssues.length > 0,
    );
    log.debug({
      action: 'service.normalize.completed',
      normalizedCount: normalizedTransactions.length,
      excludedCount: excludedTransactions.length,
      dataQualityIssueCount: dataQualityTransactions.length,
    });
    if (process.env.DEBUG_RECONCILIATION === 'true' && excludedTransactions.length > 0) {
      log.debug({
        action: 'service.normalize.exclusions.sample',
        samples: excludedTransactions.slice(0, 10).map((t) => ({
          id: t.id,
          source: t.source,
          line: t.lineNumber,
          exclusionReason: t.exclusionReason,
          dataQualityIssues: t.dataQualityIssues,
        })),
      });
    }
    await appendAuditEvent('reconciliation.normalize.completed', {
      transactionCount: normalizedTransactions.length,
    });

    if (lifecycleStore) {
      await runPersistStep('service.persist.normalizedRows.completed', () =>
        lifecycleStore.persistNormalizedRows(organizationId, runId, normalizedTransactions),
      );
    }

    const matchStart = Date.now();
    matching = reconcileMatches(
      normalizedTransactions,
      config.matching,
      aliases,
      buildCandidateOutcomeObserver(log),
    );
    const matchResultsByDisposition = matching.matchResults.reduce<Record<string, number>>(
      (acc, result) => {
        acc[result.disposition] = (acc[result.disposition] ?? 0) + 1;
        return acc;
      },
      {},
    );
    log.debug({
      action: 'service.match.completed',
      durationMs: Date.now() - matchStart,
      matchResultsByDisposition,
      groupedMatchResultCount: matching.groupedMatchResults.length,
      probableMatchCount: matching.probableMatches.length,
      unmatchedBankCount: matching.unmatchedBankTransactionIds.size,
      unmatchedGlCount: matching.unmatchedGlTransactionIds.size,
      duplicateCount: matching.duplicateTransactionIds.size,
    });
    if (process.env.DEBUG_RECONCILIATION === 'true') {
      log.debug({
        action: 'service.match.results.sample',
        samples: matching.matchResults.slice(0, 10).map((r) => ({
          disposition: r.disposition,
          confidence: r.confidence,
          ruleName: r.ruleName,
          reason: r.reason,
          score: r.score,
        })),
      });
    }
    await appendAuditEvent('reconciliation.match.completed', {
      matchResultCount: matching.matchResults.length,
      groupedMatchResultCount: matching.groupedMatchResults.length,
      probableMatchCount: matching.probableMatches.length,
    });

    if (lifecycleStore) {
      await runPersistStep('service.persist.matchingArtifacts.completed', () =>
        lifecycleStore.persistMatchingArtifacts(organizationId, {
          jobId: runId,
          matchResults: matching.matchResults,
          probableMatches: matching.probableMatches,
          groupedMatchResults: matching.groupedMatchResults,
        }),
      );
    }

    const classifyStart = Date.now();
    exceptionOutput = classifyExceptions({
      runId,
      sourceFiles: [...sourceFiles],
      normalizedTransactions,
      matchResults: matching.matchResults,
      unmatchedBankTransactionIds: matching.unmatchedBankTransactionIds,
      unmatchedGlTransactionIds: matching.unmatchedGlTransactionIds,
      duplicateTransactionIds: matching.duplicateTransactionIds,
      groupedMatchResults: matching.groupedMatchResults,
      reporting: config.reporting,
      matching: config.matching,
      reconciliationFrequency,
    });
    const exceptionsByCategory = exceptionOutput.exceptions.reduce<Record<string, number>>(
      (acc, exception) => {
        acc[exception.category] = (acc[exception.category] ?? 0) + 1;
        return acc;
      },
      {},
    );
    log.debug({
      action: 'service.classify.completed',
      durationMs: Date.now() - classifyStart,
      exceptionsByCategory,
      reviewerObservationCount: exceptionOutput.reviewerObservations.length,
    });
    if (process.env.DEBUG_RECONCILIATION === 'true') {
      log.debug({
        action: 'service.classify.exceptions.sample',
        samples: exceptionOutput.exceptions.slice(0, 10).map((e) => ({
          category: e.category,
          severity: e.severity,
          source: e.source,
          line: e.lineNumber,
          errorMessage: e.errorMessage,
          ruleTrace: e.ruleTrace,
        })),
      });
    }
    await appendAuditEvent('reconciliation.classify.completed', {
      exceptionCount: exceptionOutput.exceptions.length,
    });

    const summaryStart = Date.now();
    summary = buildSummaryMetrics(
      normalizedTransactions,
      matching.matchResults,
      exceptionOutput.exceptions,
      config.matching.staleOutstandingCheckDays,
      reconciliationFrequency,
    );
    log.debug({
      action: 'service.summary.completed',
      durationMs: Date.now() - summaryStart,
    });

    if (lifecycleStore) {
      await runPersistStep('service.persist.reviewArtifacts.completed', () =>
        lifecycleStore.persistReviewArtifacts(organizationId, {
          jobId: runId,
          exceptions: exceptionOutput.exceptions,
          reviewerObservations: exceptionOutput.reviewerObservations,
          summary,
        }),
      );
    }

    const exportStart = Date.now();
    outputWorkbook = await exportWorkbook({
      runId,
      accountIdentifier,
      periodLabel,
      config,
      summary,
      exceptions: exceptionOutput.exceptions,
      probableMatches: matching.probableMatches,
      reviewerObservations: exceptionOutput.reviewerObservations,
      normalizedTransactions,
    });
    log.debug({
      action: 'service.export.completed',
      durationMs: Date.now() - exportStart,
      tabCount: outputWorkbook.tabNames.length,
    });
    await appendAuditEvent('reconciliation.export.completed', {
      workbookFileName: outputWorkbook.fileName,
      tabCount: outputWorkbook.tabNames.length,
    });

    await appendAuditEvent('reconciliation.run.completed', {
      runId,
      correlationId,
      exactMatches: summary.exactMatches,
      unresolvedExposure: summary.unresolvedExposure,
    });
  } catch (reconError) {
    log.error({
      action: 'service.reconciliation.pipeline.error',
      err:
        reconError instanceof Error
          ? { message: reconError.message, stack: reconError.stack }
          : reconError,
    });
    // Issue #154: the one genuinely new checkpoint (not a rewire of an existing one) -- this is
    // what actually closes the "a mid-run failure leaves no durable trail" gap. Still doesn't
    // transition reconciliation_job's own state to FAILED (a separate, deliberately out-of-scope
    // write-path change); this only makes sure the audit trail survives, independent of whether
    // the job's own terminal state does.
    await appendAuditEvent('reconciliation.run.failed', {
      runId,
      correlationId,
      message: reconError instanceof Error ? reconError.message : String(reconError),
    });
    throw reconError;
  }

  log.info({
    action: 'service.reconciliation.pipeline.completed',
    durationMs: Date.now() - reconStart,
    normalizedTransactions: normalizedTransactions.length,
    matchResults: matching.matchResults.length,
    groupedMatchResults: matching.groupedMatchResults.length,
    probableMatches: matching.probableMatches.length,
    exceptions: exceptionOutput.exceptions.length,
    exactMatches: summary.exactMatches,
    timingDifferences: summary.timingDifferences,
    dataQualityIssues: summary.dataQualityIssues,
    missingFromBank: summary.missingFromBank,
    missingFromGL: summary.missingFromGL,
    duplicates: summary.duplicates,
  });

  log.info({ action: 'service.reconciliation.done', runId, totalDurationMs: Date.now() - t0 });

  if (lifecycleStore) {
    await runPersistStep('service.persist.exportAndFinalize.completed', () =>
      lifecycleStore.persistExportAndFinalize(organizationId, {
        jobId: runId,
        outputWorkbook,
        completedAt: new Date().toISOString(),
      }),
    );
  }

  return {
    id: runId,
    correlationId,
    accountIdentifier,
    reconciliationFrequency,
    periodLabel,
    status: 'Completed',
    startedAt: new Date(t0).toISOString(),
    completedAt: new Date().toISOString(),
    sourceFiles: [...sourceFiles],
    rawRows,
    normalizedTransactions,
    matchResults: matching.matchResults,
    groupedMatchResults: matching.groupedMatchResults,
    probableMatches: matching.probableMatches,
    exceptions: exceptionOutput.exceptions,
    summary,
    reviewerObservations: exceptionOutput.reviewerObservations,
    reviewerDecisions: [],
    outputWorkbook,
    auditEvents,
  };
};

/**
 * Input contract for `executeReconciliationFromNormalized` -- File-Validation-sourced runs
 * (Issue #137) that already have validated, normalized transactions and never call
 * `parseWorkbook`/`excelParser.ts` at all.
 */
export interface ExecuteReconciliationFromNormalizedInput {
  correlationId: string;
  runId: string;
  /** Session id (JWT `jti`) of whoever triggered this run, so the entire matching-phase log
   * narrative can be filtered alongside everything else that happened in the same session --
   * this module's logger is deliberately independent of request.log (see serviceLogger below,
   * this function is also reachable from a bare queue worker with no request object), so the
   * session id has to be threaded in explicitly rather than picked up automatically. */
  sessionId?: string;
  organizationId: string;
  lifecycleStore?: PostgresReconciliationLifecycleStore;
  sourceFiles: SourceFile[];
  rawRows: RawTransactionRow[];
  normalizedTransactions: NormalizedTransaction[];
  accountIdentifier?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
  periodLabel?: string;
  aliases?: PayeeAlias[];
  /** See `RunReconciliationPipelineInput.onStep`'s doc comment. */
  onStep?: QueueStepReporter;
}

/**
 * Runs the reconciliation pipeline against transactions File Validation already validated and
 * normalized (via `@recon/core`'s `toNormalizedTransactions`/`toRawTransactionRows`), skipping
 * `parseWorkbook`/`normalizeTransactions` entirely (Issue #137) -- this is what
 * `triggerMatchingForImportRun` (the Import flow) and `/api/reconciliation/run` (the standalone
 * atomic route) both call now instead of re-parsing raw bytes through the old alias-based
 * pathway. Shares every downstream step (persistence lifecycle, matching, classification,
 * summary, export) with `executeReconciliation` via `runReconciliationPipeline`.
 */
export const executeReconciliationFromNormalized = async ({
  correlationId,
  runId,
  sessionId,
  organizationId,
  lifecycleStore,
  sourceFiles,
  rawRows,
  normalizedTransactions,
  accountIdentifier,
  reconciliationFrequency,
  periodLabel,
  aliases = [],
  onStep,
}: ExecuteReconciliationFromNormalizedInput): Promise<ReconciliationRun> => {
  const log = serviceLogger.child({ correlationId, sessionId, accountIdentifier });
  const t0 = Date.now();

  log.info({
    action: 'service.reconciliation.start',
    source: 'file-validation',
    sourceFileCount: sourceFiles.length,
    normalizedCount: normalizedTransactions.length,
  });

  const config =
    resolveReconciliationConfig(accountIdentifier, sampleAccountOverrides) ??
    defaultReconciliationConfig;
  log.debug({
    action: 'service.config.resolved',
    accountIdentifier,
    dateToleranceDays: config.matching.dateToleranceDays,
    timingDifferenceDays: config.matching.timingDifferenceDays,
  });

  return runReconciliationPipeline({
    correlationId,
    runId,
    organizationId,
    lifecycleStore,
    sourceFiles,
    rawRows,
    getNormalizedTransactions: () => normalizedTransactions,
    config,
    accountIdentifier,
    reconciliationFrequency,
    periodLabel,
    aliases,
    t0,
    log,
    onStep,
  });
};
