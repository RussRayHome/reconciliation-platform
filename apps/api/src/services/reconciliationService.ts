import {
  buildOpenItemCandidates,
  buildSummaryMetrics,
  classifyExceptions,
  exportWorkbook,
  buildDefaultPayeeAliases,
  reconcileMatches,
  seedCarriedForwardTransactions,
  type CandidateOutcomeObserver,
} from '@recon/core';
import {
  defaultReconciliationConfig,
  resolveReconciliationConfig,
  sampleAccountOverridesForContext,
} from '@recon/config';

import type { PostgresOpenItemStore, PostgresReconciliationLifecycleStore } from '@recon/persistence';

import {
  resolveCarryForwardDecision,
  type AuditEvent,
  type CarryForwardDecision,
  type NormalizedTransaction,
  type PayeeAlias,
  type RawTransactionRow,
  type ReconciliationConfig,
  type ReconciliationRun,
  type SourceFile,
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
  /** The run's declared period end (`reconciliation_run.period_end`), ISO date string -- see
   * `ExceptionClassifierInput.declaredAnchorDate`'s doc comment. Undefined for a caller with no
   * declared period end yet (the pre-File-Imports pipeline, or a run predating this column). */
  declaredAnchorDate?: string;
  /** `reconciliation_run.id`, when this pipeline run is File-Imports-triggered -- distinct from
   * `runId` above, which is the `reconciliation_job.id`. Present, `openItemStore` projects this
   * run's carry-eligible exceptions into open items and flips `reconciliation_run.status` to
   * RECONCILED once export/finalize succeeds (Unreconciled Item Roll-Forward PR C.4). Both
   * undefined together on the standalone atomic route, which has no `reconciliation_run` row. */
  reconciliationRunId?: string;
  openItemStore?: PostgresOpenItemStore;
  /** The `ENABLE_CARRY_FORWARD` ops kill switch, already resolved by app.ts (env parsing lives
   * there, not in this service module) -- the env half of `resolveCarryForwardDecision`'s input
   * (`@recon/domain`, Unreconciled Item Roll-Forward PR C.5). Optional, defaults true (matching
   * the env var's own documented default), so a caller with no opinion about carry-forward --
   * most tests -- doesn't need to pass it. */
  carryForwardEnvEnabled?: boolean;
  /** Issue #311: merge the built-in default payee aliases behind the organization's own rows.
   *  Default true; ENABLE_DEFAULT_PAYEE_ALIASES=false is the off switch for a tenant whose
   *  descriptors collide with a default. Organization rows always precede defaults. */
  useDefaultPayeeAliases?: boolean;
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
  /** See `ReconciliationInput.matchingConfigVersionId`. Passed straight through to the engine. */
  matchingConfigVersionId?: string;
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
  declaredAnchorDate,
  reconciliationRunId,
  openItemStore,
  carryForwardEnvEnabled = true,
  useDefaultPayeeAliases = true,
  aliases,
  t0,
  log,
  onStep,
  matchingConfigVersionId,
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
  // Undefined for the standalone atomic route (no openItemStore/reconciliationRunId) -- carry-
  // forward has no organization-scoped concept there. Resolved once, "before matching" per
  // resolveCarryForwardDecision's own doc comment, so PR D's future seeding step can read the
  // already-resolved decision rather than re-resolving it.
  let carryForwardDecision: CarryForwardDecision | undefined;

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

    // Unreconciled Item Roll-Forward PR C.5: resolve carry-forward enablement before matching so
    // PR D's future seeding step (which needs the decision *before* the candidate pool is built)
    // can read it already-resolved. Nothing consumes `carryForwardDecision.enabled` yet -- PR D
    // hasn't landed -- but the decision is still stamped on the run below (after finalize) so
    // today's runs already carry an accurate, non-retroactive audit trail once PR D does land.
    // Best-effort, matching the projection step below: a lookup failure here must not be able to
    // fail an otherwise-successful reconciliation run over a side concern that doesn't even
    // change behavior yet -- `carryForwardDecision` simply stays undefined, which also skips the
    // stamp step below.
    if (openItemStore) {
      try {
        const orgEnabled = await openItemStore.getCarryForwardEnabled(organizationId);
        carryForwardDecision = resolveCarryForwardDecision({
          envEnabled: carryForwardEnvEnabled,
          orgEnabled,
        });
        log.info({
          action: 'service.rollforward.carryForwardDecision.resolved',
          enabled: carryForwardDecision.enabled,
          reason: carryForwardDecision.enabled ? undefined : carryForwardDecision.reason,
        });
      } catch (carryForwardResolveError) {
        log.warn({
          action: 'service.rollforward.carryForwardDecision.failed',
          runId,
          message:
            carryForwardResolveError instanceof Error
              ? carryForwardResolveError.message
              : String(carryForwardResolveError),
        });
      }
    }

    // Unreconciled Item Roll-Forward PR E.1's prerequisite fix: link this run to the real accounts
    // its own normalized transactions touch (reconciliation_run_account, PR A.2) -- nothing wrote
    // this join going forward before now, only the one-time migration backfill for pre-existing
    // runs. PR E's close operation needs it to enumerate a run's accounts, and it belongs here
    // regardless of carry-forward enablement (E doesn't depend on D). Best-effort, matching every
    // other rollforward side path in this pipeline.
    // Since A-D1 (Issue #338) NormalizedTransaction.accountIdentifier carries the registered
    // reconciliation_account.id the operator assigned the statement to, so these are account ids,
    // not free text. Before that they were undefined on every transaction, which is why this set
    // was always empty and linkRunAccounts never once fired.
    const accountIds = [
      ...new Set(
        normalizedTransactions
          .map((t) => t.accountIdentifier)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (openItemStore && reconciliationRunId && accountIds.length > 0) {
      try {
        await openItemStore.linkRunAccounts(organizationId, {
          reconciliationRunId,
          accountIds,
        });
      } catch (linkError) {
        log.warn({
          action: 'service.rollforward.linkRunAccounts.failed',
          runId,
          message: linkError instanceof Error ? linkError.message : String(linkError),
        });
      }
    }

    // Unreconciled Item Roll-Forward PR D.1: seed prior periods' still-open items into this run's
    // candidate pool, before matching so they can pair against this period's fresh data. Gated on
    // the decision resolved above (never on openItemStore alone) -- an org that hasn't been
    // enabled must see zero behavior change from PR C's ungated write-only projection. Best-
    // effort, same as every other rollforward side path in this pipeline: a load/materialize
    // failure here must not turn an otherwise-successful run into a failure, it just means
    // nothing carries in this run (logged, not silent).
    if (openItemStore && carryForwardDecision?.enabled) {
      try {
        const openItems = await openItemStore.loadOpenItems(organizationId, accountIds);
        const { carriedTransactions, skippedAlreadyPresent } = seedCarriedForwardTransactions(
          runId,
          openItems,
          normalizedTransactions,
          config.textNormalization,
        );
        normalizedTransactions = [...normalizedTransactions, ...carriedTransactions];
        log.info({
          action: 'service.rollforward.seedCarriedForward.completed',
          openItemCount: openItems.length,
          carriedCount: carriedTransactions.length,
          skippedAlreadyPresent,
        });
      } catch (seedError) {
        log.warn({
          action: 'service.rollforward.seedCarriedForward.failed',
          runId,
          message: seedError instanceof Error ? seedError.message : String(seedError),
        });
      }
    }

    // Issue #311: an organization's own aliases first, then the built-in defaults, tokenised with
    // this run's normalization. Order matters -- the lookup keeps list order on an exact tie, so an
    // authored row beats a default of equal score; the defaults' lower confidence settles the rest.
    // The engine itself stays a pure function of its inputs; this policy lives here on purpose.
    const effectiveAliases = useDefaultPayeeAliases
      ? [...aliases, ...buildDefaultPayeeAliases(config.textNormalization)]
      : aliases;

    const matchStart = Date.now();
    matching = reconcileMatches(
      normalizedTransactions,
      config.matching,
      effectiveAliases,
      buildCandidateOutcomeObserver(log),
      // Issue #260/#276: the ACTIVE version whose overrides produced `config.matching`, so every
      // MatchResult records the version that actually shaped it. Undefined when the run used engine
      // defaults or a caller-supplied override with no version behind it.
      matchingConfigVersionId,
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
      declaredAnchorDate,
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

  // Unreconciled Item Roll-Forward PR D.5: mark carried-forward items that found their
  // counterpart this run as CLEARED. `matchResultId` is only passed when `lifecycleStore`
  // actually persisted `matching.matchResults` into `reconciliation_match_result` this run --
  // that column is a real FK, and writing an id that was never persisted would violate it. Same
  // best-effort placement and reasoning as PR C.4's projection immediately below: after
  // export/finalize, failures logged and swallowed, never able to turn a successful run into a
  // failure.
  if (openItemStore) {
    try {
      const matchedTransactionIds = new Set<string>();
      const matchResultByTransactionId = new Map<string, string>();
      matching.matchResults.forEach((result) => {
        if (result.bankTransactionId) {
          matchedTransactionIds.add(result.bankTransactionId);
          matchResultByTransactionId.set(result.bankTransactionId, result.id);
        }
        if (result.glTransactionId) {
          matchedTransactionIds.add(result.glTransactionId);
          matchResultByTransactionId.set(result.glTransactionId, result.id);
        }
      });

      const clearances = normalizedTransactions
        .filter((t) => t.isCarriedForward && t.carriedFromOpenItemId && matchedTransactionIds.has(t.id))
        .map((t) => ({
          openItemId: t.carriedFromOpenItemId!,
          matchResultId: lifecycleStore ? matchResultByTransactionId.get(t.id) : undefined,
        }));

      if (clearances.length > 0) {
        const { cleared } = await openItemStore.clearOpenItems(organizationId, {
          reconciliationRunId,
          clearances,
        });
        log.info({ action: 'service.rollforward.clearOpenItems.completed', cleared });
      }
    } catch (clearError) {
      log.warn({
        action: 'service.rollforward.clearOpenItems.failed',
        runId,
        message: clearError instanceof Error ? clearError.message : String(clearError),
      });
    }
  }

  // Unreconciled Item Roll-Forward PR C.4: project this run's carry-eligible exceptions into
  // open items once the run has genuinely finished (export/finalize succeeded above -- this is
  // deliberately *after* that step, not before, so a projection failure can never leave a
  // finalized run un-exported). Best-effort: an already-successful reconciliation run must not be
  // turned into a failure by a problem in this newer, separate side path, so failures here are
  // logged, not rethrown. Only runs when the caller wired an openItemStore in (production, via
  // app.ts) -- most tests exercise this pipeline without one.
  if (openItemStore) {
    try {
      const { candidates, skippedNoTransaction, skippedNoAccountIdentifier, skippedMissingRequiredField } =
        buildOpenItemCandidates(exceptionOutput.exceptions, normalizedTransactions);
      const projection = await openItemStore.projectOpenItems(organizationId, {
        jobId: runId,
        reconciliationRunId,
        candidates,
      });
      if (reconciliationRunId) {
        await openItemStore.markRunReconciled(organizationId, reconciliationRunId);
      }
      if (carryForwardDecision) {
        await openItemStore.stampCarryForwardDecision(
          organizationId,
          reconciliationRunId,
          carryForwardDecision,
        );
      }
      log.info({
        action: 'service.rollforward.projectOpenItems.completed',
        opened: projection.opened,
        carriedForward: projection.carriedForward,
        skippedNoTransaction,
        skippedNoAccountIdentifier,
        skippedMissingRequiredField,
      });
    } catch (rollforwardError) {
      log.warn({
        action: 'service.rollforward.projectOpenItems.failed',
        runId,
        message: rollforwardError instanceof Error ? rollforwardError.message : String(rollforwardError),
      });
    }
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
  /** See `RunReconciliationPipelineInput.declaredAnchorDate`'s doc comment. Only the Import flow
   * (`triggerMatchingForImportRun`) has a `reconciliation_run.period_end` to supply here today --
   * the standalone atomic route has no declared period at all, so it always passes undefined and
   * keeps today's derived-anchor behavior exactly as it is. */
  declaredAnchorDate?: string;
  /** See `RunReconciliationPipelineInput.reconciliationRunId`/`openItemStore`'s doc comments. */
  reconciliationRunId?: string;
  openItemStore?: PostgresOpenItemStore;
  /** See `RunReconciliationPipelineInput.carryForwardEnvEnabled`'s doc comment. */
  carryForwardEnvEnabled?: boolean;
  /** See `RunReconciliationPipelineInput.useDefaultPayeeAliases`'s doc comment. */
  useDefaultPayeeAliases?: boolean;
  aliases?: PayeeAlias[];
  /** See `RunReconciliationPipelineInput.onStep`'s doc comment. */
  onStep?: QueueStepReporter;
  /**
   * The ACTIVE matching-config version's variance overrides, keyed by metric id. Metric ids ARE
   * `keyof MatchingConfig` -- `ruleCatalog.ts` derives them from `Record<keyof MatchingConfig,
   * MetricRange>`, and the draft endpoint rejects anything outside `RULES_CATALOG_METRIC_IDS` --
   * so they map straight onto `config.matching`.
   *
   * Issue #260: before this existed the caller ran the engine WITHOUT overrides and then stamped
   * `run.appliedVarianceOverrides` onto the finished run, asserting a tolerance that was never
   * applied. Threading them here makes the recorded value the value used, by construction rather
   * than by convention.
   */
  varianceOverrides?: Record<string, number>;
  /** See `ReconciliationInput.matchingConfigVersionId`. */
  matchingConfigVersionId?: string;
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
  declaredAnchorDate,
  reconciliationRunId,
  openItemStore,
  carryForwardEnvEnabled,
  useDefaultPayeeAliases,
  aliases = [],
  onStep,
  varianceOverrides,
  matchingConfigVersionId,
}: ExecuteReconciliationFromNormalizedInput): Promise<ReconciliationRun> => {
  const log = serviceLogger.child({ correlationId, sessionId, accountIdentifier });
  const t0 = Date.now();

  log.info({
    action: 'service.reconciliation.start',
    source: 'file-validation',
    sourceFileCount: sourceFiles.length,
    normalizedCount: normalizedTransactions.length,
  });

  const baseConfig =
    // A-D1 (Issue #338): sample overrides are confined to a designated sample context. In
    // production this resolves an empty override list, so a tenant whose account number
    // happens to collide with a demo identifier gets the production default, not demo
    // thresholds. Previously harmless only because accountIdentifier was never populated.
    resolveReconciliationConfig(accountIdentifier, sampleAccountOverridesForContext()) ??
    defaultReconciliationConfig;

  // Issue #260. Overrides are applied to the config the engine is about to use, and
  // `appliedOverrides` records only what genuinely landed on it. An unknown metric id is dropped
  // rather than silently widening the config -- the draft endpoint already rejects those against
  // RULES_CATALOG_METRIC_IDS, so anything arriving here is either known or a bug worth not
  // honouring.
  const appliedOverrides: Record<string, number> = {};
  const config = varianceOverrides
    ? {
        ...baseConfig,
        matching: Object.entries(varianceOverrides).reduce(
          (matching, [metricId, value]) => {
            if (!(metricId in matching)) {
              log.warn({ action: 'service.config.override.unknown', metricId });
              return matching;
            }
            appliedOverrides[metricId] = value;
            return { ...matching, [metricId]: value };
          },
          { ...baseConfig.matching },
        ),
      }
    : baseConfig;

  log.debug({
    action: 'service.config.resolved',
    accountIdentifier,
    dateToleranceDays: config.matching.dateToleranceDays,
    timingDifferenceDays: config.matching.timingDifferenceDays,
    appliedVarianceOverrides: Object.keys(appliedOverrides).length,
  });

  const run = await runReconciliationPipeline({
    correlationId,
    runId,
    organizationId,
    lifecycleStore,
    sourceFiles,
    rawRows,
    getNormalizedTransactions: () => normalizedTransactions,
    config,
    matchingConfigVersionId,
    accountIdentifier,
    reconciliationFrequency,
    periodLabel,
    declaredAnchorDate,
    reconciliationRunId,
    openItemStore,
    carryForwardEnvEnabled,
    useDefaultPayeeAliases,
    aliases,
    t0,
    log,
    onStep,
  });

  // Issue #260: recorded here, from the same `appliedOverrides` the config above was built from,
  // so the run cannot claim a tolerance the engine did not use. Left undefined when nothing was
  // applied -- a silent record is correct; an empty object would read as "overrides ran and
  // changed nothing", which is a different claim.
  if (Object.keys(appliedOverrides).length > 0) {
    run.appliedVarianceOverrides = appliedOverrides;
  }

  return run;
};
