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

import type { AuditEvent, ReconciliationRun } from '@recon/domain';
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
  sourceFileIds?: Partial<Record<'bank' | 'qbo', string>>;
  bankFile: UploadedFile;
  qboFile: UploadedFile;
  accountIdentifier?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
  periodLabel?: string;
}

/**
 * Parses the uploaded bank and QBO workbooks, resolves reconciliation config,
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
  qboFile,
  accountIdentifier,
  reconciliationFrequency,
  periodLabel,
}: ExecuteReconciliationInput): Promise<ReconciliationRun> => {
  const log = serviceLogger.child({ correlationId, accountIdentifier });
  const t0 = Date.now();

  log.info({
    action: 'service.reconciliation.start',
    bankFile: bankFile.originalname,
    qboFile: qboFile.originalname,
    bankSizeBytes: bankFile.size,
    qboSizeBytes: qboFile.size,
  });

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
    qboHeaderRow: config.qbo.headerRow,
  });

  const runId = providedRunId ?? randomUUID();
  log.debug({ action: 'service.run.id.assigned', runId });

  // ── 2. Parallel workbook parsing ──────────────────────────────────────────
  const parseStart = Date.now();
  log.debug({ action: 'service.parse.start' });

  let bankParsed: Awaited<ReturnType<typeof parseWorkbook>>;
  let qboParsed: Awaited<ReturnType<typeof parseWorkbook>>;
  try {
    [bankParsed, qboParsed] = await Promise.all([
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
        source: 'qbo',
        sourceFileId: sourceFileIds?.qbo,
        fileName: qboFile.originalname,
        mimeType: qboFile.mimetype,
        sizeBytes: qboFile.size,
        buffer: qboFile.buffer,
        config: config.qbo,
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
    qboRawRows: qboParsed.rawRows.length,
    bankWorksheet: bankParsed.sourceFile.worksheetName,
    qboWorksheet: qboParsed.sourceFile.worksheetName,
  });

  const sourceFiles = [bankParsed.sourceFile, qboParsed.sourceFile] as const;
  const rawRows = [...bankParsed.rawRows, ...qboParsed.rawRows];

  if (lifecycleStore) {
    await lifecycleStore.persistParsedRows(runId, [...sourceFiles], rawRows);
  }

  // Log first few raw rows at debug level for traceability
  if (process.env.DEBUG_RECONCILIATION === 'true') {
    log.debug({
      action: 'service.parse.bank.sample',
      rows: bankParsed.rawRows.slice(0, 5).map((r) => ({ line: r.lineNumber, raw: r.rawValues })),
    });
    log.debug({
      action: 'service.parse.qbo.sample',
      rows: qboParsed.rawRows.slice(0, 5).map((r) => ({ line: r.lineNumber, raw: r.rawValues })),
    });
  }

  // ── 3. Core reconciliation pipeline ───────────────────────────────────────
  const reconStart = Date.now();
  log.debug({
    action: 'service.reconciliation.pipeline.start',
    totalRawRows: bankParsed.rawRows.length + qboParsed.rawRows.length,
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
    normalizedTransactions = normalizeTransactions(runId, rawRows, config);
    appendAuditEvent('reconciliation.normalize.completed', {
      transactionCount: normalizedTransactions.length,
    });

    if (lifecycleStore) {
      await lifecycleStore.persistNormalizedRows(runId, normalizedTransactions);
    }

    matching = reconcileMatches(normalizedTransactions, config.matching);
    appendAuditEvent('reconciliation.match.completed', {
      matchResultCount: matching.matchResults.length,
      groupedMatchResultCount: matching.groupedMatchResults.length,
      probableMatchCount: matching.probableMatches.length,
    });

    if (lifecycleStore) {
      await lifecycleStore.persistMatchingArtifacts({
        jobId: runId,
        matchResults: matching.matchResults,
        probableMatches: matching.probableMatches,
        groupedMatchResults: matching.groupedMatchResults,
      });
    }

    exceptionOutput = classifyExceptions({
      runId,
      sourceFiles: [...sourceFiles],
      normalizedTransactions,
      matchResults: matching.matchResults,
      unmatchedBankTransactionIds: matching.unmatchedBankTransactionIds,
      unmatchedQboTransactionIds: matching.unmatchedQboTransactionIds,
      duplicateTransactionIds: matching.duplicateTransactionIds,
      reporting: config.reporting,
      matching: config.matching,
      reconciliationFrequency,
    });
    appendAuditEvent('reconciliation.classify.completed', {
      exceptionCount: exceptionOutput.exceptions.length,
    });

    summary = buildSummaryMetrics(
      normalizedTransactions,
      matching.matchResults,
      exceptionOutput.exceptions,
    );

    if (lifecycleStore) {
      await lifecycleStore.persistReviewArtifacts({
        jobId: runId,
        exceptions: exceptionOutput.exceptions,
        reviewerObservations: exceptionOutput.reviewerObservations,
        summary,
      });
    }

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
    missingFromQBO: summary.missingFromQBO,
    duplicates: summary.duplicates,
  });

  log.info({ action: 'service.reconciliation.done', runId, totalDurationMs: Date.now() - t0 });

  if (lifecycleStore) {
    await lifecycleStore.persistExportAndFinalize({
      jobId: runId,
      outputWorkbook,
      completedAt: new Date().toISOString(),
      auditEvents,
    });
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
