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
});
