import { randomUUID } from 'node:crypto';

import {
  type CounterpartTrace,
  type ExceptionItem,
  type ExceptionRuleTrace,
  type MatchResult,
  type NormalizedTransaction,
  professionalErrorMessages,
  recommendedNextActionsByCategory,
  type ReportingConfig,
  type ReviewerObservation,
} from '@recon/domain';
import { inferTransactionKind } from './exceptionClassifierUtils';
import type {
  MatchResultClassification,
  MiscodingCandidate,
  TimingDifferenceCandidate,
} from './exceptionClassifierTypes';

export const buildDerivedMatchTrace = (
  result: MatchResult,
  matchedMiscodingCandidate: MiscodingCandidate | undefined,
  matchedTimingDifferenceCandidate: TimingDifferenceCandidate | undefined,
): {
  ruleId: string | undefined;
  ruleName: string;
  reason: string | undefined;
  evidence: string[];
} => {
  if (matchedMiscodingCandidate) {
    return {
      ruleId: 'likely-miscoding',
      ruleName: 'Likely Miscoding',
      reason:
        'A same-amount, near-date counterpart exists, but the descriptive or reference context conflicts materially.',
      evidence: [
        'Same amount was paired within the configured primary date window.',
        `Date difference is ${matchedMiscodingCandidate.dateDifference} day(s).`,
        `Narrative similarity score is ${matchedMiscodingCandidate.textSimilarity.toFixed(2)} and reference similarity score is ${matchedMiscodingCandidate.referenceSimilarity.toFixed(2)}.`,
        'The pair is better explained as a likely miscoding case than a simple date variance.',
      ],
    };
  }

  if (matchedTimingDifferenceCandidate) {
    return {
      ruleId: 'timing-difference-reclassification',
      ruleName: 'Timing Difference Reclassification',
      reason:
        'A same-amount, timing-compatible counterpart exists outside the primary date tolerance but within the timing-difference window.',
      evidence: [
        'Same amount was paired outside the primary date tolerance and within the timing-difference window.',
        `Date difference is ${matchedTimingDifferenceCandidate.dateDifference} day(s).`,
        `Narrative similarity score is ${matchedTimingDifferenceCandidate.textSimilarity.toFixed(2)} and reference similarity score is ${matchedTimingDifferenceCandidate.referenceSimilarity.toFixed(2)}.`,
        `Transaction kinds remain timing-compatible: bank=${inferTransactionKind(matchedTimingDifferenceCandidate.bankTransaction)}, gl=${inferTransactionKind(matchedTimingDifferenceCandidate.glTransaction)}.`,
      ],
    };
  }

  return {
    ruleId: result.ruleId,
    ruleName: result.ruleName,
    reason: result.reason,
    evidence: result.evidence,
  };
};

export const buildObservation = (
  runId: string,
  title: string,
  message: string,
  severity: ReviewerObservation['severity'],
  relatedTransactionIds: string[],
  category: ReviewerObservation['category'] = 'System',
): ReviewerObservation => ({
  id: randomUUID(),
  runId,
  category,
  title,
  message,
  severity,
  createdAt: new Date().toISOString(),
  relatedTransactionIds,
});

export const createException = (params: {
  runId: string;
  transaction: NormalizedTransaction;
  category: ExceptionItem['category'];
  reporting: ReportingConfig;
  relatedTransactionIds?: string[];
  likelyMatchingReference?: string;
  matchConfidence?: ExceptionItem['matchConfidence'];
  ruleTrace?: ExceptionRuleTrace;
  priorRuleTraces?: ExceptionItem['priorRuleTraces'];
  customMessage?: string;
}): ExceptionItem => ({
  id: randomUUID(),
  runId: params.runId,
  category: params.category,
  severity: params.reporting.severityByCategory[params.category],
  source: params.transaction.source,
  spreadsheetFileName: params.transaction.spreadsheetFileName,
  lineNumber: params.transaction.lineNumber,
  transactionDate: params.transaction.transactionDate ?? params.transaction.postingDate,
  amount: params.transaction.amount,
  errorMessage: params.customMessage ?? professionalErrorMessages[params.category],
  ruleTrace: params.ruleTrace,
  priorRuleTraces: params.priorRuleTraces,
  recommendedNextActions: recommendedNextActionsByCategory[params.category],
  likelyMatchingReference: params.likelyMatchingReference,
  matchConfidence: params.matchConfidence,
  normalizedComparisonTokens: params.transaction.normalizedComparisonTokens,
  // Default to the exception's own transaction rather than an empty array -- every ExceptionItem
  // belongs to exactly one transaction even when the caller doesn't pass a paired counterpart, so
  // relatedTransactionIds should always be a safe join key back to NormalizedTransaction.id.
  relatedTransactionIds: params.relatedTransactionIds ?? [params.transaction.id],
});

