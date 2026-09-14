import { describe, expect, it } from 'vitest';

import type { MatchingConfigVersion, RuleVersionsResponse } from '@recon/domain';

import {
  computeRuleVersionHeaderState,
  nextFreeVersionNumber,
  selectRejectedDraft,
} from './ruleVersionState';

const version = (status: MatchingConfigVersion['status']): MatchingConfigVersion =>
  ({ id: 'v', versionNumber: 1, status, varianceOverrides: {} }) as MatchingConfigVersion;

const compute = (
  viewingVersion: MatchingConfigVersion | null,
  {
    canAdjustVarianceDefaults = true,
    overridesAppliedToEngine = true,
  }: { canAdjustVarianceDefaults?: boolean; overridesAppliedToEngine?: boolean } = {},
) =>
  computeRuleVersionHeaderState({
    viewingVersion,
    canAdjustVarianceDefaults,
    overridesAppliedToEngine,
  });

/**
 * These states had no coverage before 13e (#451) added `draft-rejected`, so the precedence they
 * encode was only documented in a comment. The ordering is load-bearing: the point-in-time
 * statuses describe *which version is being looked at*, which is true regardless of the reader's
 * role or whether the engine applies overrides at all.
 */
describe('computeRuleVersionHeaderState', () => {
  it('reports a rejected version as rejected', () => {
    expect(compute(version('REJECTED'))).toBe('draft-rejected');
  });

  /**
   * The regression 13e exists to fix. Before REJECTED was handled it fell through to the engine
   * and role checks, so an editor opening their returned draft saw an ordinary rules screen with
   * no sign it had been declined.
   */
  it('reports rejection even when overrides do not reach the engine', () => {
    expect(compute(version('REJECTED'), { overridesAppliedToEngine: false })).toBe(
      'draft-rejected',
    );
  });

  it('reports rejection to a reader who cannot edit', () => {
    expect(compute(version('REJECTED'), { canAdjustVarianceDefaults: false })).toBe(
      'draft-rejected',
    );
  });

  it('keeps the other point-in-time statuses ahead of role and engine state', () => {
    expect(compute(version('SUPERSEDED'), { overridesAppliedToEngine: false })).toBe('superseded');
    expect(compute(version('DRAFT'), { canAdjustVarianceDefaults: false })).toBe('draft-pending');
  });

  it('falls back to NOT APPLIED before the role split', () => {
    expect(compute(version('ACTIVE'), { overridesAppliedToEngine: false })).toBe('not-applied');
    expect(compute(null, { overridesAppliedToEngine: false })).toBe('not-applied');
  });

  it('splits on role once a live version is applied', () => {
    expect(compute(version('ACTIVE'))).toBe('admin-editable');
    expect(compute(version('ACTIVE'), { canAdjustVarianceDefaults: false })).toBe('read-only');
  });
});

const response = (over: Partial<RuleVersionsResponse> = {}): RuleVersionsResponse => ({
  active: null,
  draft: null,
  history: [],
  overridesAppliedToEngine: true,
  ...over,
});

const numbered = (
  versionNumber: number,
  status: MatchingConfigVersion['status'],
): MatchingConfigVersion => ({ ...version(status), versionNumber, id: `v-${versionNumber}` });

describe('selectRejectedDraft', () => {
  it('surfaces a rejected version, which draft ?? active never could', () => {
    const found = selectRejectedDraft(response({ history: [numbered(13, 'REJECTED')] }));

    expect(found?.versionNumber).toBe(13);
  });

  // The editor has already acted on the rejection; the live submission is what they came for.
  it('stands down once a new draft is pending', () => {
    const found = selectRejectedDraft(
      response({ draft: numbered(16, 'DRAFT'), history: [numbered(13, 'REJECTED')] }),
    );

    expect(found).toBeNull();
  });

  it('offers the newest rejection when there has been more than one', () => {
    const found = selectRejectedDraft(
      response({ history: [numbered(13, 'REJECTED'), numbered(17, 'REJECTED')] }),
    );

    expect(found?.versionNumber).toBe(17);
  });

  it('ignores superseded history', () => {
    expect(selectRejectedDraft(response({ history: [numbered(11, 'SUPERSEDED')] }))).toBeNull();
  });
});

describe('nextFreeVersionNumber', () => {
  /**
   * The rule 13e exists to state: a rejected version keeps its number forever, so the next draft
   * takes the next FREE number, which is not rejected + 1 when later drafts already hold those.
   */
  it('skips numbers already allocated above the rejected one', () => {
    const next = nextFreeVersionNumber(
      response({
        active: numbered(12, 'ACTIVE'),
        history: [numbered(13, 'REJECTED'), numbered(14, 'SUPERSEDED'), numbered(15, 'SUPERSEDED')],
      }),
    );

    expect(next).toBe(16);
  });

  it('counts the pending draft too, so a resubmission never collides', () => {
    expect(nextFreeVersionNumber(response({ draft: numbered(20, 'DRAFT') }))).toBe(21);
  });

  it('starts at 1 when nothing has been created', () => {
    expect(nextFreeVersionNumber(response())).toBe(1);
    expect(nextFreeVersionNumber(null)).toBe(1);
  });
});
