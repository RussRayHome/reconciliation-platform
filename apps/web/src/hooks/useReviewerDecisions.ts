import type {
  ReviewerDecision,
  ReviewerDecisionOutcome,
  ReviewerDecisionTargetType,
} from '@recon/domain';
import { deleteReviewerDecisionRequest, saveReviewerDecisionRequest } from '../lib/api';
import { useCallback, useEffect, useRef, useState } from 'react';

/** The three triage actions a reviewer can take. `research` applies to exceptions only. */
export type DecisionAction = 'accept' | 'reject' | 'research';

/**
 * The same two verbs mean different things to different targets, so the outcome is looked up by
 * target type rather than assumed (UI-10, #449).
 *
 * An exception is CONFIRMED or DISMISSED -- a judgement about whether the break is real. A probable
 * match is APPROVED or REJECTED -- a judgement about whether the pairing holds. The domain has
 * always modelled both; only this hook assumed one.
 *
 * `research` is absent for match targets deliberately: the domain has no "research this pairing"
 * outcome, and inventing one here would write a value the API would reject.
 */
const outcomeByTargetAndAction: Record<
  ReviewerDecisionTargetType,
  Partial<Record<DecisionAction, ReviewerDecisionOutcome>>
> = {
  ExceptionItem: {
    accept: 'ConfirmedException',
    reject: 'DismissedException',
    research: 'ResearchException',
  },
  ProbableMatch: { accept: 'ApprovedMatch', reject: 'RejectedMatch' },
  AmbiguousReview: { accept: 'ApprovedMatch', reject: 'RejectedMatch' },
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
  /** Defaults to ExceptionItem so the triage call site is untouched; Runs home's probable-match
   * list passes 'ProbableMatch'. One run holds both kinds, so this is per-instance, not per-run. */
  targetType: ReviewerDecisionTargetType = 'ExceptionItem',
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
      if (decision.targetType === targetType) {
        seed[decision.targetId] = decision;
      }
    }

    setDecisionByTargetId(seed);
    setError(null);
    setPendingTargetId(null);
  }, [runId, initialDecisions, targetType]);

  const decide = useCallback(
    (targetId: string, action: DecisionAction, notes?: string): void => {
      if (runId === null) {
        return;
      }

      const outcome = outcomeByTargetAndAction[targetType][action];

      // No outcome for this pair means the caller offered an action this target does not support
      // -- 'research' on a match pairing, say. Refusing here beats posting a value the API would
      // reject and surfacing it as a save error the user cannot act on.
      if (!outcome) {
        return;
      }
      const trimmedNotes = notes?.trim() ? notes.trim() : undefined;
      const timestamp = new Date().toISOString();

      let previous: ReviewerDecision | undefined;

      setDecisionByTargetId((current) => {
        previous = current[targetId];
        lastChangeRef.current = { targetId, previous };

        const optimistic: ReviewerDecision = {
          id: previous?.id ?? `optimistic-${targetId}`,
          runId,
          targetType,
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
        targetType,
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
    // targetType is read inside, so a stale closure here would write decisions against the wrong
    // target type -- silently, and only for the second instance of this hook.
    [runId, targetType],
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

      // targetType is not optional here in practice: the request helper defaults it to
      // ExceptionItem, so omitting it would delete an exception's decision when a reviewer
      // clears a pairing's verdict -- and the optimistic removal would still read as success.
      void deleteReviewerDecisionRequest(runId, targetId, targetType)
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
    [runId, targetType],
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
  // "Resolved" means a terminal verdict for THIS target type -- Confirmed/Dismissed for an
  // exception, Approved/Rejected for a pairing. Derived from the same map `decide` writes from, so
  // the two cannot drift: a new outcome added there counts here automatically.
  const terminalOutcomes = new Set<ReviewerDecisionOutcome>(
    (['accept', 'reject'] as const)
      .map((action) => outcomeByTargetAndAction[targetType][action])
      .filter((outcome): outcome is ReviewerDecisionOutcome => outcome !== undefined),
  );
  const resolvedCount = relevantDecisions.filter((decision) =>
    terminalOutcomes.has(decision.outcome),
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
