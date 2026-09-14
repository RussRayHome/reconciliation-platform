import type { RuleChange } from '../lib/ruleVersionState';

/**
 * The field-by-field statement of what a proposed version changes.
 *
 * Shared by the two screens that have to answer the same question about the same object: 13e's
 * rejected draft (#451) and 2b's approver sheet (#404). It was built for 13e first and rendered
 * only there, which left 2b asking an approver to decide a version while showing them a replay
 * estimate of its consequences and never the change that caused them.
 *
 * `from` is rendered struck through rather than omitted: the approver is deciding a delta, and a
 * bare new value does not say whether it loosened or tightened. `not set` is deliberately distinct
 * from a zero -- an unset override falls back to the platform default, which is not the same claim
 * as an explicit zero.
 */
export function RuleChangeList({
  changes,
  emptyLabel,
}: Readonly<{
  changes: readonly RuleChange[];
  /** What to say when the version changes nothing -- the two callers are asking different
   * questions ("proposed" vs "proposes"), and a shared component should not guess the tense. */
  emptyLabel: string;
}>) {
  if (changes.length === 0) {
    return <p className="rule-change-list__empty">{emptyLabel}</p>;
  }

  return (
    <dl className="rule-change-list">
      {changes.map((change) => (
        <div key={String(change.metric)}>
          <dt>{change.label}</dt>
          <dd>
            <span className="rule-change-list__from">{change.from ?? 'not set'}</span>
            {' → '}
            <strong>{change.to}</strong>
          </dd>
        </div>
      ))}
    </dl>
  );
}
