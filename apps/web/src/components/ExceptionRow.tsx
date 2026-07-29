import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { DecisionAction } from '../hooks/useReviewerDecisions';
import type { ExceptionDisplay } from '../lib/exceptionTriage';

const decisionBadgeLabel: Record<DecisionAction, string> = {
  accept: 'Accepted',
  reject: 'Rejected',
  research: 'Research',
};

/** One compact, single-line exception entry in the triage list pane. */
export function ExceptionRow({
  display,
  isSelected,
  decisionAction,
  isPending,
  optionId,
  tabIndex,
  innerRef,
  onSelect,
  onKeyDown,
  style,
}: Readonly<{
  display: ExceptionDisplay;
  isSelected: boolean;
  decisionAction: DecisionAction | undefined;
  isPending: boolean;
  optionId: string;
  tabIndex: number;
  innerRef?: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
}>) {
  const severity = display.item.severity;

  return (
    <button
      type="button"
      id={optionId}
      ref={innerRef}
      aria-current={isSelected ? 'true' : undefined}
      tabIndex={tabIndex}
      className={isSelected ? 'exception-row exception-row--selected' : 'exception-row'}
      style={style}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span
        className="exception-row__severity"
        data-severity={severity}
        title={severity}
        aria-hidden="true"
      />
      <span className="exception-row__category">{display.categoryLabel}</span>
      <span className="exception-row__date">{display.dateLabel}</span>
      <span className="exception-row__amount">{display.amountLabel}</span>
      <span className="exception-row__counterpart" title={display.counterpartLabel}>
        {display.counterpartLabel}
      </span>
      <span className="exception-row__fileline" title={display.fileLineLabel}>
        {display.fileLineLabel}
      </span>
      {decisionAction ? (
        <span className="exception-row__decision" data-action={decisionAction}>
          {isPending ? 'Saving…' : decisionBadgeLabel[decisionAction]}
        </span>
      ) : (
        <span className="exception-row__decision exception-row__decision--none">Undecided</span>
      )}
    </button>
  );
}
