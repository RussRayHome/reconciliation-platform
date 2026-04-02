import {
  defaultReconciliationConfig,
  resolveReconciliationConfig,
  sampleAccountOverrides,
} from '@recon/config';
import { parseWorkbook, runReconciliation } from '@recon/core';

import type { ReconciliationRun } from '@recon/domain';
import pino from 'pino';
import { randomUUID } from 'node:crypto';

// Module-level logger used for service-layer tracing outside HTTP context.
// When called from an HTTP route, call-site logs via request.log supplement these.
const serviceLogger = pino({
  name: 'reconciliation-service',
  level: process.env.LOG_LEVEL ?? 'info',
});

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ExecuteReconciliationInput {
  correlationId: string;
  bankFile: UploadedFile;
  qboFile: UploadedFile;
  accountIdentifier?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
  periodLabel?: string;
}

export const executeReconciliation = async ({
  correlationId,
  bankFile,
  qboFile,
  accountIdentifier,
  reconciliationFrequency,
  periodLabel,
}: ExecuteReconciliationInput): Promise<ReconciliationRun> => {
  const log = serviceLogger.child({ correlationId, accountIdentifier });
  const t0 = Date.now();

  log.info({ action: 'service.reconciliation.start', bankFile: bankFile.originalname, qboFile: qboFile.originalname, bankSizeBytes: bankFile.size, qboSizeBytes: qboFile.size });

  // ── 1. Config resolution ───────────────────────────────────────────────────
  const config = resolveReconciliationConfig(accountIdentifier, sampleAccountOverrides) ??
    defaultReconciliationConfig;
  log.debug({
    action: 'service.config.resolved',
    accountIdentifier,
    dateToleranceDays: config.matching.dateToleranceDays,
    timingDifferenceDays: config.matching.timingDifferenceDays,
    bankHeaderRow: config.bank.headerRow,
    qboHeaderRow: config.qbo.headerRow,
  });

  const runId = randomUUID();
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
        fileName: bankFile.originalname,
        mimeType: bankFile.mimetype,
        sizeBytes: bankFile.size,
        buffer: bankFile.buffer,
        config: config.bank,
      }),
      parseWorkbook({
        source: 'qbo',
        fileName: qboFile.originalname,
        mimeType: qboFile.mimetype,
        sizeBytes: qboFile.size,
        buffer: qboFile.buffer,
        config: config.qbo,
      }),
    ]);
  } catch (parseError) {
    log.error({ action: 'service.parse.error', err: parseError instanceof Error ? { message: parseError.message, stack: parseError.stack } : parseError });
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

  // Log first few raw rows at debug level for traceability
  if (process.env.DEBUG_RECONCILIATION === 'true') {
    log.debug({ action: 'service.parse.bank.sample', rows: bankParsed.rawRows.slice(0, 5).map(r => ({ line: r.lineNumber, raw: r.rawValues })) });
    log.debug({ action: 'service.parse.qbo.sample', rows: qboParsed.rawRows.slice(0, 5).map(r => ({ line: r.lineNumber, raw: r.rawValues })) });
  }

  // ── 3. Core reconciliation pipeline ───────────────────────────────────────
  const reconStart = Date.now();
  log.debug({ action: 'service.reconciliation.pipeline.start', totalRawRows: bankParsed.rawRows.length + qboParsed.rawRows.length });

  let output: Awaited<ReturnType<typeof runReconciliation>>;
  try {
    output = await runReconciliation({
      runId,
      correlationId,
      sourceFiles: [bankParsed.sourceFile, qboParsed.sourceFile],
      rawRows: [...bankParsed.rawRows, ...qboParsed.rawRows],
      config,
      accountIdentifier,
      reconciliationFrequency,
      periodLabel,
    });
  } catch (reconError) {
    log.error({ action: 'service.reconciliation.pipeline.error', err: reconError instanceof Error ? { message: reconError.message, stack: reconError.stack } : reconError });
    throw reconError;
  }

  log.info({
    action: 'service.reconciliation.pipeline.completed',
    durationMs: Date.now() - reconStart,
    normalizedTransactions: output.normalizedTransactions.length,
    matchResults: output.matchResults.length,
    probableMatches: output.probableMatches.length,
    exceptions: output.exceptions.length,
    exactMatches: output.summary.exactMatches,
    timingDifferences: output.summary.timingDifferences,
    dataQualityIssues: output.summary.dataQualityIssues,
    missingFromBank: output.summary.missingFromBank,
    missingFromQBO: output.summary.missingFromQBO,
    duplicates: output.summary.duplicates,
  });

  log.info({ action: 'service.reconciliation.done', runId, totalDurationMs: Date.now() - t0 });

  return {
    id: runId,
    correlationId,
    accountIdentifier,
    reconciliationFrequency,
    periodLabel,
    status: 'Completed',
    startedAt: new Date(t0).toISOString(),
    completedAt: new Date().toISOString(),
    sourceFiles: [bankParsed.sourceFile, qboParsed.sourceFile],
    rawRows: [...bankParsed.rawRows, ...qboParsed.rawRows],
    normalizedTransactions: output.normalizedTransactions,
    matchResults: output.matchResults,
    probableMatches: output.probableMatches,
    exceptions: output.exceptions,
    summary: output.summary,
    reviewerObservations: output.reviewerObservations,
    outputWorkbook: output.outputWorkbook,
    auditEvents: output.auditEvents,
  };
};
