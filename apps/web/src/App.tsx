import './styles.css';

import { SectionCard, StatCard } from '@recon/ui';
import { useEffect, useMemo, useState } from 'react';

import { ChartsPanel } from './components/ChartsPanel';
import { ExceptionTable } from './components/ExceptionTable';
import { downloadWorkbookUrl } from './lib/api';
import kinneyHighlander from './assets/kinney-highlander.png';
import { useReconciliationRun } from './hooks/useReconciliationRun';

const downloadJson = (fileName: string, data: unknown): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

const monthsWithinYear = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const buildDefaultPeriodLabel = (
  frequency: 'Monthly' | 'Annual',
  month: string,
  year: string,
  currentYear: number,
): string =>
  frequency === 'Annual'
    ? `Annual Recon for ${year}`
    : `Monthly Recon for ${month} ${currentYear}`;

const joinIds = (...ids: Array<string | undefined>): string | undefined => {
  const filtered = ids.filter((item): item is string => Boolean(item));
  return filtered.length > 0 ? filtered.join(' ') : undefined;
};

const resolveMeterValue = (
  isComplete: boolean,
  isCurrent: boolean,
  activeValue: number,
  inactiveValue = 0,
): number => {
  if (isComplete) {
    return 100;
  }

  if (isCurrent) {
    return activeValue;
  }

  return inactiveValue;
};

const resolveStepState = (
  isComplete: boolean,
  isCurrent: boolean,
): { className: string; label: string } => {
  if (isComplete) {
    return { className: 'step-progress-state--complete', label: 'Complete' };
  }

  if (isCurrent) {
    return { className: 'step-progress-state--current', label: 'In progress' };
  }

  return { className: 'step-progress-state--pending', label: 'Pending' };
};

