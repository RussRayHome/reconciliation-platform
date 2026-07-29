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
});
