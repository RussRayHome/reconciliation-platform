import { Link } from 'react-router';

import type { SummaryMetrics } from '@recon/domain';

import { formatCurrencyWhole } from '../lib/format';
import { routePaths } from '../routes/routePaths';

/**
 * Screen 11b — Probable matches when a clean run left nothing to confirm (UI-10, #449).
 *
 * The screen this replaces said "No probable matches to review" and stopped. That reads as a
 * missing step to anyone about to close a period: an analyst cannot tell an empty queue from a
 * queue that failed to populate, and the difference decides whether they close or go looking.
 * So this states the three things that make emptiness *evidence*: what did happen instead (exact
 * and timing-accepted counts), that nothing is awaiting a decision, and why lowering the bar
 * would not produce candidates.
 *
 * **No percentage appears anywhere**, and that is the whole reason this does not copy the 11b
 * mock verbatim. The mock says "78–94% borderline, 95% and over high confidence" and offers a
 * "Threshold: 78%" control. `lib/matchConfidenceBands.ts` records the 2026-09-12 finding that
 * killed that: `MatchResult.score` is a rule-precedence rank whose non-exact values top out at
 * **0.87**, so a ≥95% band is permanently empty and a 0.78 cut would silently change which pairs
 * a reviewer sees. A number that looks like a probability and is not is worse than no number.
 */
export function ProbableMatchesEmptyState({ summary }: Readonly<{ summary: SummaryMetrics }>) {
  const figures: ReadonlyArray<{
    label: string;
    value: string;
    note: string;
    tone: 'neutral' | 'positive';
  }> = [
    {
      label: 'Candidates',
      value: '0',
      note: 'nothing scored into a band',
      tone: 'neutral',
    },
    {
      label: 'Exact',
      value: summary.exactMatches.toLocaleString(),
      note: 'identity match · never scored',
      tone: 'positive',
    },
    {
      label: 'Timing accepted',
      value: summary.timingDifferences.toLocaleString(),
      note: 'accepted inside the date window',
      tone: 'neutral',
    },
    {
      // Deliberately the literal zero rather than a sum over an empty list: "value at stake" is
      // the money a pending decision could still move, and with no candidates there is none.
      label: 'Value at stake',
      value: formatCurrencyWhole(0),
      note: 'nothing awaiting a decision',
      tone: 'positive',
    },
  ];

  return (
    <section className="probable-matches-empty" aria-label="No candidates to confirm">
      <div className="kpi-wells">
        {/* Grouped rather than three loose strings: the label, the figure and the note only mean
            anything together, and "0 / nothing scored into a band" read apart is the exact
            ambiguity this screen exists to remove. */}
        {figures.map((figure) => (
          <div
            key={figure.label}
            className="kpi-well"
            data-tone={figure.tone}
            role="group"
            aria-label={figure.label}
          >
            <span>{figure.label}</span>
            <strong>{figure.value}</strong>
            <small>{figure.note}</small>
          </div>
        ))}
      </div>

      {/* No `role="status"`: this renders with the panel rather than arriving after it, so it is
          not an announcement. The conditional verdict on 7d is a status; a static empty state is
          structure, and the heading carries it. */}
      <div className="probable-matches-empty__verdict">
        <h3>Nothing to confirm</h3>
        <p>
          A candidate appears here when a pair is <em>not</em> an exact match but the engine still
          judged it close enough to be worth your decision. In this run nothing reached a band —
          which is what a clean period looks like, not a missing step.
        </p>
        <div className="probable-matches-empty__actions">
          <Link className="secondary-button" to={routePaths.mappingRules}>
            Review matching rules
          </Link>
        </div>
      </div>

      <div className="probable-matches-empty__notes">
        <article>
          <span className="eyebrow">Loosening the rules would not help</span>
          <p>
            Nothing is ever matched on a score alone. Relaxing a rule surfaces weaker guesses for
            you to judge; it does not find matches the engine missed. It also applies to the{' '}
            <strong>next</strong> run, never this one.
          </p>
        </article>
        <article>
          <span className="eyebrow">Where confirmations would go</span>
          <p>
            Confirming a pair removes it from both sides of Exceptions and is recorded against the
            rule version in the audit trail. With no candidates, this run&rsquo;s match record is
            already final.
          </p>
        </article>
      </div>
    </section>
  );
}
