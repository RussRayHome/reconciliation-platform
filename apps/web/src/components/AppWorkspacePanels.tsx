import { type ReactNode } from 'react';
import {
  errorCategories,
  errorCategoryDisplayNames,
  type ReconciliationRunReport,
} from '@recon/domain';
import { SectionCard, StatCard } from '@recon/ui';

import { downloadWorkbookUrl } from '../lib/api';
import {
  reportCatalog,
  summaryStatDefinitions,
  type AppTab,
  type ReportCatalogItem,
  type ReportView,
  type RuleCatalogItem,
} from '../lib/appCatalog';
import { ChartsPanel } from './ChartsPanel';
import { ExceptionTable } from './ExceptionTable';
import { SemanticIcon } from './SemanticIcon';

export type ProgressStep = {
  id: string;
  label: string;
  description: string;
  isComplete: boolean;
  isCurrent: boolean;
  meterValue: number;
};

type RunData = ReconciliationRunReport;

type CategorySummaryRow = {
  category: string;
  label: string;
  count: number;
  amount: number;
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

const buildCategorySummaryRows = (run: RunData): CategorySummaryRow[] => {
  const knownRows = errorCategories
    .map((category) => ({
      category,
      label: errorCategoryDisplayNames[category],
      count: run.summary.countsByCategory[category] ?? 0,
      amount: run.summary.amountByCategory[category] ?? 0,
    }))
    .filter((row) => row.count > 0 || row.amount > 0);

  const unknownRows = Object.keys(run.summary.countsByCategory)
    .filter((category) => !errorCategories.includes(category as (typeof errorCategories)[number]))
    .map((category) => ({
      category,
      label: category,
      count: run.summary.countsByCategory[category] ?? 0,
      amount: run.summary.amountByCategory[category] ?? 0,
    }))
    .filter((row) => row.count > 0 || row.amount > 0);

  return [...knownRows, ...unknownRows];
};

function ExceptionCategoryBreakdown({
  run,
}: Readonly<{
  run: RunData;
}>) {
  const rows = buildCategorySummaryRows(run);

  if (rows.length === 0) {
    return null;
  }

  return (
    <section
      className="table-shell category-breakdown-shell"
      aria-label="Exception category breakdown"
    >
      <div className="category-breakdown-header">
        <h3>Exception Category Breakdown</h3>
        <p>
          Every category present in the detail report is summarized here from the final classified
          totals.
        </p>
      </div>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">
            Final exception categories with counts and absolute dollar exposure.
          </caption>
          <thead>
            <tr>
              <th>Category</th>
              <th>Count</th>
              <th>Absolute Dollars</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category}>
                <td>{row.label}</td>
                <td>{row.count}</td>
                <td>{row.amount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryStatsGrid({
  summary,
}: Readonly<{
  summary: RunData['summary'];
}>) {
  return (
    <section className="stats-grid">
      {summaryStatDefinitions.map((item) => (
        <StatCard
          key={item.id}
          label={item.label}
          value={item.value(summary)}
          tone={item.tone}
          helper={item.helper}
          icon={<SemanticIcon name={item.icon} className="stat-card__metric-icon" />}
          iconLabel={item.iconLabel}
        />
      ))}
    </section>
  );
}

function SummaryReportContent({
  run,
}: Readonly<{
  run: RunData;
}>) {
  return (
    <div className="reports-display-stack">
      <SummaryStatsGrid summary={run.summary} />
      <div className="summary-badges">
        <span>{run.accountIdentifier ?? 'No account override'}</span>
        <span>{run.sourceFiles.map((item) => item.fileName).join(' + ')}</span>
      </div>
      <ChartsPanel summary={run.summary} />
      <ExceptionCategoryBreakdown run={run} />
    </div>
  );
}

function EmptyStateCard({
  eyebrow,
  title,
  description,
  role,
  ariaLive,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: ReactNode;
  role?: 'alert' | 'status';
  ariaLive?: 'off' | 'polite' | 'assertive';
}>) {
  return (
    <div className="empty-state-card" role={role} aria-live={ariaLive}>
      <span className="eyebrow">{eyebrow}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function RunExportActions({
  runId,
  onDownloadWorkbook,
  onExportJson,
}: Readonly<{
  runId: string;
  onDownloadWorkbook: () => void;
  onExportJson: () => void;
}>) {
  return (
    <div className="summary-badges">
      <a
        className="secondary-button"
        href={downloadWorkbookUrl(runId)}
        onClick={onDownloadWorkbook}
      >
        Download workbook
      </a>
      <button type="button" className="secondary-button" onClick={onExportJson}>
        Export JSON
      </button>
    </div>
  );
}

function WorkspaceTabPanel({
  tabId,
  children,
}: Readonly<{
  tabId: AppTab;
  children: ReactNode;
}>) {
  return (
    <section id={`tab-panel-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`}>
      {children}
    </section>
  );
}

function OverviewCard({
  eyebrow,
  title,
  description,
  metaLabel,
  metaValue,
  action,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  metaLabel?: string;
  metaValue?: string;
  action?: ReactNode;
}>) {
  return (
    <article className="rules-overview-card">
      <span className="eyebrow">{eyebrow}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {metaLabel && metaValue ? (
        <div className="rule-card__meta">
          <span>{metaLabel}</span>
          <strong>{metaValue}</strong>
        </div>
      ) : null}
      {action}
    </article>
  );
}

function ProbableMatchesContent({
  probableMatches,
}: Readonly<{
  probableMatches: RunData['probableMatches'];
}>) {
  if (probableMatches.length === 0) {
    return (
      <EmptyStateCard
        eyebrow="No candidates"
        title="No probable matches to review"
        description="This run did not produce any low-confidence candidate pairings that need manual confirmation."
      />
    );
  }

  return (
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
          {probableMatches.map((item) => (
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
  );
}

function ExceptionReportContent({
  run,
  onDownloadWorkbook,
  onExportJson,
}: Readonly<{
  run: RunData;
  onDownloadWorkbook: () => void;
  onExportJson: () => void;
}>) {
  return (
    <>
      <RunExportActions
        runId={run.id}
        onDownloadWorkbook={onDownloadWorkbook}
        onExportJson={onExportJson}
      />
      <ExceptionTable exceptions={run.exceptions} />
    </>
  );
}

function ExportArtifactsContent({
  run,
  onDownloadWorkbook,
  onExportJson,
}: Readonly<{
  run: RunData;
  onDownloadWorkbook: () => void;
  onExportJson: () => void;
}>) {
  return (
    <div className="artifacts-grid">
      <OverviewCard
        eyebrow="Workbook package"
        title={run.outputWorkbook?.fileName ?? `${run.id}.xlsx`}
        description="Generated workbook with accountant-facing tabs for reconciliation review and archival support."
        metaLabel="Worksheet tabs"
        metaValue={run.outputWorkbook?.tabNames.join(' | ') ?? 'Pending generation'}
        action={
          <a
            className="secondary-button"
            href={downloadWorkbookUrl(run.id)}
            onClick={onDownloadWorkbook}
          >
            Download workbook
          </a>
        }
      />

      <OverviewCard
        eyebrow="JSON archive"
        title={`${run.id}.json`}
        description="Structured reconciliation output including summary metrics, probable matches, grouped review artifacts, exceptions, and reviewer decisions."
        metaLabel="Includes"
        metaValue="Summary, grouped matches, exceptions, reviewer decisions"
        action={
          <button type="button" className="secondary-button" onClick={onExportJson}>
            Export JSON
          </button>
        }
      />
    </div>
  );
}

export function ReportsSection({
  run,
  activeReport,
  isHydrating,
  loadError,
  onSelectReport,
  onDownloadWorkbook,
  onExportJson,
}: Readonly<{
  run: RunData | undefined;
  activeReport: ReportView;
  isHydrating: boolean;
  loadError: string | null;
  onSelectReport: (report: ReportView) => void;
  onDownloadWorkbook: () => void;
  onExportJson: () => void;
}>) {
  const defaultReport: ReportCatalogItem = {
    id: 'run-summary',
    name: 'Run Summary',
    description: 'Category charts and run context for the current reconciliation.',
  };
  const selectedReport =
    reportCatalog.find((report) => report.id === activeReport) ?? defaultReport;
  let reportContent: ReactNode;

  if (run) {
    const reportContentByView: Record<ReportView, ReactNode> = {
      'run-summary': <SummaryReportContent run={run} />,
      'probable-match-review': <ProbableMatchesContent probableMatches={run.probableMatches} />,
      'exception-report': (
        <ExceptionReportContent
          run={run}
          onDownloadWorkbook={onDownloadWorkbook}
          onExportJson={onExportJson}
        />
      ),
      'export-artifacts': (
        <ExportArtifactsContent
          run={run}
          onDownloadWorkbook={onDownloadWorkbook}
          onExportJson={onExportJson}
        />
      ),
    };

    reportContent = reportContentByView[activeReport];
  } else if (isHydrating) {
    reportContent = (
      <EmptyStateCard
        eyebrow="Loading latest run"
        title="Loading report output"
        description="Retrieving the most recent reconciliation run from the backend so the selected report can render with saved data."
        role="status"
        ariaLive="polite"
      />
    );
  } else if (loadError) {
    reportContent = (
      <EmptyStateCard
        eyebrow="Unable to load reports"
        title="Latest report output could not be loaded"
        description={loadError}
        role="alert"
      />
    );
  } else {
    reportContent = (
      <EmptyStateCard
        eyebrow="Awaiting run"
        title="No report output yet"
        description="Run a reconciliation from the Upload tab, then select a report to display the generated results here."
      />
    );
  }

  return (
    <WorkspaceTabPanel tabId="reports">
      <SectionCard
        title="Reports"
        description="Select a report from the list to display the current reconciliation output in-place."
      >
        <div className="reports-browser">
          <nav className="reports-list" aria-label="Available reports">
            {reportCatalog.map((report) => (
              <button
                key={report.id}
                type="button"
                className={
                  activeReport === report.id ? 'report-link report-link--active' : 'report-link'
                }
                onClick={() => onSelectReport(report.id)}
              >
                <span>{report.name}</span>
                <small>{report.description}</small>
              </button>
            ))}
          </nav>

          <section className="reports-display" aria-live="polite" aria-busy={isHydrating}>
            <div className="reports-display__header">
              <span className="eyebrow">Selected report</span>
              <h3>{selectedReport.name}</h3>
              <p>{selectedReport.description}</p>
            </div>
            {reportContent}
          </section>
        </div>
      </SectionCard>
    </WorkspaceTabPanel>
  );
}

export function RulesCatalogSection({
  rules,
}: Readonly<{
  rules: RuleCatalogItem[];
}>) {
  return (
    <WorkspaceTabPanel tabId="rules">
      <SectionCard
        title="Rules Catalog"
        description="Current matching and classification rules surfaced from the reconciliation rulebook so reviewers can see the active decision logic in one place."
      >
        <div className="rules-overview-grid">
          <OverviewCard
            eyebrow="Rulebook snapshot"
            title={`${rules.length} rules currently surfaced`}
            description="The list below reflects the active matching and exception rules documented for this build, including the latest rulebook refresh date."
          />
          <OverviewCard
            eyebrow="Last rulebook refresh"
            title="2026-04-04"
            description="Date variance handling, deterministic classifier rules, and structured exception trace metadata are included in this catalog."
          />
        </div>

        <div className="rules-grid">
          {rules.map((rule) => (
            <article key={rule.id} className="rule-card">
              <div className="rule-card__header">
                <h3>{rule.name}</h3>
                <span className="rule-card__pill">Active</span>
              </div>
              <p>{rule.description}</p>
              <div className="rule-card__meta">
                <span>Last Change</span>
                <strong>{rule.lastChange}</strong>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </WorkspaceTabPanel>
  );
}

export function ProcessProgressSection({
  overallProgressPercent,
  progressSteps,
}: Readonly<{
  overallProgressPercent: number;
  progressSteps: ProgressStep[];
}>) {
  return (
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
  );
}

export function RunResultsSection({
  run,
  onDownloadWorkbook,
  onExportJson,
}: Readonly<{
  run: RunData | undefined;
  onDownloadWorkbook: () => void;
  onExportJson: () => void;
}>) {
  if (!run) {
    return (
      <WorkspaceTabPanel tabId="exceptions">
        <SectionCard
          title="Exceptions"
          description="Run a reconciliation first to populate probable matches, summary metrics, and the exception report."
        >
          <EmptyStateCard
            eyebrow="Awaiting run"
            title="No exception set yet"
            description="Upload both source workbooks in the Upload tab and run the reconciliation. The exception report, probable matches, and summary metrics will appear here automatically."
          />
        </SectionCard>
      </WorkspaceTabPanel>
    );
  }

  return (
    <WorkspaceTabPanel tabId="exceptions">
      <SummaryStatsGrid summary={run.summary} />

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
        <ExceptionCategoryBreakdown run={run} />
      </SectionCard>

      <SectionCard
        title="Probable Match Review"
        description="The engine never forces weak matches. Review these candidate pairings separately from the error report."
      >
        <ProbableMatchesContent probableMatches={run.probableMatches} />
      </SectionCard>

      <SectionCard
        title="Exception Report"
        description="Filter and search exceptions without losing source-line traceability."
        actions={
          <RunExportActions
            runId={run.id}
            onDownloadWorkbook={onDownloadWorkbook}
            onExportJson={onExportJson}
          />
        }
      >
        <ExceptionTable exceptions={run.exceptions} />
      </SectionCard>
    </WorkspaceTabPanel>
  );
}
