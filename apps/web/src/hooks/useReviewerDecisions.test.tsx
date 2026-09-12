// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { ReviewerDecision } from '@recon/domain';

import * as api from '../lib/api';
import { useReviewerDecisions } from './useReviewerDecisions';

const savedDecision: ReviewerDecision = {
  id: 'decision-1',
  runId: 'run-1',
  targetType: 'ExceptionItem',
  targetId: 'exception-1',
  outcome: 'ConfirmedException',
  notes: 'Looks valid',
  createdAt: '2026-03-31T00:00:00.000Z',
  updatedAt: '2026-03-31T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useReviewerDecisions', () => {
  it('seeds exception decisions from the run report', () => {
    const seed: ReviewerDecision = { ...savedDecision, targetId: 'exception-9' };
    const { result } = renderHook(() => useReviewerDecisions('run-1', [seed]));

    expect(result.current.resolvedCount).toBe(1);
    expect(result.current.decisionByTargetId['exception-9']).toEqual(seed);
  });

  it('counts only resolved decisions on current exceptions and never exceeds the exception count', () => {
    const staleResolved: ReviewerDecision = { ...savedDecision, targetId: 'stale-exception' };
    const research: ReviewerDecision = {
      ...savedDecision,
      id: 'decision-2',
      targetId: 'exception-1',
      outcome: 'ResearchException',
    };
    const resolved: ReviewerDecision = {
      ...savedDecision,
      id: 'decision-3',
      targetId: 'exception-2',
      outcome: 'DismissedException',
    };
    const exceptionIds = new Set(['exception-1', 'exception-2']);

    const { result } = renderHook(() =>
      useReviewerDecisions('run-1', [staleResolved, research, resolved], exceptionIds),
    );

    // stale-exception is excluded (not in the run) and research is not resolved.
    expect(result.current.resolvedCount).toBe(1);
    expect(result.current.researchCount).toBe(1);
    expect(result.current.resolvedCount).toBeLessThanOrEqual(exceptionIds.size);
  });

  it('optimistically records a decision and reconciles with the saved record', async () => {
    const spy = vi.spyOn(api, 'saveReviewerDecisionRequest').mockResolvedValue(savedDecision);

    const { result } = renderHook(() => useReviewerDecisions('run-1', []));

    act(() => {
      result.current.decide('exception-1', 'accept', 'Looks valid');
    });

    expect(result.current.decisionByTargetId['exception-1']?.outcome).toBe('ConfirmedException');

    await waitFor(() => {
      expect(result.current.decisionByTargetId['exception-1']?.id).toBe('decision-1');
    });

    expect(spy).toHaveBeenCalledWith('run-1', {
      targetType: 'ExceptionItem',
      targetId: 'exception-1',
      outcome: 'ConfirmedException',
      notes: 'Looks valid',
    });
  });

  it('rolls back and reports an error when persistence fails', async () => {
    vi.spyOn(api, 'saveReviewerDecisionRequest').mockRejectedValue(new Error('Server down.'));

    const { result } = renderHook(() => useReviewerDecisions('run-1', []));

    act(() => {
      result.current.decide('exception-1', 'reject');
    });

    expect(result.current.decisionByTargetId['exception-1']).toBeDefined();

    await waitFor(() => {
      expect(result.current.error).toBe('Server down.');
    });

    expect(result.current.decisionByTargetId['exception-1']).toBeUndefined();
    expect(result.current.resolvedCount).toBe(0);
  });

  it('clears a decision and undoes back to the previous outcome', async () => {
    vi.spyOn(api, 'saveReviewerDecisionRequest').mockResolvedValue(savedDecision);
    const deleteSpy = vi.spyOn(api, 'deleteReviewerDecisionRequest').mockResolvedValue(undefined);

    const { result } = renderHook(() => useReviewerDecisions('run-1', []));

    act(() => {
      result.current.decide('exception-1', 'accept', 'Looks valid');
    });
    await waitFor(() => {
      expect(result.current.decisionByTargetId['exception-1']?.id).toBe('decision-1');
    });

    act(() => {
      result.current.clearDecision('exception-1');
    });
    expect(result.current.decisionByTargetId['exception-1']).toBeUndefined();
    await waitFor(() => {
      // The target type is passed explicitly, not left to the request helper's default:
      // UI-10 (#449) gave this hook a second instance for ProbableMatch targets, and the
      // DELETE route keys on (runId, targetType, targetId) but answers 204 when nothing
      // matched -- so a wrong type here would clear nothing and still report success.
      expect(deleteSpy).toHaveBeenCalledWith('run-1', 'exception-1', 'ExceptionItem');
    });

    act(() => {
      result.current.undoLastDecision();
    });
    await waitFor(() => {
      expect(result.current.decisionByTargetId['exception-1']?.outcome).toBe('ConfirmedException');
    });
  });
});

