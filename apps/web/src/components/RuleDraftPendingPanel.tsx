import type { MatchingConfigVersion } from '@recon/domain';

import { formatShortDate } from '../lib/format';
import type { RuleChange } from '../lib/ruleVersionState';
import { RuleChangeList } from './RuleChangeList';

/**
 * Screen 2b — the approver sheet, the half of it that states *what is being decided* (UI-5, #404).
 *
 * The replay estimate (ADR-0018, #533) already told an approver what a draft would have done to a
 * closed period. It never told them what the draft actually changes. The screen's own banner
 * claimed otherwise -- "Reviewing draft vN against the active version" -- while rendering no
 * comparison at all, so the one sentence on the screen that promised a diff was the sentence that
 * did not deliver one.
 *
 * The diff itself was not missing: `diffVarianceOverrides` shipped with 13e (#451) and was wired
 * only to the rejection path. This renders it on the path where a decision is still open.
 *
 * **No approve or reject control is offered here.** Those live on the approvals inbox, where the
 * row carries its claim state and where the segregation-of-duty CHECK (changeset 0042) refuses a
 * self-approval. A second decision surface on the rules screen would present the same decision
 * twice with only one of them able to say who had claimed it.
 */
export function RuleDraftPendingPanel({
  draft,
  active,
  changes,
}: Readonly<{
  draft: MatchingConfigVersion;
  active: MatchingConfigVersion | null;
  changes: readonly RuleChange[];
}>) {
  return (
    <section
      className="rule-draft-pending"
      aria-label={`Version ${draft.versionNumber} is waiting for approval`}
    >
      {/* No status badge and no "waiting on" line here: `RuleVersionHeader` directly above already
          renders both for the version being viewed. Repeating them put two identical DRAFT pills
          on one screen -- which is how the duplication was caught, by `RuleVersionHeader`'s own
          test finding two nodes where it expected one. */}
      <header className="rule-draft-pending__head">
        <h3>
          v{draft.versionNumber} proposed
          {active ? ` against v${active.versionNumber}` : ''}
        </h3>
      </header>

      {/* The header states who the draft is waiting ON. It never states who it came FROM, and an
          approver checking a change needs to know whose it is -- not least because the
          segregation-of-duty CHECK will refuse the decision if that name is their own. */}
      <p className="rule-draft-pending__attribution">
        Proposed by <strong>{draft.createdBy}</strong> · {formatShortDate(draft.createdAt)}
      </p>

      {/* The API has required a reason on draft creation since #404; nullable here only for
          versions created before changeset 0080, which have no truthful answer. Stating that is
          better than printing an empty quote attributed to the proposer. */}
      {draft.draftReason ? (
        <blockquote className="rule-draft-pending__reason">{draft.draftReason}</blockquote>
      ) : (
        <p className="rule-draft-pending__reason rule-draft-pending__reason--absent">
          No reason was recorded. Versions created before a reason became mandatory have none, and
          one has not been invented here.
        </p>
      )}

      <div className="rule-draft-pending__changes">
        <span className="eyebrow">What this draft proposes</span>
        <RuleChangeList changes={changes} emptyLabel="This draft changes no variance settings." />
      </div>

      {/* A rule change applies next run onward and never re-matches a closed period, so "what it
          would have done" is the only evidence of consequence anyone gets. Naming that here means
          the estimate below reads as evidence rather than as a forecast. */}
      <p className="rule-draft-pending__scope">
        A rule change applies to the next run onward — no closed period is re-matched. The estimate
        below is the only view of what it would have changed.
      </p>
    </section>
  );
}
