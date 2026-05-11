import { describe, expect, it } from 'vitest';

import { assertValidJobTransition, canTransitionJobState } from './stateMachine';

describe('reconciliation job state machine', () => {
  it('allows the expected forward processing transitions', () => {
    expect(canTransitionJobState('CREATED', 'FILE_REGISTERED')).toBe(true);
    expect(canTransitionJobState('FILE_REGISTERED', 'IMPORTING')).toBe(true);
    expect(canTransitionJobState('IMPORTING', 'IMPORTED')).toBe(true);
    expect(canTransitionJobState('REVIEW_READY', 'FINALIZED')).toBe(true);
  });

  it('rejects invalid transitions that skip lifecycle stages', () => {
    expect(() => assertValidJobTransition('CREATED', 'MATCHING')).toThrow(
      'Invalid reconciliation_job transition: CREATED -> MATCHING',
    );
    expect(canTransitionJobState('FINALIZED', 'MATCHING')).toBe(false);
  });

  it('includes both state names in the assertValidJobTransition error message', () => {
    expect(() => assertValidJobTransition('CANCELLED', 'CREATED')).toThrow(
      'Invalid reconciliation_job transition: CANCELLED -> CREATED',
    );
    expect(() => assertValidJobTransition('FINALIZED', 'REVIEW_READY')).toThrow(
      'Invalid reconciliation_job transition: FINALIZED -> REVIEW_READY',
    );
  });

  it('does not throw for valid transitions', () => {
    expect(() => assertValidJobTransition('CREATED', 'FILE_REGISTERED')).not.toThrow();
    expect(() => assertValidJobTransition('FAILED', 'RETRY_PENDING')).not.toThrow();
    expect(() => assertValidJobTransition('MATCHED', 'CANCELLED')).not.toThrow();
  });

  it('rejects all outbound transitions from the FINALIZED terminal state', () => {
    expect(canTransitionJobState('FINALIZED', 'CREATED')).toBe(false);
    expect(canTransitionJobState('FINALIZED', 'RETRY_PENDING')).toBe(false);
    expect(canTransitionJobState('FINALIZED', 'CANCELLED')).toBe(false);
    expect(canTransitionJobState('FINALIZED', 'FAILED')).toBe(false);
    expect(canTransitionJobState('FINALIZED', 'FINALIZED')).toBe(false);
  });

  it('rejects all outbound transitions from the CANCELLED terminal state', () => {
    expect(canTransitionJobState('CANCELLED', 'CREATED')).toBe(false);
    expect(canTransitionJobState('CANCELLED', 'RETRY_PENDING')).toBe(false);
    expect(canTransitionJobState('CANCELLED', 'FAILED')).toBe(false);
    expect(canTransitionJobState('CANCELLED', 'FINALIZED')).toBe(false);
  });

  it('allows FAILED to transition to RETRY_PENDING or CANCELLED but not directly to processing states', () => {
    expect(canTransitionJobState('FAILED', 'RETRY_PENDING')).toBe(true);
    expect(canTransitionJobState('FAILED', 'CANCELLED')).toBe(true);
    expect(canTransitionJobState('FAILED', 'IMPORTING')).toBe(false);
    expect(canTransitionJobState('FAILED', 'FINALIZED')).toBe(false);
  });

  it('allows RETRY_PENDING to re-enter any processing stage or cancel', () => {
    expect(canTransitionJobState('RETRY_PENDING', 'FILE_REGISTERED')).toBe(true);
    expect(canTransitionJobState('RETRY_PENDING', 'IMPORTING')).toBe(true);
    expect(canTransitionJobState('RETRY_PENDING', 'NORMALIZING')).toBe(true);
    expect(canTransitionJobState('RETRY_PENDING', 'MATCHING')).toBe(true);
    expect(canTransitionJobState('RETRY_PENDING', 'CANCELLED')).toBe(true);
    expect(canTransitionJobState('RETRY_PENDING', 'FINALIZED')).toBe(false);
  });

  it('allows all active processing states to transition to FAILED or CANCELLED', () => {
    const failableStates = [
      'CREATED', 'FILE_REGISTERED', 'IMPORTING', 'IMPORTED',
      'NORMALIZING', 'NORMALIZED', 'MATCHING', 'MATCHED',
      'EXCEPTIONS_IDENTIFIED', 'REVIEW_READY',
    ] as const;

    for (const state of failableStates) {
      expect(canTransitionJobState(state, 'FAILED')).toBe(true);
      expect(canTransitionJobState(state, 'CANCELLED')).toBe(true);
    }
  });

  it('does not allow RETRY_PENDING to transition directly to FAILED', () => {
    expect(canTransitionJobState('RETRY_PENDING', 'FAILED')).toBe(false);
  });
});
