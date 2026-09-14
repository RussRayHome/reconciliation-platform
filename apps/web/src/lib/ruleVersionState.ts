import type { MatchingConfig, MatchingConfigVersion, RuleVersionsResponse } from '@recon/domain';

/**
 * The rejected version an editor should be shown when they open the rules screen (13e, #451).
 *
 * `viewingVersion` was `draft ?? active`, and a REJECTED version is neither — it lands in
 * `history`. So the one state the editor most needs to see was the one state unreachable from the
 * screen, which is why a rejection only ever surfaced in an audit record.
 *
 * A **pending draft outranks a rejection**: if the editor has already resubmitted, the live
 * submission is what they came to look at, and the older rejection is history they have acted on.
 * Only the newest rejection is offered — an editor who has been declined twice needs the current
 * decision, not the first one.
 */
export const selectRejectedDraft = (
  versions: RuleVersionsResponse | null,
): MatchingConfigVersion | null => {
  if (!versions || versions.draft) return null;
  return (
    versions.history
      .filter((version) => version.status === 'REJECTED')
      .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
  );
};

/**
 * The next unallocated version number.
 *
 * Taken across every known version rather than `rejected.versionNumber + 1`: a rejected version
 * keeps its number forever, and later drafts may already hold the numbers above it. Reusing one
 * would put two different proposals under the same name in the audit trail.
 */
export const nextFreeVersionNumber = (versions: RuleVersionsResponse | null): number => {
  const known = [versions?.active, versions?.draft, ...(versions?.history ?? [])].filter(
    (version): version is MatchingConfigVersion => Boolean(version),
  );
  return known.reduce((highest, version) => Math.max(highest, version.versionNumber), 0) + 1;
};

/** Which of the six rules-screen states the version header should render. */
export type RuleVersionHeaderState =
  | 'admin-editable'
  | 'read-only'
  | 'draft-pending'
  | 'draft-rejected'
  | 'not-applied'
  | 'superseded';

/**
 * Derives which of the six rules-screen states applies. Precedence: a version actively being
 * browsed wins first (SUPERSEDED/REJECTED/DRAFT are point-in-time views, independent of role or
 * engine wiring), then NOT APPLIED (editing the live ACTIVE version is pointless while overrides
 * don't reach the engine, even for an admin), then the plain role-based ADMIN·EDITABLE /
 * READ-ONLY split.
 *
 * `REJECTED` is checked with the other point-in-time statuses rather than left to fall through
 * (screen 13e, #451). Before this it fell through to NOT APPLIED or the role split, so an editor
 * opening their returned draft saw a normal rules screen and no sign it had been declined —
 * which is the gap 13e names: 2a submits and 2b approves, but nothing told the editor when a
 * draft came back.
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
  if (viewingVersion?.status === 'REJECTED') {
    return 'draft-rejected';
  }
  if (viewingVersion?.status === 'DRAFT') {
    return 'draft-pending';
  }
  if (!overridesAppliedToEngine) {
    return 'not-applied';
  }
  return canAdjustVarianceDefaults ? 'admin-editable' : 'read-only';
};

export interface RuleChange {
  metric: keyof MatchingConfig;
  label: string;
  from: number | undefined;
  to: number;
}

/**
 * What a proposed version changes, against the version in force.
 *
 * Only the proposal's own `varianceOverrides` are walked: a key absent from it is not a change,
 * and reading the union of both sides would report the active version's untouched settings as
 * though the proposal had reverted them.
 *
 * `proposed` is any version being compared to ACTIVE, not specifically a rejected one — it is the
 * same question on both sides of the pathway. 13e (#451) asks it of a draft that came back; 2b
 * (#404) asks it of a draft still awaiting a decision, which is the case that can still change an
 * outcome.
 */
export const diffVarianceOverrides = (
  proposed: MatchingConfigVersion,
  active: MatchingConfigVersion | null,
  labelFor: (metric: keyof MatchingConfig) => string,
): RuleChange[] =>
  (Object.keys(proposed.varianceOverrides) as Array<keyof MatchingConfig>)
    .map((metric) => ({
      metric,
      label: labelFor(metric),
      from: active?.varianceOverrides[metric],
      to: proposed.varianceOverrides[metric] as number,
    }))
    .filter((change) => change.from !== change.to);
