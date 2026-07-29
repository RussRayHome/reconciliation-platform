import { useEffect, useState } from 'react';

import { Pill } from '@recon/ui';
import type { ReviewerDecision } from '@recon/domain';

import type { DecisionAction } from '../hooks/useReviewerDecisions';
import { actionByOutcome } from '../hooks/useReviewerDecisions';
import {
  buildComparisonSides,
  buildRuleLineage,
  type ComparisonLine,
  type ExceptionDisplay,
} from '../lib/exceptionTriage';

const toneBySeverity = {
  Critical: 'critical',
  High: 'warning',
  Medium: 'neutral',
  Low: 'positive',
} as const;

const decisionActions: ReadonlyArray<{ action: DecisionAction; label: string; key: string }> = [
  { action: 'accept', label: 'Accept', key: 'A' },
  { action: 'reject', label: 'Reject', key: 'R' },
  { action: 'research', label: 'Needs research', key: 'N' },
];

/** Master–detail evidence panel for the selected exception, including in-place reviewer decisions. */
export function ExceptionEvidencePanel({
  display,
  decision,
  isPending,
  error,
  onDecide,
  onClose,
  isDrawer,
}: Readonly<{
  display: ExceptionDisplay;
  decision: ReviewerDecision | undefined;
  isPending: boolean;
  error: string | null;
  onDecide: (action: DecisionAction, notes: string) => void;
  onClose?: () => void;
  isDrawer: boolean;
}>) {
  const item = display.item;
  const [note, setNote] = useState(decision?.notes ?? '');

  useEffect(() => {
    setNote(decision?.notes ?? '');
  }, [item.id, decision?.notes]);

  const sides = buildComparisonSides(item);
  const lineage = buildRuleLineage(item);
  const evidence = item.ruleTrace?.evidence ?? [];
  const activeAction = decision ? actionByOutcome[decision.outcome] : undefined;

  return (
    <section
      className={isDrawer ? 'exception-detail exception-detail--drawer' : 'exception-detail'}
      aria-label={`Exception detail for ${display.categoryLabel}`}
    >
      <header className="exception-detail__header">
        <div>
          <Pill tone={toneBySeverity[item.severity]}>{item.severity}</Pill>
          <h3>{display.categoryLabel}</h3>
          <p className="exception-detail__reason">{item.ruleTrace?.reason ?? item.errorMessage}</p>
        </div>
        <div className="exception-detail__meta">
          <span className="exception-detail__amount">{display.amountLabel}</span>
          <span className="exception-detail__fileline">{display.fileLineLabel}</span>
        </div>
        {isDrawer && onClose ? (
          <button
            type="button"
            className="secondary-button exception-detail__close"
            onClick={onClose}
          >
            Close
          </button>
        ) : null}
      </header>

      <div className="exception-detail__compare">
        <ComparisonColumn title="Bank" lines={sides.bank} />
        <ComparisonColumn title="QBO" lines={sides.qbo} />
      </div>

      {lineage.length > 0 ? (
        <div className="exception-detail__lineage" aria-label="Rule lineage">
          <h4>Rule lineage</h4>
          <ol className="exception-lineage-trail">
            {lineage.map((step) => (
              <li key={`${step.label}-${step.ruleName}`} data-final={step.label === 'Final'}>
                <span className="exception-lineage-trail__label">{step.label}</span>
                <span>{step.ruleName}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {evidence.length > 0 ? (
        <div className="exception-detail__evidence">
          <h4>Evidence</h4>
          <ul>
            {evidence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {item.recommendedNextActions.length > 0 ? (
        <div className="exception-detail__actions">
          <h4>Recommended next actions</h4>
          <div className="exception-detail__action-buttons">
            {item.recommendedNextActions.map((action) => (
              <button
                key={action}
                type="button"
                className="secondary-button"
                onClick={() => setNote((current) => (current ? `${current}\n${action}` : action))}
              >
                {action}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {item.normalizedComparisonTokens.length > 0 ? (
        <details className="exception-detail__tokens">
          <summary>Matching detail</summary>
          <p className="exception-detail__token-list">
            {item.normalizedComparisonTokens.join(', ')}
          </p>
        </details>
      ) : null}

      <div className="exception-detail__decision" aria-label="Reviewer decision">
        <h4>Reviewer decision</h4>
        <fieldset className="exception-decision-buttons">
          <legend className="visually-hidden">Decision outcome</legend>
          {decisionActions.map(({ action, label, key }) => (
            <button
              key={action}
              type="button"
              className={
                activeAction === action
                  ? 'exception-decision-button exception-decision-button--active'
                  : 'exception-decision-button'
              }
              aria-pressed={activeAction === action}
              disabled={isPending}
              onClick={() => onDecide(action, note)}
            >
              {label} <kbd>{key}</kbd>
            </button>
          ))}
        </fieldset>
        <label className="visually-hidden" htmlFor={`exception-note-${item.id}`}>
          Reviewer note
        </label>
        <textarea
          id={`exception-note-${item.id}`}
          className="exception-decision-note"
          value={note}
          placeholder="Add an optional note for this decision"
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (activeAction && note !== (decision?.notes ?? '')) {
              onDecide(activeAction, note);
            }
          }}
        />
        {isPending ? <p className="exception-decision-status">Saving decision…</p> : null}
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ComparisonColumn({
  title,
  lines,
}: Readonly<{
  title: string;
  lines: ComparisonLine[];
}>) {
  return (
    <div className="exception-compare-column">
      <h4>{title}</h4>
      {lines.length === 0 ? (
        <p className="exception-compare-column__empty">No {title} line</p>
      ) : (
        <ul>
          {lines.map((line) => (
            <li
              key={`${line.fileName}-${line.lineNumber ?? 'na'}-${String(line.isPrimary)}`}
              data-primary={line.isPrimary}
            >
              <span className="exception-compare-column__fileline">
                {line.fileName} / {line.lineNumber ?? 'N/A'}
              </span>
              <span className="exception-compare-column__amount">{line.amountLabel}</span>
              <span className="exception-compare-column__date">{line.dateLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
