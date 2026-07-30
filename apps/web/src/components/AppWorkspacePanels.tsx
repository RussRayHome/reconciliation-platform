import { type ReactNode, useRef } from 'react';
import {
  errorCategories,
  errorCategoryDisplayNames,
  type ReconciliationRunReport,
  type ReviewerDecision,
} from '@recon/domain';
import { SectionCard, StatCard } from '@recon/ui';
import { useVirtualizer } from '@tanstack/react-virtual';

import { downloadWorkbookUrl } from '../lib/api';
import type { DecisionAction } from '../hooks/useReviewerDecisions';
import { formatCurrency } from '../lib/format';
import {
  summaryStatDefinitions,
  varianceMetricFamilyLabels,
  varianceMetricFamilyOrder,
  type AppTab,
  type ReportView,
  type RuleCatalogItem,
  type RuleVarianceMetric,
} from '../lib/appCatalog';
import { ChartsPanel } from './ChartsPanel';
import { BentoModule } from './BentoModule';
import { ExceptionTriage } from './ExceptionTriage';
import { SemanticIcon } from './SemanticIcon';

/** A single step in the process progress stepper displayed during reconciliation submission. */
export type ProgressStep = {
  id: string;
  label: string;
  description: string;
  isComplete: boolean;
  isCurrent: boolean;
  meterValue: number;
  detail?: string;
};

type RunData = ReconciliationRunReport;

type CategorySummaryRow = {
  category: string;
  label: string;
  count: number;
  amount: number;
};

export type RuleVarianceDefaultOverrides = Record<string, number>;

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

const probableMatchVirtualizationThreshold = 120;

const formatVarianceValue = (value: number, unit: RuleVarianceMetric['unit']): string => {
  if (unit === 'days') {
    return `${value} day${value === 1 ? '' : 's'}`;
  }

  if (unit === 'usd') {
    return formatCurrency(value);
  }

  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
};

const metricConsequenceByMetric: Record<
  string,
  { label: string; value: (summary: RunData['summary']) => number }
> = {
  'amount-tolerance': { label: 'clean matches', value: (summary) => summary.exactMatches },
  'date-tolerance-days': { label: 'date variances', value: (summary) => summary.dateVariances },
  'timing-difference-days': {
    label: 'timing differences',
    value: (summary) => summary.timingDifferences,
  },
  'text-similarity-threshold': {
    label: 'probable matches',
    value: (summary) => summary.probableMatches,
  },
  'probable-text-similarity-threshold': {
    label: 'probable matches',
    value: (summary) => summary.probableMatches,
  },
  'amount-mismatch-similarity-threshold': {
    label: 'amount mismatches',
    value: (summary) => summary.amountMismatches,
  },
  'duplicate-date-window-days': {
    label: 'duplicate entries',
    value: (summary) => summary.bankDuplicates + summary.qboDuplicates,
  },
  'duplicate-similarity-threshold': {
    label: 'duplicate entries',
    value: (summary) => summary.bankDuplicates + summary.qboDuplicates,
  },
};

const buildMetricConsequence = (metricId: string, run: RunData | undefined): string | null => {
  if (!run) {
    return null;
  }

  const mapping = metricConsequenceByMetric[metricId];

  if (!mapping) {
    return null;
  }

  return `Last run: ${mapping.value(run.summary)} ${mapping.label} of ${run.summary.totalRecordsReviewed} records reviewed.`;
};

