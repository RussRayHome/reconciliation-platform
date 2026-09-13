import { describe, expect, it } from 'vitest';

import type { ExceptionItem, ReviewerDecision } from '@recon/domain';

import { openExceptions } from './openExceptions';

const exception = (id: string): ExceptionItem => ({ id }) as ExceptionItem;

const decision = (
  targetId: string,
  outcome: ReviewerDecision['outcome'],
  targetType: ReviewerDecision['targetType'] = 'ExceptionItem',
): ReviewerDecision =>
  ({ id: `d-${targetId}`, targetId, targetType, outcome }) as ReviewerDecision;

describe('openExceptions', () => {
  it('closes an exception that was confirmed or dismissed', () => {
    const open = openExceptions(
      [exception('a'), exception('b'), exception('c')],
      [decision('a', 'ConfirmedException'), decision('b', 'DismissedException')],
    );

    expect(open.map((item) => item.id)).toEqual(['c']);
  });

  // The rule this module exists for. "Needs research" records that someone looked and could not
  // decide -- the break is still unexplained. Counting it as closed would let a period report
  // itself settled on the strength of an admission that it is not.
  it('leaves an exception open when the reviewer only marked it for research', () => {
    const open = openExceptions([exception('a')], [decision('a', 'ResearchException')]);

    expect(open.map((item) => item.id)).toEqual(['a']);
  });

  it('treats an undecided exception as open', () => {
    expect(openExceptions([exception('a')], [])).toHaveLength(1);
  });

  // One run carries decisions for pairings too (UI-10). A pairing approved under the same id must
  // not silently close an exception.
  it('ignores decisions recorded against another target type', () => {
    const open = openExceptions(
      [exception('a')],
      [decision('a', 'ApprovedMatch', 'ProbableMatch')],
    );

    expect(open.map((item) => item.id)).toEqual(['a']);
  });

  it('returns nothing when every exception is closed', () => {
    expect(
      openExceptions([exception('a')], [decision('a', 'ConfirmedException')]),
    ).toEqual([]);
  });

  // Mirrors importRunStore.ts's open_exception_count, which excludes exactly these two outcomes.
  // If the server rule ever widens, this is the test that should fail first.
  it('matches the server rule: exactly two outcomes close an exception', () => {
    const outcomes: ReviewerDecision['outcome'][] = [
      'ConfirmedException',
      'DismissedException',
      'ResearchException',
    ];
    const closedBy = outcomes.filter(
      (outcome) => openExceptions([exception('a')], [decision('a', outcome)]).length === 0,
    );

    expect(closedBy).toEqual(['ConfirmedException', 'DismissedException']);
  });
});