// UI-10 (#449) gave this hook a second target type. A pairing is APPROVED or REJECTED, not
// CONFIRMED or DISMISSED -- and one run carries both kinds of decision at once, so the two
// instances must not read or overwrite each other's rows.
describe('useReviewerDecisions for probable matches (UI-10, #449)', () => {
  const matchDecision: ReviewerDecision = {
    id: 'decision-m1',
    runId: 'run-1',
    targetType: 'ProbableMatch',
    targetId: 'match-1',
    outcome: 'ApprovedMatch',
    createdAt: '2026-03-31T00:00:00.000Z',
    updatedAt: '2026-03-31T00:00:00.000Z',
  };

  it('seeds only its own target type, ignoring the exception decisions in the same run', () => {
    const { result } = renderHook(() =>
      useReviewerDecisions('run-1', [savedDecision, matchDecision], undefined, 'ProbableMatch'),
    );

    expect(result.current.decisionByTargetId['match-1']).toEqual(matchDecision);
    expect(result.current.decisionByTargetId['exception-1']).toBeUndefined();
    expect(result.current.resolvedCount).toBe(1);
  });

  it('records an approval rather than a confirmed exception', async () => {
    const saveSpy = vi
      .spyOn(api, 'saveReviewerDecisionRequest')
      .mockResolvedValue({ ...matchDecision, targetId: 'match-2' });
    const { result } = renderHook(() =>
      useReviewerDecisions('run-1', [], undefined, 'ProbableMatch'),
    );

    act(() => {
      result.current.decide('match-2', 'accept');
    });

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith('run-1', {
        targetType: 'ProbableMatch',
        targetId: 'match-2',
        outcome: 'ApprovedMatch',
        notes: undefined,
        finalCategory: undefined,
      });
    });
  });

  // The DELETE route keys on (runId, targetType, targetId) and answers 204 when nothing matched.
  // Sending the default ExceptionItem here would clear nothing, report success, and leave the
  // approval in the database while the screen showed it gone.
  it('clears against its own target type', async () => {
    const deleteSpy = vi.spyOn(api, 'deleteReviewerDecisionRequest').mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useReviewerDecisions('run-1', [matchDecision], undefined, 'ProbableMatch'),
    );

    act(() => {
      result.current.clearDecision('match-1');
    });

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('run-1', 'match-1', 'ProbableMatch');
    });
  });

  // The domain has no "research this pairing" outcome. Posting one would be rejected by the API
  // and surface as a save error the reviewer cannot act on, so the hook declines to send it.
  it('ignores research, which has no meaning for a pairing', () => {
    const saveSpy = vi.spyOn(api, 'saveReviewerDecisionRequest');
    const { result } = renderHook(() =>
      useReviewerDecisions('run-1', [], undefined, 'ProbableMatch'),
    );

    act(() => {
      result.current.decide('match-3', 'research');
    });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(result.current.decisionByTargetId['match-3']).toBeUndefined();
  });
});
