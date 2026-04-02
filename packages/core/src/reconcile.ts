import type {
  AuditEvent,
  ReconciliationInput,
  ReconciliationOutput,
} from '@recon/domain';

import { buildSummaryMetrics } from './reporting/summary';
import { classifyExceptions } from './reporting/exceptionClassifier';
import { exportWorkbook } from './export/workbookExporter';
import { normalizeTransactions } from './normalization/transactions';
import { reconcileMatches } from './matching/engine';

export const runReconciliation = async (
  input: ReconciliationInput,
): Promise<ReconciliationOutput> => {
  let auditEvents: AuditEvent[] = [
    {
      timestamp: new Date().toISOString(),
      action: 'reconciliation.run.started',
      details: {
        runId: input.runId,
        correlationId: input.correlationId,
        sourceFileCount: input.sourceFiles.length,
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

  const normalizedTransactions = normalizeTransactions(input.runId, input.rawRows, input.config);
  appendAuditEvent('reconciliation.normalize.completed', {
    transactionCount: normalizedTransactions.length,
  });

  const matching = reconcileMatches(normalizedTransactions, input.config.matching);
  appendAuditEvent('reconciliation.match.completed', {
    matchResultCount: matching.matchResults.length,
    probableMatchCount: matching.probableMatches.length,
  });

  const exceptionOutput = classifyExceptions({
    runId: input.runId,
    sourceFiles: input.sourceFiles,
    normalizedTransactions,
    matchResults: matching.matchResults,
    unmatchedBankTransactionIds: matching.unmatchedBankTransactionIds,
    unmatchedQboTransactionIds: matching.unmatchedQboTransactionIds,
    duplicateTransactionIds: matching.duplicateTransactionIds,
    reporting: input.config.reporting,
    matching: input.config.matching,
    reconciliationFrequency: input.reconciliationFrequency,
  });
  appendAuditEvent('reconciliation.classify.completed', {
    exceptionCount: exceptionOutput.exceptions.length,
  });

  const summary = buildSummaryMetrics(
    normalizedTransactions,
    matching.matchResults,
    exceptionOutput.exceptions,
  );

  const outputWorkbook = await exportWorkbook({
    runId: input.runId,
    accountIdentifier: input.accountIdentifier,
    periodLabel: input.periodLabel,
    config: input.config,
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
    runId: input.runId,
    correlationId: input.correlationId,
    exactMatches: summary.exactMatches,
    unresolvedExposure: summary.unresolvedExposure,
  });

  return {
    normalizedTransactions,
    matchResults: matching.matchResults,
    probableMatches: matching.probableMatches,
    exceptions: exceptionOutput.exceptions,
    summary,
    reviewerObservations: exceptionOutput.reviewerObservations,
    outputWorkbook,
    auditEvents,
  };
};