function App() {
  const currentYear = new Date().getFullYear();
  const previousSevenYears = Array.from({ length: 7 }, (_, index) =>
    String(currentYear - index - 1),
  );
  const defaultMonth = monthsWithinYear[new Date().getMonth()] ?? 'January';
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [qboFile, setQboFile] = useState<File | null>(null);
  const [accountIdentifier, setAccountIdentifier] = useState('');
  const [reconciliationFrequency, setReconciliationFrequency] = useState<'Monthly' | 'Annual'>('Monthly');
  const [annualYear, setAnnualYear] = useState(previousSevenYears[0] ?? '');
  const [monthlyMonth, setMonthlyMonth] = useState(defaultMonth);
  const suggestedPeriodLabel = useMemo(
    () => buildDefaultPeriodLabel(reconciliationFrequency, monthlyMonth, annualYear, currentYear),
    [reconciliationFrequency, monthlyMonth, annualYear, currentYear],
  );
  const [isCustomPeriodLabel, setIsCustomPeriodLabel] = useState(false);
  const [openHelpField, setOpenHelpField] = useState<string | null>(null);
  const [hasDownloadedWorkbook, setHasDownloadedWorkbook] = useState(false);
  const [hasExportedJson, setHasExportedJson] = useState(false);
  const [periodLabel, setPeriodLabel] = useState(
    buildDefaultPeriodLabel('Monthly', defaultMonth, annualYear, currentYear),
  );
  const reconciliation = useReconciliationRun();
  const run = reconciliation.data;

  const trimmedPeriodLabel = periodLabel.trim();
  const isLabelMissing = trimmedPeriodLabel.length === 0;
  const reconciliationLabelErrorId = 'reconciliation-label-error';
  const reconciliationLabelHintId = 'reconciliation-label-hint';
  const hasStartedUploadStep = Boolean(bankFile || qboFile);
  const isUploadStepComplete = Boolean(bankFile && qboFile);
  const isConfigurationStepComplete = isUploadStepComplete && !isLabelMissing;
  const isRunStepComplete = Boolean(run);
  const isRunStepCurrent = isConfigurationStepComplete && !isRunStepComplete;
  const isExportStepComplete = hasDownloadedWorkbook || hasExportedJson;
  const isExportStepCurrent = isRunStepComplete && !isExportStepComplete;
  const isRunPendingStep = isRunStepCurrent || reconciliation.isPending;
  const uploadMeterValue = resolveMeterValue(isUploadStepComplete, hasStartedUploadStep, 20);
  const configurationMeterValue = resolveMeterValue(
    isConfigurationStepComplete,
    isUploadStepComplete && !isConfigurationStepComplete,
    50,
  );
  const runMeterValue = resolveMeterValue(
    isRunStepComplete,
    isRunPendingStep,
    reconciliation.isPending ? 70 : 35,
  );
  const exportMeterValue = resolveMeterValue(isExportStepComplete, isExportStepCurrent, 60);
  const canSubmit = Boolean(
    bankFile && qboFile && !reconciliation.isPending && !isLabelMissing,
  );
  const progressSteps = [
    {
      id: 'upload',
      label: 'Upload source files',
      description: 'Select both Bank and QBO workbooks.',
      isComplete: isUploadStepComplete,
      isCurrent: hasStartedUploadStep && !isUploadStepComplete,
      meterValue: uploadMeterValue,
    },
    {
      id: 'configure',
      label: 'Confirm run settings',
      description: 'Choose frequency/period and provide a reconciliation label.',
      isComplete: isConfigurationStepComplete,
      isCurrent: isUploadStepComplete && !isConfigurationStepComplete,
      meterValue: configurationMeterValue,
    },
    {
      id: 'run',
      label: 'Run reconciliation',
      description: 'Processing includes parsing, matching, and exception generation.',
      isComplete: isRunStepComplete,
      isCurrent: isRunPendingStep,
      meterValue: runMeterValue,
    },
    {
      id: 'review-export',
      label: 'Review and export outputs',
      description: 'Review results and export workbook/JSON artifacts.',
      isComplete: isExportStepComplete,
      isCurrent: isExportStepCurrent,
      meterValue: exportMeterValue,
    },
  ] as const;
  const completedStepCount = progressSteps.filter((step) => step.isComplete).length;
  const overallProgressPercent = Math.round((completedStepCount / progressSteps.length) * 100);

  useEffect(() => {
    if (!isCustomPeriodLabel) {
      setPeriodLabel(suggestedPeriodLabel);
    }
  }, [isCustomPeriodLabel, suggestedPeriodLabel]);

  useEffect(() => {
    if (!openHelpField) {
      return;
    }

    const handleDocumentPointerDown = (event: MouseEvent): void => {
      const target = event.target;

      if (!(target instanceof Element)) {
        setOpenHelpField(null);
        return;
      }

      const activeHelpGroup = target.closest('[data-help-field]');

      if ((activeHelpGroup as HTMLElement | null)?.dataset?.helpField === openHelpField) {
        return;
      }

      setOpenHelpField(null);
    };

    document.addEventListener('mousedown', handleDocumentPointerDown);

    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown);
    };
  }, [openHelpField]);

  const toggleFieldHelp = (field: string): void => {
    setOpenHelpField((current) => (current === field ? null : field));
  };

  return (
    <div className="app-shell">
      <div className="hero-backdrop" />
      <main className="app-layout">
        <header className="hero-card">
          <div>
            <span className="eyebrow">Audit-ready monthly close workflow</span>
            <h1>Bank-to-QBO Reconciliation Platform</h1>
            <p>
              Upload source workbooks, preserve row-level traceability, run evidence-based matching,
              and export accountant-friendly workpapers with repeatable rules.
            </p>
            <a className="hero-primary-cta" href="#source-upload-form">
              Start reconciliation
            </a>
            <a className="hero-secondary-cta" href="/developer-dashboard.html">
              Open developer dashboard
            </a>
          </div>
          <div className="hero-meta">
            <div className="hero-brand">
              <img
                className="hero-brand__mascot"
                src={kinneyHighlander}
                alt="Small Scottish man in a kilt illustration"
              />
              <div>
                <span>Powered by</span>
                <strong>Kinney Software Solutions LLC</strong>
              </div>
            </div>
            <div>
              <span>Correlation-aware processing</span>
              <strong>{run?.correlationId ?? 'Awaiting run'}</strong>
            </div>
            <div>
              <span>Current period</span>
              <strong>{run?.periodLabel ?? (periodLabel || 'Not set')}</strong>
            </div>
            <div>
              <span>Reconciliation frequency</span>
              <strong>{reconciliationFrequency}</strong>
            </div>
          </div>
        </header>

        <SectionCard
          title="Source Upload"
          description="XLSX uploads only. The engine preserves original file names, line numbers, excluded rows, and normalized audit fields."
        >
          <form
            id="source-upload-form"
            className="upload-form"
            onSubmit={(event) => {
              event.preventDefault();

              if (!bankFile || !qboFile) {
                return;
              }

              void reconciliation.mutateAsync({
                bankFile,
                qboFile,
                accountIdentifier,
                reconciliationFrequency,
                periodLabel: trimmedPeriodLabel,
              });
            }}
          >
            <div className="field-group" data-help-field="bank-workbook">
              <div className="field-label-row">
                <label htmlFor="bank-workbook-input">Bank workbook</label>
                <button
                  type="button"
                  className="help-icon-button"
                  aria-label="Open help for bank source file"
                  aria-expanded={openHelpField === 'bank-workbook'}
                  aria-controls="bank-workbook-help"
                  onClick={() => toggleFieldHelp('bank-workbook')}
                >
                  ?
                </button>
              </div>
              {openHelpField === 'bank-workbook' ? (
                <small id="bank-workbook-help" className="field-help-popover">
                  Upload the exported bank transaction workbook used as the bank source of truth.
                </small>
              ) : null}
              <input
                id="bank-workbook-input"
                type="file"
                accept=".xlsx"
                aria-describedby={
                  openHelpField === 'bank-workbook' ? 'bank-workbook-help' : undefined
                }
                onChange={(event) => setBankFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="field-group" data-help-field="qbo-workbook">
              <div className="field-label-row">
                <label htmlFor="qbo-workbook-input">QBO workbook</label>
                <button
                  type="button"
                  className="help-icon-button"
                  aria-label="Open help for QBO source file"
                  aria-expanded={openHelpField === 'qbo-workbook'}
                  aria-controls="qbo-workbook-help"
                  onClick={() => toggleFieldHelp('qbo-workbook')}
                >
                  ?
                </button>
              </div>
              {openHelpField === 'qbo-workbook' ? (
                <small id="qbo-workbook-help" className="field-help-popover">
                  Upload the QuickBooks Online export workbook to compare against the bank records.
                </small>
              ) : null}
              <input
                id="qbo-workbook-input"
                type="file"
                accept=".xlsx"
                aria-describedby={
                  openHelpField === 'qbo-workbook' ? 'qbo-workbook-help' : undefined
                }
                onChange={(event) => setQboFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="field-group" data-help-field="account-identifier">
              <div className="field-label-row">
                <label htmlFor="account-identifier-input">Account identifier</label>
                <button
                  type="button"
                  className="help-icon-button"
                  aria-label="Open help for account code field"
                  aria-expanded={openHelpField === 'account-identifier'}
                  aria-controls="account-identifier-help"
                  onClick={() => toggleFieldHelp('account-identifier')}
                >
                  ?
                </button>
              </div>
              {openHelpField === 'account-identifier' ? (
                <small id="account-identifier-help" className="field-help-popover">
                  Optional account code shown in outputs and exports to identify which account this run belongs to.
                </small>
              ) : null}
              <input
                id="account-identifier-input"
                value={accountIdentifier}
                aria-describedby={
                  openHelpField === 'account-identifier' ? 'account-identifier-help' : undefined
                }
                onChange={(event) => setAccountIdentifier(event.target.value)}
                placeholder="OPERATING-001"
              />
            </div>
            <div className="field-group" data-help-field="reconciliation-frequency">
              <div className="field-label-row">
                <label htmlFor="reconciliation-frequency-select">Reconciliation frequency</label>
                <button
                  type="button"
                  className="help-icon-button"
                  aria-label="Open help for run frequency selector"
                  aria-expanded={openHelpField === 'reconciliation-frequency'}
                  aria-controls="reconciliation-frequency-help"
                  onClick={() => toggleFieldHelp('reconciliation-frequency')}
                >
                  ?
                </button>
              </div>
              {openHelpField === 'reconciliation-frequency' ? (
                <small id="reconciliation-frequency-help" className="field-help-popover">
                  Choose Monthly for one-month close checks, or Annual for full-year reconciliation validation.
                </small>
              ) : null}
              <select
                id="reconciliation-frequency-select"
                value={reconciliationFrequency}
                aria-describedby={
                  openHelpField === 'reconciliation-frequency'
                    ? 'reconciliation-frequency-help'
                    : undefined
                }
                onChange={(event) =>
                  setReconciliationFrequency(event.target.value as 'Monthly' | 'Annual')
                }
              >
                <option value="Monthly">Monthly</option>
                <option value="Annual">Annual</option>
              </select>
            </div>
            {reconciliationFrequency === 'Annual' ? (
              <div className="field-group" data-help-field="annual-reconciliation-year">
                <div className="field-label-row">
                  <label htmlFor="annual-reconciliation-year-select">Annual reconciliation year</label>
                  <button
                    type="button"
                    className="help-icon-button"
                    aria-label="Open help for annual year selector"
                    aria-expanded={openHelpField === 'annual-reconciliation-year'}
                    aria-controls="annual-reconciliation-year-help"
                    onClick={() => toggleFieldHelp('annual-reconciliation-year')}
                  >
                    ?
                  </button>
                </div>
                {openHelpField === 'annual-reconciliation-year' ? (
                  <small id="annual-reconciliation-year-help" className="field-help-popover">
                    Select the completed year you want to reconcile across all 12 months.
                  </small>
                ) : null}
                <select
                  id="annual-reconciliation-year-select"
                  value={annualYear}
                  aria-describedby={joinIds(
                    openHelpField === 'annual-reconciliation-year'
                      ? 'annual-reconciliation-year-help'
                      : undefined,
                    'annual-year-hint',
                  )}
                  onChange={(event) => setAnnualYear(event.target.value)}
                >
                  {previousSevenYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <small id="annual-year-hint" className="field-hint">
                  Choose one of the last 7 completed years.
                </small>
              </div>
            ) : (
              <div className="field-group" data-help-field="monthly-reconciliation-month">
                <div className="field-label-row">
                  <label htmlFor="monthly-reconciliation-month-select">Monthly reconciliation month</label>
                  <button
                    type="button"
                    className="help-icon-button"
                    aria-label="Open help for monthly month selector"
                    aria-expanded={openHelpField === 'monthly-reconciliation-month'}
                    aria-controls="monthly-reconciliation-month-help"
                    onClick={() => toggleFieldHelp('monthly-reconciliation-month')}
                  >
                    ?
                  </button>
                </div>
                {openHelpField === 'monthly-reconciliation-month' ? (
                  <small id="monthly-reconciliation-month-help" className="field-help-popover">
                    Select the month in the current year that this reconciliation run represents.
                  </small>
                ) : null}
                <select
                  id="monthly-reconciliation-month-select"
                  value={monthlyMonth}
                  aria-describedby={joinIds(
                    openHelpField === 'monthly-reconciliation-month'
                      ? 'monthly-reconciliation-month-help'
                      : undefined,
                    'monthly-month-hint',
                  )}
                  onChange={(event) => setMonthlyMonth(event.target.value)}
                >
                  {monthsWithinYear.map((month) => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
                <small id="monthly-month-hint" className="field-hint">
                  Month applies to the current year ({currentYear}).
                </small>
              </div>
            )}
            <div className="field-group" data-help-field="reconciliation-label">
              <div className="field-label-row">
                <label htmlFor="reconciliation-label-input">Reconciliation label</label>
                <button
                  type="button"
                  className="help-icon-button"
                  aria-label="Open help for run title field"
                  aria-expanded={openHelpField === 'reconciliation-label'}
                  aria-controls="reconciliation-label-help"
                  onClick={() => toggleFieldHelp('reconciliation-label')}
                >
                  ?
                </button>
              </div>
              {openHelpField === 'reconciliation-label' ? (
                <small id="reconciliation-label-help" className="field-help-popover">
                  Editable run title used in reports and workbook exports so reviewers can identify the period quickly.
                </small>
              ) : null}
              <div className="label-input-row">
                <input
                  id="reconciliation-label-input"
                  value={periodLabel}
                  aria-invalid={isLabelMissing}
                  aria-describedby={joinIds(
                    openHelpField === 'reconciliation-label' ? 'reconciliation-label-help' : undefined,
                    reconciliationLabelHintId,
                    isLabelMissing ? reconciliationLabelErrorId : undefined,
                  )}
                  onChange={(event) => {
                    setIsCustomPeriodLabel(true);
                    setPeriodLabel(event.target.value);
                  }}
                  placeholder="Reconciliation label"
                />
              </div>
              <small id={reconciliationLabelHintId} className="field-hint">
                Suggested: {suggestedPeriodLabel}
              </small>
            </div>
            <p className="trust-note">
              Use only authorized XLSX exports and follow your organization&apos;s financial data handling policy.
            </p>
            <div className="upload-actions">
              <button type="submit" disabled={!canSubmit}>
                {reconciliation.isPending ? 'Running reconciliation...' : 'Run reconciliation'}
              </button>
              {run ? (
                <>
                  <a
                    className="secondary-button"
                    href={downloadWorkbookUrl(run.id)}
                    onClick={() => setHasDownloadedWorkbook(true)}
                  >
                    Download workbook
                  </a>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setHasExportedJson(true);
                      downloadJson(`${run.id}.json`, run);
                    }}
                  >
                    Export JSON
                  </button>
                </>
              ) : null}
            </div>
            {isLabelMissing ? (
              <p id={reconciliationLabelErrorId} className="error-banner" role="alert">
                Reconciliation label is required before running.
              </p>
            ) : null}
            {reconciliation.error ? <p className="error-banner">{reconciliation.error.message}</p> : null}
          </form>
        </SectionCard>

        <SectionCard
          title="Process Progress"
          description="Track overall reconciliation progress and each individual step until completion."
        >
          <div className="process-progress-grid">
            <article className="overall-progress-card" aria-live="polite">
              <div className="overall-progress-head">
                <span>Overall Process Meter</span>
                <strong>{overallProgressPercent}%</strong>
              </div>
              <progress
                className="progress-meter"
                aria-label="Overall process progress"
                max={100}
                value={overallProgressPercent}
              />
            </article>

            <ul className="step-progress-list" aria-label="Reconciliation step progress">
              {progressSteps.map((step) => {
                const stepState = resolveStepState(step.isComplete, step.isCurrent);

                return (
                  <li className="step-progress-item" key={step.id}>
                    <div className="step-progress-head">
                      <h3>{step.label}</h3>
                      <span className={`step-progress-state ${stepState.className}`}>
                        {stepState.label}
                      </span>
                    </div>
                    <progress
                      className="progress-meter"
                      aria-label={`${step.label} progress`}
                      max={100}
                      value={step.meterValue}
                    />
                    <p>{step.description}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </SectionCard>

        {run ? (
          <>
            <section className="stats-grid">
              <StatCard label="Total reviewed" value={run.summary.totalRecordsReviewed} helper="Bank + QBO records" />
              <StatCard label="Exact matches" value={run.summary.exactMatches} tone="positive" helper="Cleanly matched items" />
              <StatCard label="Probable matches" value={run.summary.probableMatches} tone="warning" helper="Review queue" />
              <StatCard label="Unmatched items" value={run.summary.unmatchedItems} tone="critical" helper="Missing from either source" />
              <StatCard label="Duplicates" value={run.summary.duplicates} tone="warning" helper="Potential duplicate booking" />
              <StatCard label="Timing differences" value={run.summary.timingDifferences} helper="Likely posting lag" />
              <StatCard label="Data quality issues" value={run.summary.dataQualityIssues} tone="critical" helper="Malformed or zero-amount rows" />
              <StatCard label="Unresolved exposure" value={run.summary.unresolvedExposure.toFixed(2)} tone="critical" helper="Absolute exception dollars" />
            </section>

            <SectionCard
              title="Run Summary"
              description="Exceptions are sorted by severity, source, transaction date, and line number for accounting review."
              actions={
                <div className="summary-badges">
                  <span>{run.accountIdentifier ?? 'No account override'}</span>
                  <span>{run.sourceFiles.map((item) => item.fileName).join(' + ')}</span>
                </div>
              }
            >
              <ChartsPanel summary={run.summary} />
            </SectionCard>

            <SectionCard
              title="Probable Match Review"
              description="The engine never forces weak matches. Review these candidate pairings separately from the error report."
            >
              <div className="table-scroll">
                <table>
                  <caption className="visually-hidden">
                    Probable match candidates to review before final reconciliation.
                  </caption>
                  <thead>
                    <tr>
                      <th>Disposition</th>
                      <th>Confidence</th>
                      <th>Rule</th>
                      <th>Date diff</th>
                      <th>Amount diff</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.probableMatches.map((item) => (
                      <tr key={item.id}>
                        <td>{item.disposition}</td>
                        <td>{item.confidence}</td>
                        <td>{item.ruleName}</td>
                        <td>{item.dateDifferenceDays ?? 'N/A'}</td>
                        <td>{item.amountDifference.toFixed(2)}</td>
                        <td>{item.evidence.join(' | ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard title="Exception Report" description="Filter and search exceptions without losing source-line traceability.">
              <ExceptionTable exceptions={run.exceptions} />
            </SectionCard>
          </>
        ) : null}

        <footer className="page-footer">
          <p>
            Next step: run reconciliation, review probable matches and exceptions, then export workbook and JSON for audit files.
          </p>
        </footer>
      </main>
    </div>
  );
}

export default App;
