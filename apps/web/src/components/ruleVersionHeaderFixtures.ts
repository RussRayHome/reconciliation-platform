import type { MatchingConfigVersion } from '@recon/domain';

import { computeRuleVersionHeaderState, type RuleVersionHeaderState } from '../lib/ruleVersionState';

const ACTIVE_VERSION: MatchingConfigVersion = {
  id: 'mcv-active-7',
  organizationId: 'org-1',
  versionNumber: 7,
  status: 'ACTIVE',
  varianceOverrides: { wireFeeTolerance: 500 },
  createdBy: 'mortega',
  createdAt: '2026-08-01T00:00:00.000Z',
  publishedBy: 'M. Ortega',
  publishedAt: '2026-08-04T00:00:00.000Z',
  effectiveAt: '2026-08-01T00:00:00.000Z',
  pendingApprovalOwner: null,
  draftReason: null,
  rejectionNote: null,
  rejectedBy: null,
  rejectedAt: null,
};

const DRAFT_VERSION: MatchingConfigVersion = {
  ...ACTIVE_VERSION,
  id: 'mcv-draft-8',
  versionNumber: 8,
  status: 'DRAFT',
  publishedBy: null,
  publishedAt: null,
  effectiveAt: null,
  pendingApprovalOwner: 'VP Finance',
  draftReason: null,
  rejectionNote: null,
  rejectedBy: null,
  rejectedAt: null,
};

const SUPERSEDED_VERSION: MatchingConfigVersion = {
  ...ACTIVE_VERSION,
  id: 'mcv-superseded-6',
  versionNumber: 6,
  status: 'SUPERSEDED',
};

export interface RuleVersionHeaderFixture {
  name: string;
  state: RuleVersionHeaderState;
  viewingVersion: MatchingConfigVersion | null;
  canAdjustVarianceDefaults: boolean;
}

const buildFixture = (
  name: string,
  input: {
    viewingVersion: MatchingConfigVersion | null;
    canAdjustVarianceDefaults: boolean;
    overridesAppliedToEngine: boolean;
  },
): RuleVersionHeaderFixture => ({
  name,
  state: computeRuleVersionHeaderState(input),
  viewingVersion: input.viewingVersion,
  canAdjustVarianceDefaults: input.canAdjustVarianceDefaults,
});

/**
 * One named fixture per rules-screen state, each derived through the real
 * `computeRuleVersionHeaderState` (not a hand-typed `state` value) so a fixture can't silently
 * drift from what the app would actually compute. This is this repo's stand-in for Storybook
 * (not installed anywhere in the monorepo) — the mechanism by which all five states are
 * "reachable without hand-editing state": import this array and render
 * `<RuleVersionHeader {...fixture} />` for any of them, in a test or a future gallery page.
 */
export const RULE_VERSION_HEADER_FIXTURES: RuleVersionHeaderFixture[] = [
  buildFixture('admin-editable', {
    viewingVersion: ACTIVE_VERSION,
    canAdjustVarianceDefaults: true,
    overridesAppliedToEngine: true,
  }),
  buildFixture('read-only', {
    viewingVersion: ACTIVE_VERSION,
    canAdjustVarianceDefaults: false,
    overridesAppliedToEngine: true,
  }),
  buildFixture('draft-pending', {
    viewingVersion: DRAFT_VERSION,
    canAdjustVarianceDefaults: true,
    overridesAppliedToEngine: true,
  }),
  buildFixture('not-applied', {
    viewingVersion: ACTIVE_VERSION,
    canAdjustVarianceDefaults: true,
    overridesAppliedToEngine: false,
  }),
  buildFixture('superseded', {
    viewingVersion: SUPERSEDED_VERSION,
    canAdjustVarianceDefaults: true,
    overridesAppliedToEngine: true,
  }),
];
