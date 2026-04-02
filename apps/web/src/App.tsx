import './styles.css';

import { SectionCard, StatCard } from '@recon/ui';

import { ChartsPanel } from './components/ChartsPanel';
import { ExceptionTable } from './components/ExceptionTable';
import kinneyHighlander from './assets/kinney-highlander.png';
import { downloadWorkbookUrl } from './lib/api';
import { useReconciliationRun } from './hooks/useReconciliationRun';
import { useState } from 'react';

const downloadJson = (fileName: string, data: unknown): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

function App() {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [qboFile, setQboFile] = useState<File | null>(null);
  const [accountIdentifier, setAccountIdentifier] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const reconciliation = useReconciliationRun();
  const run = reconciliation.data;

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
                periodLabel,
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
              <span>Period label</span>
              <input value={periodLabel} onChange={(event) => setPeriodLabel(event.target.value)} placeholder="January 2025" />
            </label>
            <div className="upload-actions">
              <button type="submit" disabled={!bankFile || !qboFile || reconciliation.isPending}>
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
