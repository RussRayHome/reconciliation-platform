import type { ReviewerDecision, ReviewerDecisionOutcome } from '@recon/domain';
import { deleteReviewerDecisionRequest, saveReviewerDecisionRequest } from '../lib/api';
import { useCallback, useEffect, useRef, useState } from 'react';

/** The three triage actions a reviewer can take on an exception. */
export type DecisionAction = 'accept' | 'reject' | 'research';

const outcomeByAction: Record<DecisionAction, ReviewerDecisionOutcome> = {
  accept: 'ConfirmedException',
  reject: 'DismissedException',
  research: 'ResearchException',
};

const badgeByAction: Record<DecisionAction, string> = {
  accept: 'Accepted',
  reject: 'Rejected',
  research: 'Marked for research',
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
  resolvedCount: number;
  researchCount: number;
  error: string | null;
  pendingTargetId: string | null;
  lastChange: { targetId: string; label: string } | null;
  decide: (targetId: string, action: DecisionAction, notes?: string) => void;
  clearDecision: (targetId: string) => void;
  undoLastDecision: () => void;
  clearError: () => void;
};

/**
 * Manages reviewer decisions for the exceptions of a run: seeds from the run report,
 * applies optimistic updates with rollback, and persists through the reviewer-decision endpoint.
 */
export const useReviewerDecisions = (
  runId: string | null,
  initialDecisions: ReviewerDecision[] | undefined,
  exceptionIds?: ReadonlySet<string>,
): UseReviewerDecisionsResult => {
  const [decisionByTargetId, setDecisionByTargetId] = useState<DecisionMap>({});
  const [error, setError] = useState<string | null>(null);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const [lastChange, setLastChange] = useState<{ targetId: string; label: string } | null>(null);
  const lastChangeRef = useRef<{
    targetId: string;
    previous: ReviewerDecision | undefined;
  } | null>(null);
  const decisionsRef = useRef<DecisionMap>({});
  const seededRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    decisionsRef.current = decisionByTargetId;
  }, [decisionByTargetId]);

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
        lastChangeRef.current = { targetId, previous };

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
      setLastChange({ targetId, label: badgeByAction[action] });
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

  const clearDecision = useCallback(
    (targetId: string): void => {
      if (runId === null) {
        return;
      }

      const previous = decisionsRef.current[targetId];

      if (!previous) {
        return;
      }

      setDecisionByTargetId((current) => {
        const next = { ...current };
        delete next[targetId];
        return next;
      });

      lastChangeRef.current = { targetId, previous };
      setLastChange({ targetId, label: 'Cleared' });
      setPendingTargetId(targetId);
      setError(null);

      void deleteReviewerDecisionRequest(runId, targetId)
        .catch((caught: unknown) => {
          setDecisionByTargetId((current) => ({
            ...current,
            [targetId]: previous,
          }));
          setError(
            caught instanceof Error ? caught.message : 'Unable to clear the reviewer decision.',
          );
        })
        .finally(() => {
          setPendingTargetId((current) => (current === targetId ? null : current));
        });
    },
    [runId],
  );

  const undoLastDecision = useCallback((): void => {
    const change = lastChangeRef.current;

    if (!change) {
      return;
    }

    lastChangeRef.current = null;
    setLastChange(null);

    if (!change.previous) {
      clearDecision(change.targetId);
      return;
    }

    const action = actionByOutcome[change.previous.outcome];
    if (action) {
      decide(change.targetId, action, change.previous.notes);
    }
  }, [clearDecision, decide]);

  const decisions = Object.values(decisionByTargetId);
  // Only decisions on exceptions in the current run count toward progress; a stale decision
  // persisted against an id no longer present must never inflate the total.
  const relevantDecisions = exceptionIds
    ? decisions.filter((decision) => exceptionIds.has(decision.targetId))
    : decisions;
  const resolvedCount = relevantDecisions.filter(
    (decision) =>
      decision.outcome === 'ConfirmedException' || decision.outcome === 'DismissedException',
  ).length;
  const researchCount = relevantDecisions.filter(
    (decision) => decision.outcome === 'ResearchException',
  ).length;

  return {
    decisionByTargetId,
    decisions,
    resolvedCount,
    researchCount,
    error,
    pendingTargetId,
    lastChange,
    decide,
    clearDecision,
    undoLastDecision,
    clearError,
  };
};
