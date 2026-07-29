import { useEffect, useRef, useState } from 'react';

import { ProcessProgressSection, type ProgressStep } from './AppWorkspacePanels';

type RunStatusTone = 'idle' | 'running' | 'complete' | 'error';

const resolveRunBarAnnouncement = (
  isComplete: boolean,
  statusTone: RunStatusTone,
  exceptionCount: number | null,
): string => {
  if (isComplete) {
    return `Reconciliation finished with ${exceptionCount ?? 0} exceptions.`;
  }

  if (statusTone === 'running') {
    return 'Reconciliation is running. Parsing, matching, and report generation are in progress.';
  }

  if (statusTone === 'error') {
    return 'Reconciliation failed. Review the error and try again.';
  }

  return '';
};

/** Sticky top bar that keeps the active run's identity and live status visible on every workspace tab. */
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
  docsHref,
  developerDashboardHref,
  showDeveloperDashboardLink,
  canAccessDocumentation,
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
  docsHref: string;
  developerDashboardHref: string;
  showDeveloperDashboardLink: boolean;
  canAccessDocumentation: boolean;
}>) {
  const accountDisplay = accountIdentifier.trim() || 'No account override';
  const sourcesDisplay =
    sourceFileNames.length > 0 ? sourceFileNames.join(' + ') : 'No files selected';
  const hasOverflow = canAccessDocumentation || showDeveloperDashboardLink;

  const announcement = resolveRunBarAnnouncement(isComplete, statusTone, exceptionCount);

  return (
    <header className="run-bar" aria-label="Reconciliation run status">
      <div className="run-bar__identity">
        <RunBarField label="Period" value={periodLabel || 'Not set'} />
        <RunBarField label="Account" value={accountDisplay} />
        <RunBarField label="Sources" value={sourcesDisplay} />
        <RunBarField label="Frequency" value={frequency} />
        {exceptionCount !== null ? (
          <RunBarField label="Exceptions" value={String(exceptionCount)} />
        ) : null}
        {reviewProgressLabel ? <RunBarField label="Review" value={reviewProgressLabel} /> : null}
        {runId ? <RunBarRunId runId={runId} /> : null}
        {rulesUsedCount !== null ? (
          <button type="button" className="run-bar__rules-used" onClick={onOpenRules}>
            {rulesUsedCount > 0 ? `Rules used · ${rulesUsedCount} custom` : 'Rules used · defaults'}
          </button>
        ) : null}

        {hasOverflow ? (
          <details className="run-bar__overflow">
            <summary className="run-bar__overflow-trigger" aria-label="More links">
              More
            </summary>
            <div className="run-bar__overflow-menu">
              <button type="button" className="run-bar__overflow-link" onClick={onOpenRules}>
                Rules
              </button>
              {canAccessDocumentation ? (
                <a className="run-bar__overflow-link" href={docsHref}>
                  Documentation
                </a>
              ) : null}
              {showDeveloperDashboardLink ? (
                <a className="run-bar__overflow-link" href={developerDashboardHref}>
                  Developer Dashboard
                </a>
              ) : null}
            </div>
          </details>
        ) : (
          <button type="button" className="run-bar__overflow-trigger" onClick={onOpenRules}>
            Rules
          </button>
        )}
      </div>

      <div className="run-bar__status-row">
        <span className={`run-bar__status run-bar__status--${statusTone}`}>{statusLabel}</span>
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