export const buildCounterpartTrace = (
  counterpart: NormalizedTransaction | undefined,
  transactionId?: string,
): CounterpartTrace | undefined => {
  if (!counterpart && !transactionId) {
    return undefined;
  }

  return {
    source: counterpart?.source,
    spreadsheetFileName: counterpart?.spreadsheetFileName,
    lineNumber: counterpart?.lineNumber,
    transactionId,
    amount: counterpart?.amount ?? null,
    transactionDate: counterpart?.transactionDate ?? counterpart?.postingDate ?? null,
  };
};

export const buildCounterpartTraces = (
  counterparts: Array<NormalizedTransaction | undefined>,
): CounterpartTrace[] => {
  const traces = counterparts
    .map((counterpart) => buildCounterpartTrace(counterpart, counterpart?.id))
    .filter((trace): trace is CounterpartTrace => trace !== undefined);

  return traces.filter(
    (trace, index) =>
      traces.findIndex(
        (candidate) =>
          candidate.transactionId === trace.transactionId &&
          candidate.source === trace.source &&
          candidate.spreadsheetFileName === trace.spreadsheetFileName &&
          candidate.lineNumber === trace.lineNumber,
      ) === index,
  );
};

export const buildExceptionRuleTrace = (
  ruleId: string,
  ruleName: string,
  reason: string,
  evidence: string[],
  counterpart?: CounterpartTrace,
  counterparts?: CounterpartTrace[],
): ExceptionRuleTrace => ({
  ruleId,
  ruleName,
  reason,
  evidence,
  counterpart,
  counterparts: counterparts?.length || !counterpart ? counterparts : [counterpart],
});

export const buildPriorRuleTraces = (
  sourceTrace: MatchResultClassification['sourceTrace'],
  derivedTrace: MatchResultClassification['derivedTrace'],
  counterpart?: CounterpartTrace,
  counterparts?: CounterpartTrace[],
): ExceptionRuleTrace[] | undefined => {
  if (!sourceTrace.ruleId || !sourceTrace.reason) {
    return undefined;
  }

  const isSameTrace =
    sourceTrace.ruleId === derivedTrace.ruleId &&
    sourceTrace.ruleName === derivedTrace.ruleName &&
    sourceTrace.reason === derivedTrace.reason &&
    sourceTrace.evidence.length === derivedTrace.evidence.length &&
    sourceTrace.evidence.every((entry, index) => entry === derivedTrace.evidence[index]);

  if (isSameTrace) {
    return undefined;
  }

  return [
    buildExceptionRuleTrace(
      sourceTrace.ruleId,
      sourceTrace.ruleName,
      sourceTrace.reason,
      sourceTrace.evidence,
      counterpart,
      counterparts,
    ),
  ];
};

export const buildPriorRuleTracesFromMatchResult = (
  result: MatchResult | undefined,
  derivedTrace: MatchResultClassification['derivedTrace'],
  counterpart?: CounterpartTrace,
  counterparts?: CounterpartTrace[],
): ExceptionRuleTrace[] | undefined => {
  if (!result) {
    return undefined;
  }

  return buildPriorRuleTraces(
    {
      ruleId: result.ruleId,
      ruleName: result.ruleName,
      reason: result.reason,
      evidence: result.evidence,
    },
    derivedTrace,
    counterpart,
    counterparts,
  );
};
