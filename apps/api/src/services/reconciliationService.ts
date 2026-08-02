import {
  buildSummaryMetrics,
  classifyExceptions,
  exportWorkbook,
  normalizeTransactions,
  reconcileMatches,
  parseWorkbook,
} from '@recon/core';
import {
  defaultReconciliationConfig,
  resolveReconciliationConfig,
  sampleAccountOverrides,
} from '@recon/config';

import type { PostgresReconciliationLifecycleStore } from '@recon/persistence';

import type { AuditEvent, PayeeAlias, ReconciliationRun } from '@recon/domain';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { resolveLogLevelAtLeastInfo } from './logLevel';

// Module-level logger used for service-layer tracing outside HTTP context.
// When called from an HTTP route, call-site logs via request.log supplement these.
const serviceLogger = pino({
  name: 'reconciliation-service',
  level: resolveLogLevelAtLeastInfo(process.env.LOG_LEVEL),
});

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Input contract for executing one reconciliation run from uploaded workbook
 * files and optional business context.
 */
export interface ExecuteReconciliationInput {
  correlationId: string;
  runId?: string;
  lifecycleStore?: PostgresReconciliationLifecycleStore;
  sourceFileIds?: Partial<Record<'bank' | 'gl', string>>;
  bankFile: UploadedFile;
  glFile: UploadedFile;
  accountIdentifier?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
  periodLabel?: string;
  aliases?: PayeeAlias[];
}

/**
 * Parses the uploaded bank and GL workbooks, resolves reconciliation config,
 * executes the shared matching pipeline, and returns a completed run payload.
 *
 * @param input Uploaded workbooks plus correlation and optional accounting context.
 * @returns A completed reconciliation run suitable for API responses and export.
 */
