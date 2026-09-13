import type { ExceptionItem, ReviewerDecision } from '@recon/domain';

/**
 * Which reviewer outcomes close an exception (UI-11, #450).
 *
 * **`ResearchException` is deliberately absent.** "Needs research" records that someone looked and
 * could not decide — the break is still unexplained, so the item is still open. Treating it as
 * closed would let a period report itself settled on the strength of an admission that it is not.
 *
 * This mirrors the server's own rule exactly (`importRunStore.ts`'s `open_exception_count`, which
 * excludes the same two outcomes and no others). The two must agree: the export banner here and
 * the count on Runs home are the same claim made in two places, and a reader who sees them differ
 * has no way to tell which is lying.
 */
const TERMINAL_OUTCOMES = new Set(['ConfirmedException', 'DismissedException']);

/**
 * Exceptions with no terminal reviewer decision.
 *
 * Returned as the items rather than a count so a caller can say *which* — a bare number is enough
 * for a badge and not enough for anything that has to explain itself.
 */
export const openExceptions = (
  exceptions: readonly ExceptionItem[],
  decisions: readonly ReviewerDecision[],
): ExceptionItem[] => {
  const closed = new Set(
    decisions
      .filter(
        (decision) =>
          decision.targetType === 'ExceptionItem' && TERMINAL_OUTCOMES.has(decision.outcome),
      )
      .map((decision) => decision.targetId),
  );

  return exceptions.filter((exception) => !closed.has(exception.id));
};
