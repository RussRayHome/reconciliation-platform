import type { MatchingConfigVersion } from '@recon/domain';

import { formatShortDate } from '../lib/format';
import type { RuleChange } from '../lib/ruleVersionState';
import { RuleChangeList } from './RuleChangeList';

/**
 * Screen 13e — a rejected rule draft, back with its editor (UI-12, #451).
 *
 * The pathway this closes: 2a submits and 2b approves, and **nothing told the editor when a draft
 * came back.** `computeRuleVersionHeaderState` did not handle `REJECTED` at all, so a returned
 * draft rendered an ordinary rules screen — the author had to notice the status pill to learn
 * their change had been declined, and the reason lived only in an audit record.
 *
 * Two things are deliberately NOT built from the mock:
 *
 * 1. **Per-change "accepted in the note" / "not mentioned" labels.** The mock marks each changed
 *    field with whether the approver's prose accepted it. That cannot be derived — it would mean
 *    parsing free text and asserting an approver's intent they never recorded structurally.
 *    Guessing wrong here puts words in a controller's mouth inside an audit trail, so the note is
 *    shown verbatim and the reader draws the conclusion.
 * 2. **The reopen and discard actions.** Both need endpoints that do not exist yet. Offering
 *    buttons that cannot act is the defect class this codebase keeps hitting, so the panel states
 *    the numbering rule and leaves the action to the issue that builds it.
 */
export function RuleDraftRejectedPanel({
  rejected,
  active,
  nextVersionNumber,
  changes,
}: Readonly<{
  rejected: MatchingConfigVersion;
  active: MatchingConfigVersion | null;
  /** The next unallocated version number — never `rejected.versionNumber + 1`; see below. */
  nextVersionNumber: number;
  changes: readonly RuleChange[];
}>) {
  return (
    <section
      className="rule-draft-rejected"
      aria-label={`Version ${rejected.versionNumber} was rejected`}
    >
      <header className="rule-draft-rejected__head">
        <h3>v{rejected.versionNumber} was rejected</h3>
        {/* `--attention` is the only coloured pill patterns/badges.css defines (decision 23: two
            variants and only two). This read `badge--negative`, which is not a class anywhere in
            the tree, so the rejection pill silently rendered neutral -- the one badge on the screen
            that had to be legible as bad looked identical to the ACTIVE one beside it. */}
        <span className="badge badge--attention">v{rejected.versionNumber} · REJECTED</span>
        {active ? <span className="badge">v{active.versionNumber} · ACTIVE</span> : null}
      </header>

      {/* A DB CHECK sets rejectionNote, rejectedBy and rejectedAt together or not at all, so a
          rejection cannot reach this panel without its reason. The fallbacks below are for
          versions rejected before changeset 0080, which have no truthful answer -- stating that
          is better than printing an empty quote attributed to nobody. */}
      <p className="rule-draft-rejected__attribution">
        Rejected by <strong>{rejected.rejectedBy ?? 'an approver'}</strong>
        {rejected.rejectedAt ? ` · ${formatShortDate(rejected.rejectedAt)}` : null}
      </p>

      {rejected.rejectionNote ? (
        <blockquote className="rule-draft-rejected__note">{rejected.rejectionNote}</blockquote>
      ) : (
        <p className="rule-draft-rejected__note rule-draft-rejected__note--absent">
          No reason was recorded. Versions rejected before the reason became mandatory have none,
          and one has not been invented here.
        </p>
      )}

      <div className="rule-draft-rejected__numbering">
        <span className="eyebrow">If you reopen this change</span>
        <p>
          It reopens as <strong>v{nextVersionNumber}</strong>, not as v{rejected.versionNumber}.{' '}
          <strong>A rejected version keeps its number and is never reused</strong> — the audit trail
          has to keep showing what v{rejected.versionNumber} proposed and why it was declined.
          {nextVersionNumber > rejected.versionNumber + 1
            ? ` Versions v${rejected.versionNumber + 1}–v${nextVersionNumber - 1} are already allocated.`
            : null}
        </p>
      </div>

      <div className="rule-draft-rejected__changes">
        <span className="eyebrow">What this draft proposed</span>
        <RuleChangeList changes={changes} emptyLabel="This draft changed no variance settings." />
        {/* Reopening carries every change forward, including ones the approver did not object to.
            The editor drops the rejected one rather than rebuilding the rest from memory -- which
            is what made a rejection expensive enough to discourage using the pathway at all. */}
        {changes.length > 1 ? (
          <p className="rule-draft-rejected__carry">
            Reopening carries all {changes.length} changes forward, so you can drop the one that was
            rejected rather than rebuild the others from memory.
          </p>
        ) : null}
      </div>
    </section>
  );
}