export const executeReconciliation = async ({
  correlationId,
  runId: providedRunId,
  lifecycleStore,
  sourceFileIds,
  bankFile,
  glFile,
  accountIdentifier,
  reconciliationFrequency,
  periodLabel,
  aliases = [],
}: ExecuteReconciliationInput): Promise<ReconciliationRun> => {
  const log = serviceLogger.child({ correlationId, accountIdentifier });
  const t0 = Date.now();

  log.info({
    action: 'service.reconciliation.start',
    bankFile: bankFile.originalname,
    glFile: glFile.originalname,
    bankSizeBytes: bankFile.size,
    glSizeBytes: glFile.size,
  });

  // Times and logs a lifecycleStore persistence call at debug level, so a stalled
  // Postgres write is visible as "step never completed" rather than a silent hang.
  const runPersistStep = async <T>(action: string, fn: () => Promise<T>): Promise<T> => {
    const stepStart = Date.now();
    const result = await fn();
    log.debug({ action, durationMs: Date.now() - stepStart });
    return result;
  };

  // ── 1. Config resolution ───────────────────────────────────────────────────
  const config =
    resolveReconciliationConfig(accountIdentifier, sampleAccountOverrides) ??
    defaultReconciliationConfig;
  log.debug({
    action: 'service.config.resolved',
    accountIdentifier,
    dateToleranceDays: config.matching.dateToleranceDays,
    timingDifferenceDays: config.matching.timingDifferenceDays,
    bankHeaderRow: config.bank.headerRow,
    glHeaderRow: config.gl.headerRow,
  });

  const runId = providedRunId ?? randomUUID();
  log.debug({ action: 'service.run.id.assigned', runId });

  // ── 2. Parallel workbook parsing ──────────────────────────────────────────
  const parseStart = Date.now();
  log.debug({ action: 'service.parse.start' });

  let bankParsed: Awaited<ReturnType<typeof parseWorkbook>>;
  let glParsed: Awaited<ReturnType<typeof parseWorkbook>>;
  try {
    [bankParsed, glParsed] = await Promise.all([
      parseWorkbook({
        source: 'bank',
        sourceFileId: sourceFileIds?.bank,
        fileName: bankFile.originalname,
        mimeType: bankFile.mimetype,
        sizeBytes: bankFile.size,
        buffer: bankFile.buffer,
        config: config.bank,
      }),
      parseWorkbook({
        source: 'gl',
        sourceFileId: sourceFileIds?.gl,
        fileName: glFile.originalname,
        mimeType: glFile.mimetype,
        sizeBytes: glFile.size,
        buffer: glFile.buffer,
        config: config.gl,
      }),
    ]);
  } catch (parseError) {
    log.error({
      action: 'service.parse.error',
      err:
        parseError instanceof Error
          ? { message: parseError.message, stack: parseError.stack }
          : parseError,
    });
    throw parseError;
  }

  log.info({
    action: 'service.parse.completed',
    durationMs: Date.now() - parseStart,
    bankRawRows: bankParsed.rawRows.length,
    glRawRows: glParsed.rawRows.length,
    bankWorksheet: bankParsed.sourceFile.worksheetName,
    glWorksheet: glParsed.sourceFile.worksheetName,
  });

  const sourceFiles = [bankParsed.sourceFile, glParsed.sourceFile] as const;
  const rawRows = [...bankParsed.rawRows, ...glParsed.rawRows];

  if (lifecycleStore) {
    await runPersistStep('service.persist.parsedRows.completed', () =>
      lifecycleStore.persistParsedRows(runId, [...sourceFiles], rawRows),
    );
  }

  // Log first few raw rows at debug level for traceability
  if (process.env.DEBUG_RECONCILIATION === 'true') {
    log.debug({
      action: 'service.parse.bank.sample',
      rows: bankParsed.rawRows.slice(0, 5).map((r) => ({ line: r.lineNumber, raw: r.rawValues })),
    });
    log.debug({
      action: 'service.parse.gl.sample',
      rows: glParsed.rawRows.slice(0, 5).map((r) => ({ line: r.lineNumber, raw: r.rawValues })),
    });
  }

  // ── 3. Core reconciliation pipeline ───────────────────────────────────────
  const reconStart = Date.now();
  log.debug({
    action: 'service.reconciliation.pipeline.start',
    totalRawRows: bankParsed.rawRows.length + glParsed.rawRows.length,
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

  const appendAuditEvent = (action: AuditEvent['action'], details: AuditEvent['details']): void => {
    auditEvents = [
      ...auditEvents,
      {
        timestamp: new Date().toISOString(),
        action,
        details,
      },
    ];
  };

  let normalizedTransactions: ReturnType<typeof normalizeTransactions>;
  let matching: ReturnType<typeof reconcileMatches>;
  let exceptionOutput: ReturnType<typeof classifyExceptions>;
  let summary: ReturnType<typeof buildSummaryMetrics>;
  let outputWorkbook: Awaited<ReturnType<typeof exportWorkbook>>;

  try {
    const normalizeStart = Date.now();
    normalizedTransactions = normalizeTransactions(runId, rawRows, config);
    const excludedTransactions = normalizedTransactions.filter((t) => t.isExcluded);
    const dataQualityTransactions = normalizedTransactions.filter(
      (t) => t.dataQualityIssues.length > 0,
    );
    log.debug({
      action: 'service.normalize.completed',
      durationMs: Date.now() - normalizeStart,
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
    appendAuditEvent('reconciliation.normalize.completed', {
      transactionCount: normalizedTransactions.length,
    });

    if (lifecycleStore) {
      await runPersistStep('service.persist.normalizedRows.completed', () =>
        lifecycleStore.persistNormalizedRows(runId, normalizedTransactions),
      );
    }

    const matchStart = Date.now();
    matching = reconcileMatches(normalizedTransactions, config.matching, aliases);
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
    appendAuditEvent('reconciliation.match.completed', {
      matchResultCount: matching.matchResults.length,
      groupedMatchResultCount: matching.groupedMatchResults.length,
      probableMatchCount: matching.probableMatches.length,
    });

    if (lifecycleStore) {
      await runPersistStep('service.persist.matchingArtifacts.completed', () =>
        lifecycleStore.persistMatchingArtifacts({
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
    appendAuditEvent('reconciliation.classify.completed', {
      exceptionCount: exceptionOutput.exceptions.length,
    });

    const summaryStart = Date.now();
    summary = buildSummaryMetrics(
      normalizedTransactions,
      matching.matchResults,
      exceptionOutput.exceptions,
    );
    log.debug({
      action: 'service.summary.completed',
      durationMs: Date.now() - summaryStart,
    });

    if (lifecycleStore) {
      await runPersistStep('service.persist.reviewArtifacts.completed', () =>
        lifecycleStore.persistReviewArtifacts({
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
    appendAuditEvent('reconciliation.export.completed', {
      workbookFileName: outputWorkbook.fileName,
      tabCount: outputWorkbook.tabNames.length,
    });

    appendAuditEvent('reconciliation.run.completed', {
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
      lifecycleStore.persistExportAndFinalize({
        jobId: runId,
        outputWorkbook,
        completedAt: new Date().toISOString(),
        auditEvents,
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