/** A single variance-metric control: effective vs default value, per-metric reset, and run consequence. */
function RuleVarianceControl({
  metric,
  effectiveValue,
  isChanged,
  canAdjust,
  consequence,
  onChange,
  onReset,
}: Readonly<{
  metric: RuleVarianceMetric;
  effectiveValue: number;
  isChanged: boolean;
  canAdjust: boolean;
  consequence: string | null;
  onChange: (metricId: string, value: number) => void;
  onReset: (metricId: string) => void;
}>) {
  return (
    <li className="rule-variance-item">
      <div className="rule-variance-item__head">
        <span>{metric.label}</span>
        <strong>{formatVarianceValue(effectiveValue, metric.unit)}</strong>
      </div>
      <p className="rule-variance-item__default">
        Default {formatVarianceValue(metric.value, metric.unit)}
        {isChanged ? <span className="rule-variance-item__changed">Changed</span> : null}
      </p>

      {canAdjust ? (
        <>
          <input
            type="range"
            className="rule-variance-slider"
            min={metric.min}
            max={metric.max}
            step={metric.step}
            value={effectiveValue}
            onChange={(event) => onChange(metric.id, Number(event.target.value))}
            aria-label={metric.label}
          />
          <div className="rule-variance-item__scale" aria-hidden="true">
            <span>{formatVarianceValue(metric.min, metric.unit)}</span>
            <span>{formatVarianceValue(metric.max, metric.unit)}</span>
          </div>
          {isChanged ? (
            <button
              type="button"
              className="secondary-button rule-variance-item__reset"
              onClick={() => onReset(metric.id)}
            >
              Reset to default
            </button>
          ) : null}
        </>
      ) : (
        <p className="rule-variance-item__readonly">Read-only · Admins set thresholds</p>
      )}

      {consequence ? <p className="rule-variance-item__consequence">{consequence}</p> : null}
    </li>
  );
}

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
                <td className="cell-amount">{formatCurrency(row.amount)}</td>
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
    <section className="stats-grid" aria-label="Run statistics">
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

/** Verdict module: four KPI wells for the net figures the reviewer signs off on. */
function SummaryVerdict({
  run,
}: Readonly<{
  run: RunData;
}>) {
  const summary = run.summary;
  const difference = summary.unmatchedBankNetAmount - summary.unmatchedQboNetAmount;

  const figures: ReadonlyArray<{
    label: string;
    value: number;
    tone: 'neutral' | 'warning' | 'critical' | 'positive';
  }> = [
    { label: 'Bank unmatched (net)', value: summary.unmatchedBankNetAmount, tone: 'neutral' },
    { label: 'Book unmatched (net)', value: summary.unmatchedQboNetAmount, tone: 'neutral' },
    { label: 'Difference', value: difference, tone: difference === 0 ? 'neutral' : 'warning' },
    {
      label: 'Unexplained residual',
      value: summary.unresolvedExposure,
      tone: summary.unresolvedExposure === 0 ? 'positive' : 'critical',
    },
  ];

  return (
    <BentoModule span={6} title="Verdict" ariaLabel="Reconciliation verdict">
      <div className="kpi-wells">
        {figures.map((figure) => (
          <div key={figure.label} className="kpi-well" data-tone={figure.tone}>
            <span>{figure.label}</span>
            <strong>{formatCurrency(figure.value)}</strong>
          </div>
        ))}
      </div>
      <p className="bento-module__note">
        Balances are derived from net unmatched activity per source; the residual is the net dollar
        exposure remaining after exception classification.
      </p>
      <div className="bento-module__footer" aria-label="Prior-period comparison">
        <span className="eyebrow">Prior-period comparison</span>
        <p>
          Unavailable — the API does not yet expose previous runs for this account and period. This
          slot will populate once a prior-runs endpoint exists.
        </p>
      </div>
    </BentoModule>
  );
}

