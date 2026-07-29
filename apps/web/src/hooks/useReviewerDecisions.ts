import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReviewerDecision, ReviewerDecisionOutcome } from '@recon/domain';

import { saveReviewerDecisionRequest } from '../lib/api';

/** The three triage actions a reviewer can take on an exception. */
export type DecisionAction = 'accept' | 'reject' | 'research';

const outcomeByAction: Record<DecisionAction, ReviewerDecisionOutcome> = {
  accept: 'ConfirmedException',
  reject: 'DismissedException',
  research: 'ResearchException',
};

/** Maps a persisted outcome back to the triage action it represents (exception targets only). */
export const actionByOutcome: Partial<Record<ReviewerDecisionOutcome, DecisionAction>> = {
  ConfirmedException: 'accept',
  DismissedException: 'reject',
  ResearchException: 'research',
};

type DecisionMap = Record<string, ReviewerDecision>;

export type UseReviewerDecisionsResult = {
  decisionByTargetId: DecisionMap;
  decisions: ReviewerDecision[];
  reviewedCount: number;
  error: string | null;
  pendingTargetId: string | null;
  decide: (targetId: string, action: DecisionAction, notes?: string) => void;
  clearError: () => void;
};

/**
 * Manages reviewer decisions for the exceptions of a run: seeds from the run report,
 * applies optimistic updates with rollback, and persists through the reviewer-decision endpoint.
 */
export const useReviewerDecisions = (
  runId: string | null,
  initialDecisions: ReviewerDecision[] | undefined,
): UseReviewerDecisionsResult => {
  const [decisionByTargetId, setDecisionByTargetId] = useState<DecisionMap>({});
  const [error, setError] = useState<string | null>(null);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const seededRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (runId === null || seededRunIdRef.current === runId) {
      return;
    }

    seededRunIdRef.current = runId;

    const seed: DecisionMap = {};
    for (const decision of initialDecisions ?? []) {
      if (decision.targetType === 'ExceptionItem') {
        seed[decision.targetId] = decision;
      }
    }

    setDecisionByTargetId(seed);
    setError(null);
    setPendingTargetId(null);
  }, [runId, initialDecisions]);

  const decide = useCallback(
    (targetId: string, action: DecisionAction, notes?: string): void => {
      if (runId === null) {
        return;
      }

      const outcome = outcomeByAction[action];
      const trimmedNotes = notes?.trim() ? notes.trim() : undefined;
      const timestamp = new Date().toISOString();

      let previous: ReviewerDecision | undefined;

      setDecisionByTargetId((current) => {
        previous = current[targetId];

        const optimistic: ReviewerDecision = {
          id: previous?.id ?? `optimistic-${targetId}`,
          runId,
          targetType: 'ExceptionItem',
          targetId,
          outcome,
          notes: trimmedNotes,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };

        return { ...current, [targetId]: optimistic };
      });
      setPendingTargetId(targetId);
      setError(null);

      void saveReviewerDecisionRequest(runId, {
        targetType: 'ExceptionItem',
        targetId,
        outcome,
        notes: trimmedNotes,
      })
        .then((saved) => {
          setDecisionByTargetId((current) => ({ ...current, [targetId]: saved }));
        })
        .catch((caught: unknown) => {
          setDecisionByTargetId((current) => {
            const next = { ...current };

            if (previous) {
              next[targetId] = previous;
            } else {
              delete next[targetId];
            }

            return next;
          });
          setError(
            caught instanceof Error ? caught.message : 'Unable to save the reviewer decision.',
          );
        })
        .finally(() => {
          setPendingTargetId((current) => (current === targetId ? null : current));
        });
    },
    [runId],
  );

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  const decisions = Object.values(decisionByTargetId);

  return {
    decisionByTargetId,
    decisions,
    reviewedCount: decisions.length,
    error,
    pendingTargetId,
    decide,
    clearError,
  };
};
