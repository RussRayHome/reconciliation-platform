import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ProcessProgressSection, type ProgressStep } from './AppWorkspacePanels';
import type { Density } from '../hooks/useDensity';

type RunStatusTone = 'idle' | 'queued' | 'running' | 'complete' | 'error';

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
  overallProgressPercent,
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
  profile,
  profileLabel,
  onToggleNav,
  density,
  onChangeDensity,
}: Readonly<{
  periodLabel: string;
  accountIdentifier: string;
  sourceFileNames: string[];
  frequency: string;
  statusLabel: string;
  statusTone: RunStatusTone;
  overallProgressPercent: number;
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
  profile: ReactNode;
  profileLabel: string;
  onToggleNav: () => void;
  density: Density;
  onChangeDensity: (density: Density) => void;
}>) {
  const accountDisplay = accountIdentifier.trim() || 'No account override';
  const sourcesDisplay =
    sourceFileNames.length > 0 ? sourceFileNames.join(' + ') : 'No files selected';

  const announcement = resolveRunBarAnnouncement(isComplete, statusTone, exceptionCount);

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

        <details className="run-bar__overflow">
          <summary className="run-bar__overflow-trigger" aria-label="Run details">
            Details
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

        <div className="density-toggle" role="group" aria-label="Display density">
          <button
            type="button"
            className="density-toggle__option"
            aria-pressed={density === 'comfortable'}
            onClick={() => onChangeDensity('comfortable')}
          >
            Comfortable
          </button>
          <button
            type="button"
            className="density-toggle__option"
            aria-pressed={density === 'compact'}
            onClick={() => onChangeDensity('compact')}
          >
            Compact
          </button>
        </div>

        <details className="run-bar__profile">
          <summary className="run-bar__profile-trigger" aria-label="User profile menu">
            User: {profileLabel}
          </summary>
          <div className="run-bar__profile-menu">{profile}</div>
        </details>
      </div>

      <div className="run-bar__status-row">
        <details className="run-bar__progress" open={statusTone === 'running'}>
          <summary className="run-bar__meter" aria-label="Run progress details">
            <progress
              className="run-bar__meter-bar"
              aria-label="Run progress"
              max={100}
              value={overallProgressPercent}
            />
            <span className="run-bar__meter-percent">{overallProgressPercent}%</span>
            <span className="run-bar__step">{currentStepLabel}</span>
          </summary>
          <ProcessProgressSection
            overallProgressPercent={overallProgressPercent}
            progressSteps={progressSteps}
            elapsedLabel={elapsedLabel}
          />
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
