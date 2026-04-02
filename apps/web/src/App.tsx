import './styles.css';

import { SectionCard, StatCard } from '@recon/ui';

import { ChartsPanel } from './components/ChartsPanel';
import { ExceptionTable } from './components/ExceptionTable';
import kinneyHighlander from './assets/kinney-highlander.png';
import { downloadWorkbookUrl } from './lib/api';
import { useReconciliationRun } from './hooks/useReconciliationRun';
import { useEffect, useMemo, useState } from 'react';

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
  const [periodLabel, setPeriodLabel] = useState(
    buildDefaultPeriodLabel('Monthly', defaultMonth, annualYear, currentYear),
  );
  const reconciliation = useReconciliationRun();
  const run = reconciliation.data;

  const trimmedPeriodLabel = periodLabel.trim();
  const isUsingSuggestedLabel = !isCustomPeriodLabel;
  const canSubmit = Boolean(
    bankFile && qboFile && !reconciliation.isPending && trimmedPeriodLabel.length > 0,
  );

  useEffect(() => {
    if (!isCustomPeriodLabel) {
      setPeriodLabel(suggestedPeriodLabel);
    }
  }, [isCustomPeriodLabel, suggestedPeriodLabel]);

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
            <label>
              <span>Bank workbook</span>
              <input type="file" accept=".xlsx" onChange={(event) => setBankFile(event.target.files?.[0] ?? null)} />
            </label>
            <label>
              <span>QBO workbook</span>
              <input type="file" accept=".xlsx" onChange={(event) => setQboFile(event.target.files?.[0] ?? null)} />
            </label>
            <label>
              <span>Account identifier</span>
              <input value={accountIdentifier} onChange={(event) => setAccountIdentifier(event.target.value)} placeholder="OPERATING-001" />
            </label>
            <label>
              <span>Reconciliation frequency</span>
              <select
                value={reconciliationFrequency}
                onChange={(event) =>
                  setReconciliationFrequency(event.target.value as 'Monthly' | 'Annual')
                }
              >
                <option value="Monthly">Monthly</option>
                <option value="Annual">Annual</option>
              </select>
            </label>
            {reconciliationFrequency === 'Annual' ? (
              <label>
                <span>Annual reconciliation year</span>
                <select value={annualYear} onChange={(event) => setAnnualYear(event.target.value)}>
                  {previousSevenYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <small className="field-hint">Choose one of the last 7 completed years.</small>
              </label>
            ) : (
              <label>
                <span>Monthly reconciliation month</span>
                <select value={monthlyMonth} onChange={(event) => setMonthlyMonth(event.target.value)}>
                  {monthsWithinYear.map((month) => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
                <small className="field-hint">Month applies to the current year ({currentYear}).</small>
              </label>
            )}
            <label>
              <span>Reconciliation label</span>
              <div className="label-input-row">
                <input
                  value={periodLabel}
                  onChange={(event) => {
                    setIsCustomPeriodLabel(true);
                    setPeriodLabel(event.target.value);
                  }}
                  placeholder="Reconciliation label"
                />
                <span
                  className={`label-state-chip ${isUsingSuggestedLabel ? 'label-state-chip--suggested' : 'label-state-chip--custom'}`}
                >
                  {isUsingSuggestedLabel ? 'Suggested' : 'Custom'}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setIsCustomPeriodLabel(false);
                    setPeriodLabel(suggestedPeriodLabel);
                  }}
                >
                  Use suggested
                </button>
              </div>
              <small className="field-hint">Suggested: {suggestedPeriodLabel}</small>
            </label>
            <div className="upload-actions">
              <button type="submit" disabled={!canSubmit}>
                {reconciliation.isPending ? 'Running reconciliation...' : 'Run reconciliation'}
              </button>
              {run ? (
                <>
                  <a className="secondary-button" href={downloadWorkbookUrl(run.id)}>
                    Download workbook
                  </a>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => downloadJson(`${run.id}.json`, run)}
                  >
                    Export JSON
                  </button>
                </>
              ) : null}
            </div>
            {!trimmedPeriodLabel ? (
              <p className="error-banner">Reconciliation label is required before running.</p>
            ) : null}
            {reconciliation.error ? <p className="error-banner">{reconciliation.error.message}</p> : null}
          </form>
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
      </main>
    </div>
  );
}

export default App;