/** Match quality module: labeled 4px meters as shares of total records reviewed. */
function MatchQualityModule({
  summary,
  exceptionCount,
}: Readonly<{
  summary: RunData['summary'];
  exceptionCount: number;
}>) {
  const total = Math.max(summary.totalRecordsReviewed, 1);
  const meters: ReadonlyArray<{ label: string; count: number; tone: string }> = [
    { label: 'Exact matches', count: summary.exactMatches, tone: 'accent' },
    { label: 'Probable matches', count: summary.probableMatches, tone: 'accent' },
    { label: 'Exceptions', count: exceptionCount, tone: 'negative' },
    { label: 'Data quality issues', count: summary.dataQualityIssues, tone: 'high' },
  ];

  return (
    <BentoModule span={3} title="Match quality">
      <ul className="match-meters">
        {meters.map((meter) => {
          const percent = Math.min(Math.round((meter.count / total) * 100), 100);

          return (
            <li key={meter.label} className="match-meter">
              <div className="match-meter__head">
                <span>{meter.label}</span>
                <strong>{meter.count}</strong>
              </div>
              <div
                className="match-meter__track"
                role="img"
                aria-label={`${meter.label}: ${meter.count} of ${total} records (${percent}%)`}
              >
                <div
                  className="match-meter__fill"
                  data-tone={meter.tone}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </BentoModule>
  );
}

const materialityShareTarget = 0.8;

/** Materiality module: exposure concentration plus the view's single accent action into triage. */
function MaterialityModule({
  run,
  onOpenExceptions,
}: Readonly<{
  run: RunData;
  onOpenExceptions: () => void;
}>) {
  const magnitudes = run.exceptions.map((item) => Math.abs(item.amount ?? 0)).sort((a, b) => b - a);
  const totalAbs = magnitudes.reduce((sum, value) => sum + value, 0);

  let topCount = 0;
  let covered = 0;

  for (const value of magnitudes) {
    if (totalAbs === 0 || covered >= totalAbs * materialityShareTarget) {
      break;
    }

    covered += value;
    topCount += 1;
  }

  const coveredPercent = totalAbs === 0 ? 0 : Math.round((covered / totalAbs) * 100);
  const exceptionNoun = topCount === 1 ? 'exception accounts' : 'exceptions account';
  const message =
    totalAbs === 0
      ? 'Open exceptions carry no dollar exposure.'
      : `${topCount} ${exceptionNoun} for ${coveredPercent}% of residual exposure.`;

  return (
    <BentoModule span={3} title="Materiality" accent>
      <p className="materiality__count">{topCount}</p>
      <p className="materiality__message">{message}</p>
      <button type="button" className="accent-button" onClick={onOpenExceptions}>
        Review top exceptions
      </button>
    </BentoModule>
  );
}

/** Exposure module: label / bar / mono amount rows per exception category. */
function ExposureByCategoryModule({
  run,
}: Readonly<{
  run: RunData;
}>) {
  const rows = buildCategorySummaryRows(run);
  const maxAmount = Math.max(...rows.map((row) => Math.abs(row.amount)), 1);

  return (
    <BentoModule span={8} title="Exposure by category">
      {rows.length === 0 ? (
        <p className="bento-module__note">No classified exposure in this run.</p>
      ) : (
        <ul className="exposure-rows">
          {rows.map((row) => (
            <li key={row.category} className="exposure-row">
              <span className="exposure-row__label">{row.label}</span>
              <div
                className="exposure-row__track"
                role="img"
                aria-label={`${row.label}: ${formatCurrency(Math.abs(row.amount))} across ${row.count} item${row.count === 1 ? '' : 's'}`}
              >
                <div
                  className="exposure-row__bar"
                  style={{ width: `${Math.round((Math.abs(row.amount) / maxAmount) * 100)}%` }}
                />
              </div>
              <span className="exposure-row__amount">{formatCurrency(Math.abs(row.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </BentoModule>
  );
}

/** Watchlist module: exceptions the reviewer starred in triage; rows truncate, never overflow. */
function WatchlistModule({
  run,
  starredIds,
  onToggleStar,
}: Readonly<{
  run: RunData;
  starredIds: string[];
  onToggleStar: (exceptionId: string) => void;
}>) {
  const starred = run.exceptions.filter((item) => starredIds.includes(item.id));

  return (
    <BentoModule span={4} title="Watchlist">
      {starred.length === 0 ? (
        <p className="bento-module__note">
          No starred exceptions yet. Star items from the exception detail panel to pin them here.
        </p>
      ) : (
        <ul className="watchlist-rows">
          {starred.map((item) => (
            <li key={item.id} className="watchlist-row">
              <div className="watchlist-row__text">
                <span className="watchlist-row__label">
                  {errorCategoryDisplayNames[item.category] ?? item.category}
                </span>
                <span className="watchlist-row__meta">
                  {item.spreadsheetFileName} / {item.lineNumber}
                </span>
              </div>
              <span className="watchlist-row__amount">
                {item.amount === null ? '—' : formatCurrency(item.amount)}
              </span>
              <button
                type="button"
                className="watchlist-star watchlist-star--active"
                aria-label={`Remove ${errorCategoryDisplayNames[item.category] ?? item.category} from watchlist`}
                onClick={() => onToggleStar(item.id)}
              >
                ★
              </button>
            </li>
          ))}
        </ul>
      )}
    </BentoModule>
  );
}

function SummaryReportContent({
  run,
  onOpenExceptions,
  starredIds,
  onToggleStar,
}: Readonly<{
  run: RunData;
  onOpenExceptions: () => void;
  starredIds: string[];
  onToggleStar: (exceptionId: string) => void;
}>) {
  return (
    <div className="reports-display-stack">
      <div className="bento-grid">
        <SummaryVerdict run={run} />
        <MatchQualityModule summary={run.summary} exceptionCount={run.exceptions.length} />
        <MaterialityModule run={run} onOpenExceptions={onOpenExceptions} />
        <ExposureByCategoryModule run={run} />
        <WatchlistModule run={run} starredIds={starredIds} onToggleStar={onToggleStar} />
      </div>
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
  actionLabel,
  onAction,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: ReactNode;
  role?: 'alert' | 'status';
  ariaLive?: 'off' | 'polite' | 'assertive';
  actionLabel?: string;
  onAction?: () => void;
}>) {
  return (
    <div className="empty-state-card" role={role} aria-live={ariaLive}>
      <span className="eyebrow">{eyebrow}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          className="secondary-button empty-state-card__action"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
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
  const virtualListRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualizeRows = probableMatches.length > probableMatchVirtualizationThreshold;
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: probableMatches.length,
    getScrollElement: () => virtualListRef.current,
    estimateSize: () => 148,
    overscan: 8,
    enabled: shouldVirtualizeRows,
  });
  const virtualRows = virtualizer.getVirtualItems();

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
    <div className="probable-match-table-shell">
      <div className="table-results-meta" aria-live="polite">
        <span>Showing {probableMatches.length} probable matches.</span>
        {shouldVirtualizeRows ? (
          <span>Virtualized view enabled for large probable-match result sets.</span>
        ) : null}
      </div>
      {shouldVirtualizeRows ? (
        <div className="probable-match-virtual-list" ref={virtualListRef}>
          <div
            className="probable-match-virtual-list__canvas"
            style={{
              height: `${virtualizer.getTotalSize()}px`,
            }}
          >
            {virtualRows.map((virtualRow) => {
              const item = probableMatches[virtualRow.index];

              if (!item) {
                return null;
              }

              return (
                <article
                  className="probable-match-virtual-card"
                  key={`probable-virtual-${item.id}`}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="probable-match-virtual-card__head">
                    <strong>{item.ruleName}</strong>
                    <span>
                      {item.disposition} • {item.confidence}
                    </span>
                  </div>
                  <div className="probable-match-virtual-card__grid">
                    <div>
                      <span>Date diff</span>
                      <strong>{item.dateDifferenceDays ?? 'N/A'}</strong>
                    </div>
                    <div>
                      <span>Amount diff</span>
                      <strong>{formatCurrency(item.amountDifference)}</strong>
                    </div>
                  </div>
                  <p>{item.evidence.join(' | ')}</p>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="table-scroll probable-match-table-shell__table">
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
                  <td className="cell-amount">{formatCurrency(item.amountDifference)}</td>
                  <td>{item.evidence.join(' | ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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

/** Panel that renders the Review stage for the rail-selected view: Summary, Probable matches, or Exceptions. */
export function ReviewSection({
  run,
  activeView,
  isHydrating,
  loadError,
  onGoToSetup,
  decisionByTargetId,
  pendingTargetId,
  decisionError,
  lastChange,
  onDecide,
  onClearDecision,
  onUndoLastDecision,
  pendingSavedViewId,
  onPendingSavedViewApplied,
  onOpenExceptions,
  starredIds,
  onToggleStar,
  density = 'comfortable',
}: Readonly<{
  run: RunData | undefined;
  activeView: ReportView;
  isHydrating: boolean;
  loadError: string | null;
  onGoToSetup: () => void;
  decisionByTargetId: Record<string, ReviewerDecision>;
  pendingTargetId: string | null;
  decisionError: string | null;
  lastChange: { targetId: string; label: string } | null;
  onDecide: (targetId: string, action: DecisionAction, notes?: string) => void;
  onClearDecision: (targetId: string) => void;
  onUndoLastDecision: () => void;
  pendingSavedViewId: string | null;
  onPendingSavedViewApplied: () => void;
  onOpenExceptions: () => void;
  starredIds: string[];
  onToggleStar: (exceptionId: string) => void;
  density?: 'comfortable' | 'compact';
}>) {
  let panelContent: ReactNode;

  if (run) {
    const contentByView: Record<ReportView, ReactNode> = {
      summary: (
        <SummaryReportContent
          run={run}
          onOpenExceptions={onOpenExceptions}
          starredIds={starredIds}
          onToggleStar={onToggleStar}
        />
      ),
      'probable-matches': <ProbableMatchesContent probableMatches={run.probableMatches} />,
      exceptions: (
        <ExceptionTriage
          exceptions={run.exceptions}
          decisionByTargetId={decisionByTargetId}
          pendingTargetId={pendingTargetId}
          decisionError={decisionError}
          lastChange={lastChange}
          onDecide={onDecide}
          onClearDecision={onClearDecision}
          onUndoLastDecision={onUndoLastDecision}
          pendingSavedViewId={pendingSavedViewId}
          onPendingSavedViewApplied={onPendingSavedViewApplied}
          starredIds={starredIds}
          onToggleStar={onToggleStar}
          density={density}
        />
      ),
    };

    panelContent = contentByView[activeView];
  } else if (isHydrating) {
    panelContent = (
      <EmptyStateCard
        eyebrow="Loading latest run"
        title="Loading review output"
        description="Retrieving the most recent reconciliation run from the backend so the selected panel can render with saved data."
        role="status"
        ariaLive="polite"
      />
    );
  } else if (loadError) {
    panelContent = (
      <EmptyStateCard
        eyebrow="Unable to load review"
        title="Latest review output could not be loaded"
        description={loadError}
        role="alert"
      />
    );
  } else {
    panelContent = (
      <EmptyStateCard
        eyebrow="Awaiting run"
        title="No review output yet"
        description="Run a reconciliation from the Setup tab, then review the summary, probable matches, and exceptions here."
        actionLabel="Go to Setup"
        onAction={onGoToSetup}
      />
    );
  }

  return (
    <section
      id={`tab-panel-${activeView}`}
      role="tabpanel"
      aria-labelledby={`tab-${activeView}`}
      aria-live="polite"
      aria-busy={isHydrating}
    >
      <SectionCard
        title="Review"
        description="Work through the reconciliation verdict, confirm probable matches, and triage exceptions in one place."
      >
        {panelContent}
      </SectionCard>
    </section>
  );
}

/** Panel that renders the Close & export stage: workbook and JSON outputs plus a close summary. */
export function CloseExportSection({
  run,
  isHydrating,
  loadError,
  onDownloadWorkbook,
  onExportJson,
  onGoToSetup,
}: Readonly<{
  run: RunData | undefined;
  isHydrating: boolean;
  loadError: string | null;
  onDownloadWorkbook: () => void;
  onExportJson: () => void;
  onGoToSetup: () => void;
}>) {
  let content: ReactNode;

  if (run) {
    content = (
      <div className="reports-display-stack">
        <div className="summary-badges">
          <span>{run.exceptions.length} exceptions</span>
          <span>{formatCurrency(run.summary.unresolvedExposure)} exposure</span>
          <span>{run.sourceFiles.map((item) => item.fileName).join(' + ')}</span>
        </div>
        <ExportArtifactsContent
          run={run}
          onDownloadWorkbook={onDownloadWorkbook}
          onExportJson={onExportJson}
        />
      </div>
    );
  } else if (isHydrating) {
    content = (
      <EmptyStateCard
        eyebrow="Loading latest run"
        title="Loading export artifacts"
        description="Retrieving the most recent reconciliation run so its workbook and JSON exports can be prepared."
        role="status"
        ariaLive="polite"
      />
    );
  } else if (loadError) {
    content = (
      <EmptyStateCard
        eyebrow="Unable to load run"
        title="Export artifacts could not be loaded"
        description={loadError}
        role="alert"
      />
    );
  } else {
    content = (
      <EmptyStateCard
        eyebrow="Awaiting run"
        title="Nothing to export yet"
        description="Run a reconciliation from the Setup tab. The workbook and JSON exports will be available here once a run completes."
        actionLabel="Go to Setup"
        onAction={onGoToSetup}
      />
    );
  }

  return (
    <WorkspaceTabPanel tabId="close">
      <SectionCard
        title="Close & export"
        description="Download the audit workbook and JSON archive for this reconciliation run. Export lives only on this screen."
      >
        {content}
      </SectionCard>
    </WorkspaceTabPanel>
  );
}

/** Rules catalog surface reached via the run bar (?panel=rules): read-only for non-admins. */
/** Rules catalog surface reached via the run bar (?panel=rules): read-only for non-admins. */
export function RulesCatalogSection({
  rules,
  metrics,
  varianceOverrides,
  canAdjustVarianceDefaults,
  onChangeVarianceDefault,
  onResetVarianceDefault,
  onResetVarianceDefaults,
  run,
  thresholdSetLabel,
  thresholdSetTimestamp,
  onClose,
}: Readonly<{
  rules: RuleCatalogItem[];
  metrics: RuleVarianceMetric[];
  varianceOverrides: RuleVarianceDefaultOverrides;
  canAdjustVarianceDefaults: boolean;
  onChangeVarianceDefault: (metricId: string, value: number) => void;
  onResetVarianceDefault: (metricId: string) => void;
  onResetVarianceDefaults: () => void;
  run: RunData | undefined;
  thresholdSetLabel: string;
  thresholdSetTimestamp: string;
  onClose?: () => void;
}>) {
  const changedCount = metrics.filter(
    (metric) => varianceOverrides[metric.id] !== undefined,
  ).length;

  return (
    <section className="rules-route-panel" aria-label="Rules catalog">
      {onClose ? (
        <button
          type="button"
          className="secondary-button rules-route-panel__back"
          onClick={onClose}
        >
          Back to workspace
        </button>
      ) : null}
      <SectionCard
        title="Rules Catalog"
        description="Current matching and classification rules surfaced from the reconciliation rulebook so reviewers can see the active decision logic in one place."
      >
        <div className="threshold-set-banner" aria-label="Threshold set version">
          <div>
            <span>Threshold set</span>
            <strong>{thresholdSetLabel}</strong>
          </div>
          <div>
            <span>Updated</span>
            <strong>{thresholdSetTimestamp}</strong>
          </div>
          <div>
            <span>Changed metrics</span>
            <strong>{changedCount}</strong>
          </div>
        </div>

        {canAdjustVarianceDefaults ? (
          <div className="rules-admin-controls">
            <p>Admin control mode is enabled.</p>
            <p>Threshold updates adjust the shared default variance thresholds.</p>
            <button
              type="button"
              className="secondary-button"
              onClick={onResetVarianceDefaults}
              disabled={changedCount === 0}
            >
              Reset all thresholds
            </button>
          </div>
        ) : null}

        <div className="rule-variance-families" aria-label="Variance thresholds">
          <h3>Variance thresholds</h3>
          {varianceMetricFamilyOrder.map((family) => {
            const familyMetrics = metrics.filter((metric) => metric.family === family);

            if (familyMetrics.length === 0) {
              return null;
            }

            return (
              <details key={family} className="rule-family-group" open>
                <summary>
                  {varianceMetricFamilyLabels[family]} ({familyMetrics.length})
                </summary>
                <ul className="rule-variance-list">
                  {familyMetrics.map((metric) => (
                    <RuleVarianceControl
                      key={metric.id}
                      metric={metric}
                      effectiveValue={varianceOverrides[metric.id] ?? metric.value}
                      isChanged={varianceOverrides[metric.id] !== undefined}
                      canAdjust={canAdjustVarianceDefaults}
                      consequence={buildMetricConsequence(metric.id, run)}
                      onChange={onChangeVarianceDefault}
                      onReset={onResetVarianceDefault}
                    />
                  ))}
                </ul>
              </details>
            );
          })}
        </div>

        <div className="rules-reference" aria-label="Rule reference">
          <h3>Rule reference</h3>
          <div className="rules-grid">
            {rules.map((rule) => (
              <article key={rule.id} className="rule-card">
                <div className="rule-card__header">
                  <h4>{rule.name}</h4>
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
        </div>
      </SectionCard>
    </section>
  );
}

/** Panel that shows the step-by-step progress stepper while a reconciliation run is in flight. */
export function ProcessProgressSection({
  overallProgressPercent,
  progressSteps,
  elapsedLabel,
}: Readonly<{
  overallProgressPercent: number;
  progressSteps: ProgressStep[];
  elapsedLabel?: string | null;
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
          {elapsedLabel ? <p className="overall-progress-elapsed">Elapsed {elapsedLabel}</p> : null}
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
                {step.detail ? <p className="step-progress-detail">{step.detail}</p> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </SectionCard>
  );
}
