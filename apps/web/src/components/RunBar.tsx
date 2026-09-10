import { useEffect, useRef, useState } from 'react';

import {
  ProcessProgressSection,
  type ProgressStep,
  type ProgressStepStatus,
} from './AppWorkspacePanels';
import { useDismissableDetails } from '../hooks/useDismissableDetails';

type RunStatusTone = 'idle' | 'queued' | 'running' | 'complete' | 'error';

/** R2 V3.1: complete/failed are solid (nothing left to animate); current/queued are striped
 * (`prefers-reduced-motion` stops the stripe animating in CSS, not here -- the state stays
 * legible from colour and label alone either way). ready/pending/not-run all render as an empty
 * segment -- nothing has happened there yet, and (for `not-run`) nothing will without a retry. */
const SEGMENT_CLASS_BY_STATUS: Record<ProgressStepStatus, string> = {
  complete: 'run-bar__segment--complete',
  current: 'run-bar__segment--current',
  queued: 'run-bar__segment--queued',
  failed: 'run-bar__segment--failed',
  ready: 'run-bar__segment--empty',
  pending: 'run-bar__segment--empty',
  'not-run': 'run-bar__segment--empty',
};

/** R2 V3.3: the phase word (`currentStepLabel`) plus this counter replaces the deleted
 * percentage. `position` is the 1-based index of whichever step is actively current/queued/failed
 * -- or, if none is (nothing has been submitted yet, or every step is complete), however many
 * steps are already complete. A run that has failed states "stopped at", per the design's own
 * "stopped at step 3 of 4" wording for a terminal failure. */
const resolveStepCounterLabel = (steps: ProgressStep[]): string => {
  const activeIndex = steps.findIndex(
    (step) => step.status === 'current' || step.status === 'queued' || step.status === 'failed',
  );
  const completeCount = steps.filter((step) => step.status === 'complete').length;
  const position = activeIndex >= 0 ? activeIndex + 1 : completeCount;
  const hasFailed = steps.some((step) => step.status === 'failed');

  return hasFailed
    ? `stopped at step ${position} of ${steps.length}`
    : `step ${position} of ${steps.length}`;
};

const resolveRunBarAnnouncement = (
  isComplete: boolean,
  statusTone: RunStatusTone,
  exceptionCount: number | null,
): string => {
  if (isComplete) {
    return `Reconciliation finished with ${exceptionCount ?? 0} exceptions.`;
  }

  if (statusTone === 'queued') {
    return 'Import run submitted and queued for validation.';
  }

  if (statusTone === 'running') {
    return 'Reconciliation is running. Parsing, matching, and report generation are in progress.';
  }

  if (statusTone === 'error') {
    return 'Reconciliation failed. Review the error and try again.';
  }

  return '';
};

