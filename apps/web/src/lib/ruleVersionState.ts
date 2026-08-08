import type { MatchingConfigVersion } from '@recon/domain';

/** Which of the five rules-screen states the version header should render. */
export type RuleVersionHeaderState =
  | 'admin-editable'
  | 'read-only'
  | 'draft-pending'
  | 'not-applied'
  | 'superseded';

/**
 * Derives which of the five rules-screen states applies. Precedence: a version actively being
 * browsed wins first (SUPERSEDED/DRAFT are point-in-time views, independent of role or engine
 * wiring), then NOT APPLIED (editing the live ACTIVE version is pointless while overrides don't
 * reach the engine, even for an admin), then the plain role-based ADMIN·EDITABLE / READ-ONLY
 * split.
 */
export const computeRuleVersionHeaderState = ({
  viewingVersion,
  canAdjustVarianceDefaults,
  overridesAppliedToEngine,
}: Readonly<{
  viewingVersion: MatchingConfigVersion | null;
  canAdjustVarianceDefaults: boolean;
  overridesAppliedToEngine: boolean;
}>): RuleVersionHeaderState => {
  if (viewingVersion?.status === 'SUPERSEDED') {
    return 'superseded';
  }
  if (viewingVersion?.status === 'DRAFT') {
    return 'draft-pending';
  }
  if (!overridesAppliedToEngine) {
    return 'not-applied';
  }
  return canAdjustVarianceDefaults ? 'admin-editable' : 'read-only';
};