/** Sticky glass top bar: primary run identity and status up front, everything else in the run-details popover. */
export function RunBar({
  periodLabel,
  accountIdentifier,
  sourceFileNames,
  frequency,
  statusLabel,
  statusTone,
  currentStepLabel,
  exceptionCount,
  runId,
  elapsedLabel,
  isComplete,
  onOpenReview,
  onOpenRules,
  rulesUsedCount,
  reviewProgressLabel,
  progressSteps,
  onToggleNav,
}: Readonly<{
  periodLabel: string;
  accountIdentifier: string;
  sourceFileNames: string[];
  frequency: string;
  statusLabel: string;
  statusTone: RunStatusTone;
  currentStepLabel: string;
  exceptionCount: number | null;
  runId: string | null;
  elapsedLabel: string | null;
  isComplete: boolean;
  onOpenReview: () => void;
  onOpenRules: () => void;
  rulesUsedCount: number | null;
  reviewProgressLabel: string | null;
  progressSteps: ProgressStep[];
  onToggleNav: () => void;
}>) {
  const accountDisplay = accountIdentifier.trim() || 'No account override';
  const sourcesDisplay =
    sourceFileNames.length > 0 ? sourceFileNames.join(' + ') : 'No files selected';

  const announcement = resolveRunBarAnnouncement(isComplete, statusTone, exceptionCount);

  // R3 X6: <details> has no dismissal of its own, so both run-bar popovers close on an outside
  // press or Escape.
  const overflowRef = useDismissableDetails();

  return (
    <header className="run-bar" aria-label="Reconciliation run status">
      <div className="run-bar__identity">
        <button
          type="button"
          className="run-bar__nav-toggle"
          aria-label="Toggle navigation"
          onClick={onToggleNav}
        >
          <span aria-hidden="true">≡</span>
        </button>
        <div className="run-bar__field run-bar__field--run" title={periodLabel || 'Not set'}>
          <span className="run-bar__field-label">Active run</span>
          <strong className="run-bar__field-value">
            {periodLabel || 'Not set'} · {frequency}
          </strong>
        </div>
        <span className={`run-bar__status run-bar__status--${statusTone}`}>{statusLabel}</span>
        {exceptionCount !== null ? (
          <RunBarField label="Exceptions" value={String(exceptionCount)} />
        ) : null}
        {reviewProgressLabel ? <RunBarField label="Resolved" value={reviewProgressLabel} /> : null}

        <details className="run-bar__overflow" ref={overflowRef}>
          <summary className="run-bar__overflow-trigger" aria-label="Run details">
            Run info
          </summary>
          <div className="run-bar__overflow-menu">
            <RunBarField label="Account" value={accountDisplay} />
            <RunBarField label="Sources" value={sourcesDisplay} />
            {runId ? <RunBarRunId runId={runId} /> : null}
            {rulesUsedCount !== null ? (
              <button type="button" className="run-bar__rules-used" onClick={onOpenRules}>
                {rulesUsedCount > 0
                  ? `Rules used · ${rulesUsedCount} custom`
                  : 'Rules used · defaults'}
              </button>
            ) : null}
            <button type="button" className="run-bar__overflow-link" onClick={onOpenRules}>
              Rules
            </button>
          </div>
        </details>
      </div>

      <div className="run-bar__status-row">
        {/* R2 V3.4: `open` used to key only on `running`, so the detail panel slammed shut the
            instant a run queued or failed -- exactly when there's something to read. A queued
            submission flips the tone to `error` today only via the throw this package's V1
            already removed; `error` covers both `validation-failed` and `matching-failed`
            (`resolveRunStatusTone` maps both to it), so this one check covers both failure
            phases. The `max-height`/`overflow-y` bound on `.run-bar__progress[open]` stays --
            its own comment records a real Playwright timeout where the sticky run-bar intercepted
            clicks on Submit run; forcing this open more often makes that bound load-bearing, not
            optional. */}
        <details
          className="run-bar__progress"
          open={statusTone === 'running' || statusTone === 'queued' || statusTone === 'error'}
        >
          <summary className="run-bar__meter" aria-label="Run progress details">
            {/* R2 V3.2 (D6): replaces `run-bar__meter-bar` (a single <progress>) and
                `run-bar__meter-percent` -- `completedSteps / 4` was never real progress, and this
                literal number is what read "50%" forever. `aria-hidden`: the phase word and step
                counter beside it already say the same thing in words. */}
            <span className="run-bar__segments" aria-hidden="true">
              {progressSteps.map((step) => (
                <span
                  key={step.id}
                  className={`run-bar__segment ${SEGMENT_CLASS_BY_STATUS[step.status]}`}
                />
              ))}
            </span>
            <span className="run-bar__step">{currentStepLabel}</span>
            <span className="run-bar__step-counter">{resolveStepCounterLabel(progressSteps)}</span>
            {elapsedLabel ? <span className="run-bar__elapsed">Elapsed {elapsedLabel}</span> : null}
          </summary>
          <ProcessProgressSection progressSteps={progressSteps} />
        </details>

        {isComplete ? (
          <button type="button" className="run-bar__result" onClick={onOpenReview}>
            Run finished · {exceptionCount ?? 0} exceptions · Review
          </button>
        ) : null}
      </div>

      {announcement ? (
        <p className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </p>
      ) : null}
    </header>
  );
}

function RunBarField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="run-bar__field" title={value}>
      <span className="run-bar__field-label">{label}</span>
      <strong className="run-bar__field-value">{value}</strong>
    </div>
  );
}

function RunBarRunId({ runId }: Readonly<{ runId: string }>) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  const handleCopy = (): void => {
    const markCopied = (): void => {
      setCopied(true);

      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }

      resetTimer.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    };

    const clipboard = globalThis.navigator?.clipboard;

    if (clipboard?.writeText) {
      void clipboard
        .writeText(runId)
        .then(markCopied)
        .catch(() => {
          // Ignore clipboard failures; the ID remains visible for manual copy.
        });
      return;
    }

    markCopied();
  };

  return (
    <div className="run-bar__field run-bar__field--id" title={runId}>
      <span className="run-bar__field-label">Run ID</span>
      <span className="run-bar__id-row">
        <strong className="run-bar__field-value run-bar__id-value">{runId}</strong>
        <button
          type="button"
          className="run-bar__copy"
          onClick={handleCopy}
          aria-label={copied ? 'Run ID copied' : 'Copy run ID'}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </span>
    </div>
  );
}
