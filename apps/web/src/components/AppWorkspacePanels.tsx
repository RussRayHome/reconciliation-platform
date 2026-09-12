import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  errorCategories,
  errorCategoryDisplayNames,
  type MatchingConfigVersion,
  type ReconciliationRunReport,
  type ReviewerDecision,
  type RuleCatalogEntry,
  type RuleFamily,
  type RuleVarianceMetric,
} from '@recon/domain';
import { SectionCard, StatCard } from '@recon/ui';
import { useVirtualizer } from '@tanstack/react-virtual';

import { downloadWorkbookRequest } from '../lib/api';
import type { DecisionAction } from '../hooks/useReviewerDecisions';
import type { PriorPeriodRollforward } from '../hooks/usePriorPeriodRollforward';
import { formatCompactDate, formatCurrency, formatCurrencyWhole, formatShortDate } from '../lib/format';
import { computeRuleVersionHeaderState, type RuleVersionHeaderState } from '../lib/ruleVersionState';
import {
  deriveMetricStep,
  describeActiveFilters,
  filterRules,
  formatMetricLabel,
  formatVarianceMetricValue,
  parseRuleFamilyParam,
  parseTunableParam,
  ruleFamilyToSlug,
} from '../lib/ruleFilters';
import { summaryStatDefinitions, type ReportView } from '../lib/appCatalog';
import { ChartsPanel } from './ChartsPanel';
import { BentoModule } from './BentoModule';
import {
  SkeletonLines,
  SkeletonPanel,
  SummaryDashboardSkeleton,
  TableSkeleton,
  TriageSkeleton,
} from './Skeleton';
import { ExceptionTriage } from './ExceptionTriage';
import { SemanticIcon } from './SemanticIcon';
import { describeConfidence, groupByConfidence } from '../lib/matchConfidenceBands';

/** R2 V2: one `status` field instead of two booleans -- `isComplete`/`isCurrent` couldn't express
 * a terminal failure (a failed run would sit at `isCurrent: true` forever) or a queued run.
 * `ready` is distinct from `current`: the run step reads `ready` once everything is staged but
 * nothing has been submitted yet, and only becomes `current` once a submission is actually in
 * flight -- collapsing the two would mean "Run reconciliation" reads "In progress" before the user
 * has even clicked Submit. `not-run` is for a step positioned after a *failure* specifically
 * (never after a queued phase, which still expects to proceed) -- reuses the ordered-gate honesty
 * `ImportFailureGateSequenceEntry`'s `NOT_RUN` vocabulary already established for file validation. */
export type ProgressStepStatus =
  | 'complete'
  | 'current'
  | 'queued'
  | 'failed'
  | 'ready'
  | 'pending'
  | 'not-run';

export type ProgressStep = {
  id: string;
  label: string;
  description: string;
  status: ProgressStepStatus;
  detail?: string;
};

type RunData = ReconciliationRunReport;

/** usePriorPeriodRollforward's return shape (PR F.3) -- named here so every layer between
 * ReviewSection and SummaryVerdict shares one type instead of re-deriving it. */
type PriorPeriodRollforwardState = {
  status: 'idle' | 'loading' | 'none' | 'loaded' | 'error';
  data: PriorPeriodRollforward | null;
};

type CategorySummaryRow = {
  category: string;
  label: string;
  count: number;
  amount: number;
};

export type RuleVarianceDefaultOverrides = Record<string, number>;

/** A lookup, not a branch per state -- adding an eighth status later is a map entry, the reason
 * V2 replaced the old two-boolean shape in the first place. */
const STEP_STATE_BY_STATUS: Record<ProgressStepStatus, { className: string; label: string }> = {
  complete: { className: 'step-progress-state--complete', label: 'Complete' },
  current: { className: 'step-progress-state--current', label: 'In progress' },
  queued: { className: 'step-progress-state--queued', label: 'Queued' },
  failed: { className: 'step-progress-state--failed', label: 'Failed' },
  ready: { className: 'step-progress-state--ready', label: 'Ready' },
  pending: { className: 'step-progress-state--pending', label: 'Pending' },
  'not-run': { className: 'step-progress-state--not-run', label: 'Not run' },
};

const resolveStepState = (status: ProgressStepStatus): { className: string; label: string } =>
  STEP_STATE_BY_STATUS[status];

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

const metricConsequenceByMetric: Record<
  string,
  { label: string; value: (summary: RunData['summary']) => number }
> = {
  amountTolerance: { label: 'clean matches', value: (summary) => summary.exactMatches },
  dateToleranceDays: { label: 'date variances', value: (summary) => summary.dateVariances },
  timingDifferenceDays: {
    label: 'timing differences',
    value: (summary) => summary.timingDifferences,
  },
  textSimilarityThreshold: {
    label: 'probable matches',
    value: (summary) => summary.probableMatches,
  },
  probableTextSimilarityThreshold: {
    label: 'probable matches',
    value: (summary) => summary.probableMatches,
  },
  amountMismatchTextSimilarityThreshold: {
    label: 'amount mismatches',
    value: (summary) => summary.amountMismatches,
  },
  duplicateDateWindowDays: {
    label: 'duplicate entries',
    value: (summary) => summary.bankDuplicates + summary.glDuplicates,
  },
  duplicateSimilarityThreshold: {
    label: 'duplicate entries',
    value: (summary) => summary.bankDuplicates + summary.glDuplicates,
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
/** DOM id `RuleGridTunableCell` scrolls to and `RuleVarianceControl` exposes, so clicking TUNABLE on a rule row reaches its metric. */
const varianceMetricElementId = (metricId: string): string => `variance-metric-${metricId}`;

function RuleVarianceControl({
  metric,
  effectiveValue,
  isChanged,
  canAdjust,
  consequence,
  isHighlighted,
  onChange,
  onReset,
}: Readonly<{
  metric: RuleVarianceMetric;
  effectiveValue: number;
  isChanged: boolean;
  canAdjust: boolean;
  consequence: string | null;
  isHighlighted?: boolean;
  onChange: (metricId: string, value: number) => void;
  onReset: (metricId: string) => void;
}>) {
  const label = formatMetricLabel(metric.id);

  return (
    <li
      id={varianceMetricElementId(metric.id)}
      className={
        isHighlighted ? 'rule-variance-item rule-variance-item--highlighted' : 'rule-variance-item'
      }
    >
      <div className="rule-variance-item__head">
        <span>{label}</span>
        <strong>{formatVarianceMetricValue(effectiveValue, metric.unit)}</strong>
      </div>
      <p className="rule-variance-item__default">
        Default {formatVarianceMetricValue(metric.default, metric.unit)}
        {isChanged ? <span className="rule-variance-item__changed">Changed</span> : null}
      </p>

      {canAdjust ? (
        <>
          <input
            type="range"
            className="rule-variance-slider"
            min={metric.min}
            max={metric.max}
            step={deriveMetricStep(metric)}
            value={effectiveValue}
            onChange={(event) => onChange(metric.id, Number(event.target.value))}
            aria-label={label}
          />
          <div className="rule-variance-item__scale" aria-hidden="true">
            <span>{formatVarianceMetricValue(metric.min, metric.unit)}</span>
            <span>{formatVarianceMetricValue(metric.max, metric.unit)}</span>
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
      ) : null}

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

/** Unreconciled Item Roll-Forward PR F.3: the Verdict module's Prior-period comparison content,
 * split out for its own set of end states (loading/error/none/loaded) -- see
 * usePriorPeriodRollforward's own doc comment for why each is shown differently rather than
 * collapsing to a single "unavailable" message. */
function PriorPeriodComparison({
  priorPeriodRollforward,
}: Readonly<{ priorPeriodRollforward: PriorPeriodRollforwardState }>) {
  if (priorPeriodRollforward.status === 'idle' || priorPeriodRollforward.status === 'loading') {
    return <p>Loading…</p>;
  }

  if (priorPeriodRollforward.status === 'error') {
    return <p>Couldn&rsquo;t load the prior period&rsquo;s roll-forward. Try reloading.</p>;
  }

  if (priorPeriodRollforward.status === 'none' || !priorPeriodRollforward.data) {
    return (
      <p>
        No closed prior period found for this account yet. This slot populates once a prior
        period has been closed (see Close Period).
      </p>
    );
  }

  const { periodLabel, snapshots } = priorPeriodRollforward.data;
  const closingCount = snapshots.reduce((total, snapshot) => total + snapshot.closingCount, 0);
  const closingAmount = snapshots.reduce((total, snapshot) => total + snapshot.closingAmount, 0);
  const clearedCount = snapshots.reduce((total, snapshot) => total + snapshot.clearedCount, 0);

  return (
    <p>
      <strong>{periodLabel}</strong> closed with {closingCount} item{closingCount === 1 ? '' : 's'}{' '}
      still open ({formatCurrencyWhole(closingAmount)}), carried into this period. {clearedCount}{' '}
      item{clearedCount === 1 ? '' : 's'} cleared that period.
    </p>
  );
}

/** Verdict module: four KPI wells for the net figures the reviewer signs off on. */
function SummaryVerdict({
  run,
  priorPeriodRollforward,
}: Readonly<{
  run: RunData;
  priorPeriodRollforward: PriorPeriodRollforwardState;
}>) {
  const summary = run.summary;
  const difference = summary.unmatchedBankNetAmount - summary.unmatchedGlNetAmount;

  const figures: ReadonlyArray<{
    label: string;
    value: number;
    tone: 'neutral' | 'warning' | 'critical' | 'positive';
  }> = [
    { label: 'Bank unmatched (net)', value: summary.unmatchedBankNetAmount, tone: 'neutral' },
    { label: 'Book unmatched (net)', value: summary.unmatchedGlNetAmount, tone: 'neutral' },
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
            <strong>{formatCurrencyWhole(figure.value)}</strong>
          </div>
        ))}
      </div>
      <p className="bento-module__note">
        Balances are derived from net unmatched activity per source; the residual is the net dollar
        exposure remaining after exception classification.
      </p>
      <div className="bento-module__footer" aria-label="Prior-period comparison">
        <span className="eyebrow">Prior-period comparison</span>
        <PriorPeriodComparison priorPeriodRollforward={priorPeriodRollforward} />
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
  priorPeriodRollforward,
  onOpenExceptions,
  starredIds,
  onToggleStar,
}: Readonly<{
  run: RunData;
  priorPeriodRollforward: PriorPeriodRollforwardState;
  onOpenExceptions: () => void;
  starredIds: string[];
  onToggleStar: (exceptionId: string) => void;
}>) {
  return (
    <div className="reports-display-stack">
      <div className="bento-grid">
        <SummaryVerdict run={run} priorPeriodRollforward={priorPeriodRollforward} />
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

      {/* UI-10 (#449). Bands come from `confidence`, never from a score percentage -- the engine's
          `score` is a rule-precedence rank, so a displayed "%" would imply a calibrated likelihood
          it does not compute. Decided 2026-09-12; the reasoning lives in matchConfidenceBands.ts.

          A summary rather than a regrouped list: the virtualized branch below depends on one flat
          array, and splitting it into per-band virtualizers to avoid one extra line of reading
          would trade a real correctness risk for a cosmetic gain. */}
      <ul className="probable-match-bands">
        {groupByConfidence(probableMatches).map((band) => (
          <li key={band.confidence} className="probable-match-bands__item">
            <span className="probable-match-bands__label">{band.label}</span>
            <span className="probable-match-bands__count">{band.matches.length}</span>
            <span className="probable-match-bands__meaning">{band.meaning}</span>
          </li>
        ))}
      </ul>
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
                  <td>
                    <span className="badge" title={describeConfidence(item.confidence).meaning}>
                      {describeConfidence(item.confidence).label}
                    </span>
                  </td>
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
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              // A plain <a href> can't carry the bearer token now that this route requires auth,
              // so the download goes through fetch + a blob URL instead of top-level navigation.
              void downloadWorkbookRequest(run.id, run.outputWorkbook?.fileName ?? `${run.id}.xlsx`)
                .then(onDownloadWorkbook)
                .catch((error: unknown) => {
                  console.error('Workbook download failed', error);
                });
            }}
          >
            Download workbook
          </button>
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
  priorPeriodRollforward,
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
  onChangeDensity,
}: Readonly<{
  run: RunData | undefined;
  priorPeriodRollforward: PriorPeriodRollforwardState;
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
  onChangeDensity: (density: 'comfortable' | 'compact') => void;
}>) {
  let panelContent: ReactNode;

  if (run) {
    const contentByView: Record<ReportView, ReactNode> = {
      summary: (
        <SummaryReportContent
          run={run}
          priorPeriodRollforward={priorPeriodRollforward}
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
          onChangeDensity={onChangeDensity}
        />
      ),
    };

    panelContent = contentByView[activeView];
  } else if (isHydrating) {
    const skeletonByView: Record<ReportView, ReactNode> = {
      summary: <SummaryDashboardSkeleton />,
      'probable-matches': <TableSkeleton rows={8} columns={5} />,
      exceptions: <TriageSkeleton />,
    };

    panelContent = (
      <SkeletonPanel label="Loading review output">{skeletonByView[activeView]}</SkeletonPanel>
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
    <section aria-live="polite" aria-busy={isHydrating}>
      <SectionCard
        title="Review"
        description="Work through the reconciliation verdict, confirm probable matches, and triage exceptions in one place."
      >
        {panelContent}
      </SectionCard>
    </section>
  );
}

/** Panel that renders the Export stage: workbook and JSON outputs plus a close summary. */
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
      <SkeletonPanel label="Loading export artifacts">
        <SkeletonLines count={2} />
        <TableSkeleton rows={2} columns={3} />
      </SkeletonPanel>
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
    <SectionCard
      title="Export"
      description="Download the audit workbook and JSON archive for this reconciliation run. Export lives only on this screen."
    >
      {content}
    </SectionCard>
  );
}

/**
 * Top-of-screen version badge, publish metadata, header actions, and the one state banner for
 * the Matching Rules panel. `viewingVersion` supplies the badge/publish metadata (the ACTIVE
 * version normally, or a SUPERSEDED version when browsing history); `state` — from
 * `computeRuleVersionHeaderState` — selects which banner (if any) renders below it.
 */
export function RuleVersionHeader({
  state,
  viewingVersion,
  canAdjustVarianceDefaults,
  onEditAsDraft,
  onCompareVersions,
  onViewHistory,
  onBackToActive,
  onPublishDraft,
}: Readonly<{
  state: RuleVersionHeaderState;
  viewingVersion: MatchingConfigVersion | null;
  canAdjustVarianceDefaults: boolean;
  onEditAsDraft?: () => void;
  onCompareVersions?: () => void;
  onViewHistory?: () => void;
  onBackToActive?: () => void;
  onPublishDraft?: () => void;
}>) {
  return (
    <div className="rule-version-header" data-state={state}>
      <div className="rule-version-header__row">
        <div className="rule-version-header__meta">
          {viewingVersion ? (
            <>
              <span
                className={`rule-version-badge rule-version-badge--${viewingVersion.status.toLowerCase()}`}
              >
                v{viewingVersion.versionNumber} · {viewingVersion.status}
              </span>
              {viewingVersion.status === 'DRAFT' ? (
                <span className="rule-version-header__detail">
                  Waiting on {viewingVersion.pendingApprovalOwner ?? 'an approver'}
                </span>
              ) : (
                <span className="rule-version-header__detail">
                  Published by {viewingVersion.publishedBy ?? '—'} ·{' '}
                  {formatShortDate(viewingVersion.publishedAt)}
                  {viewingVersion.effectiveAt
                    ? ` · effective ${formatShortDate(viewingVersion.effectiveAt)}`
                    : ''}
                </span>
              )}
              <button
                type="button"
                className="rule-version-header__link"
                onClick={onViewHistory}
                disabled={!onViewHistory}
              >
                Version history
              </button>
            </>
          ) : (
            <span className="rule-version-header__detail">No version has been published yet.</span>
          )}
        </div>
        <div className="rule-version-header__actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onCompareVersions}
            disabled={!viewingVersion || !onCompareVersions}
          >
            Compare versions
          </button>
          <button
            type="button"
            className="accent-button"
            onClick={onEditAsDraft}
            disabled={state === 'read-only'}
          >
            Edit as draft
          </button>
        </div>
      </div>

      {state === 'not-applied' ? (
        <div className="rule-version-banner rule-version-banner--warning" role="status">
          <SemanticIcon name="exceptions" aria-hidden="true" />
          <div>
            <strong>Not applied — thresholds are not reaching the engine</strong>
            <p>
              Every run currently uses <code>defaultReconciliationConfig</code>. Editing is
              disabled until overrides are threaded into the reconciliation pipeline.
            </p>
          </div>
        </div>
      ) : null}

      {state === 'read-only' ? (
        <div className="rule-version-banner rule-version-banner--muted" role="status">
          Read-only — admins set thresholds.
        </div>
      ) : null}

      {state === 'draft-pending' ? (
        <div className="rule-version-banner rule-version-banner--pending" role="status">
          <span>Reviewing draft v{viewingVersion?.versionNumber} against the active version.</span>
          {canAdjustVarianceDefaults ? (
            <button type="button" className="rule-version-header__link" onClick={onPublishDraft}>
              Publish now
            </button>
          ) : null}
        </div>
      ) : null}

      {state === 'superseded' ? (
        <div className="rule-version-banner rule-version-banner--muted" role="status">
          <span>You are viewing a superseded version.</span>
          <button
            type="button"
            className="rule-version-header__link"
            onClick={onBackToActive}
            disabled={!onBackToActive}
          >
            Back to active
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Rules catalog surface reached via the run bar (?panel=rules): read-only for non-admins. */
const RULE_FAMILY_CHIP_LABELS: Record<RuleFamily, string> = {
  Matching: 'Matching',
  'Grouped roll-up': 'Grouped roll-up',
  Classifier: 'Classifier',
};

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
  viewingVersion,
  overridesAppliedToEngine,
  onEditAsDraft,
  onCompareVersions,
  onViewHistory,
  onBackToActive,
  onPublishDraft,
  versionActionError,
  activeVersion,
  mappingProfiles,
}: Readonly<{
  rules: RuleCatalogEntry[];
  metrics: RuleVarianceMetric[];
  varianceOverrides: RuleVarianceDefaultOverrides;
  canAdjustVarianceDefaults: boolean;
  onChangeVarianceDefault: (metricId: string, value: number) => void;
  onResetVarianceDefault: (metricId: string) => void;
  onResetVarianceDefaults: () => void;
  run: RunData | undefined;
  thresholdSetLabel: string;
  thresholdSetTimestamp: string;
  /** The version whose metadata the header displays -- the ACTIVE version normally, or a SUPERSEDED version when browsing history. */
  viewingVersion: MatchingConfigVersion | null;
  overridesAppliedToEngine: boolean;
  onEditAsDraft?: () => void;
  onCompareVersions?: () => void;
  onViewHistory?: () => void;
  onBackToActive?: () => void;
  onPublishDraft?: () => void;
  versionActionError?: string | null;
  /** The org's published ACTIVE version, for the rule grid's LAST CHANGE column -- distinct from `viewingVersion`, which may be a draft. */
  activeVersion: MatchingConfigVersion | null;
  /** Distinct saved mapping profile names -- shown identically on every rule row (global scope) until per-rule assignment ships in Phase 4. */
  mappingProfiles: string[];
}>) {
  const changedCount = metrics.filter(
    (metric) => varianceOverrides[metric.id] !== undefined,
  ).length;
  const versionHeaderState = computeRuleVersionHeaderState({
    viewingVersion,
    canAdjustVarianceDefaults,
    overridesAppliedToEngine,
  });
  // The state, not the raw role permission, gates real editing -- an admin viewing a draft,
  // a superseded version, or the ACTIVE version while overrides still aren't wired to the
  // engine must not be able to submit an override, regardless of their role.
  const isEditable = versionHeaderState === 'admin-editable';

  const [searchParams, setSearchParams] = useSearchParams();
  const familyFilter = parseRuleFamilyParam(searchParams.get('family'));
  const tunableFilter = parseTunableParam(searchParams.get('tunable'));
  const urlSearch = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(urlSearch);

  // Filtering is instant (43 rows, no server round-trip) -- only the URL write is debounced, so
  // fast typing doesn't spam browser history/re-render the address bar on every keystroke.
  useEffect(() => {
    const handle = globalThis.setTimeout(() => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (searchInput.trim()) {
            next.set('q', searchInput);
          } else {
            next.delete('q');
          }
          return next;
        },
        { replace: true },
      );
    }, 250);

    return () => globalThis.clearTimeout(handle);
    // setSearchParams's identity is stable per react-router; only the debounced value should retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const setFamilyFilter = (family: RuleFamily | null): void => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (family) {
          next.set('family', ruleFamilyToSlug(family));
        } else {
          next.delete('family');
        }
        return next;
      },
      { replace: true },
    );
  };

  const setTunableFilter = (tunable: boolean | null): void => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (tunable === null) {
          next.delete('tunable');
        } else {
          next.set('tunable', String(tunable));
        }
        return next;
      },
      { replace: true },
    );
  };

  const clearAllFilters = (): void => {
    setSearchInput('');
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('q');
        next.delete('family');
        next.delete('tunable');
        return next;
      },
      { replace: true },
    );
  };

  const activeFilters = { search: searchInput, family: familyFilter, tunable: tunableFilter };
  const filteredRules = useMemo(
    () => filterRules(rules, activeFilters),
    // activeFilters is a fresh object every render; its members are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules, searchInput, familyFilter, tunableFilter],
  );
  const hasActiveFilters = Boolean(searchInput.trim()) || familyFilter !== null || tunableFilter !== null;

  const totalTunableCount = rules.filter((rule) => rule.tunable).length;
  const totalFixedCount = rules.length - totalTunableCount;

  // Clicking a rule's TUNABLE cell scrolls to and briefly highlights the metric rows it
  // governs -- the many-to-many rule<->metric relationship is otherwise invisible.
  const [highlightedMetricIds, setHighlightedMetricIds] = useState<Set<string>>(new Set());

  const scrollToRuleMetrics = (rule: RuleCatalogEntry): void => {
    if (rule.varianceMetricIds.length === 0) {
      return;
    }

    document
      .getElementById(varianceMetricElementId(rule.varianceMetricIds[0] as string))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMetricIds(new Set(rule.varianceMetricIds));
    globalThis.setTimeout(() => setHighlightedMetricIds(new Set()), 2000);
  };

  const ruleLastChange = (rule: RuleCatalogEntry): string => {
    if (!activeVersion) {
      return '—';
    }

    const touchesRule = rule.varianceMetricIds.some(
      (metricId) => activeVersion.varianceOverrides[metricId] !== undefined,
    );
    return touchesRule ? formatCompactDate(activeVersion.publishedAt) : '—';
  };

  return (
    <section className="rules-route-panel" aria-label="Rules catalog">
      <SectionCard
        title="Matching Rules"
        description="Current matching and classification rules surfaced from the reconciliation rulebook so reviewers can see the active decision logic in one place."
      >
        <RuleVersionHeader
          state={versionHeaderState}
          viewingVersion={viewingVersion}
          canAdjustVarianceDefaults={canAdjustVarianceDefaults}
          onEditAsDraft={onEditAsDraft}
          onCompareVersions={onCompareVersions}
          onViewHistory={onViewHistory}
          onBackToActive={onBackToActive}
          onPublishDraft={onPublishDraft}
        />

        {versionActionError ? (
          <p className="rule-version-header__error" role="alert">
            {versionActionError}
          </p>
        ) : null}

        {isEditable ? (
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
        ) : null}

        {isEditable ? (
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
          <ul className="rule-variance-list">
            {metrics.map((metric) => (
              <RuleVarianceControl
                key={metric.id}
                metric={metric}
                effectiveValue={varianceOverrides[metric.id] ?? metric.default}
                isChanged={varianceOverrides[metric.id] !== undefined}
                canAdjust={isEditable}
                consequence={buildMetricConsequence(metric.id, run)}
                isHighlighted={highlightedMetricIds.has(metric.id)}
                onChange={onChangeVarianceDefault}
                onReset={onResetVarianceDefault}
              />
            ))}
          </ul>
        </div>

        <div className="rules-reference" aria-label="Rule reference">
          <h3>Rule reference</h3>

          <div className="rules-filter-bar">
            <label className="rules-search">
              <SemanticIcon name="search" aria-hidden="true" />
              <span className="visually-hidden">Search rules</span>
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={`Search ${rules.length} rules`}
              />
            </label>

            <div className="rules-filter-chips" role="group" aria-label="Filter by family">
              <button
                type="button"
                className={
                  familyFilter === null ? 'rules-filter-chip rules-filter-chip--active' : 'rules-filter-chip'
                }
                onClick={() => setFamilyFilter(null)}
              >
                All families
              </button>
              {(Object.keys(RULE_FAMILY_CHIP_LABELS) as RuleFamily[]).map((family) => (
                <button
                  key={family}
                  type="button"
                  className={
                    familyFilter === family
                      ? 'rules-filter-chip rules-filter-chip--active'
                      : 'rules-filter-chip'
                  }
                  onClick={() => setFamilyFilter(family)}
                >
                  {RULE_FAMILY_CHIP_LABELS[family]}
                </button>
              ))}
            </div>

            <div className="rules-filter-chips" role="group" aria-label="Filter by tunability">
              <button
                type="button"
                className={
                  tunableFilter === true
                    ? 'rules-filter-chip rules-filter-chip--active'
                    : 'rules-filter-chip'
                }
                onClick={() => setTunableFilter(tunableFilter === true ? null : true)}
              >
                Tunable only
              </button>
              <button
                type="button"
                className={
                  tunableFilter === false
                    ? 'rules-filter-chip rules-filter-chip--active'
                    : 'rules-filter-chip'
                }
                onClick={() => setTunableFilter(tunableFilter === false ? null : false)}
              >
                Fixed only
              </button>
            </div>
          </div>

          {filteredRules.length === 0 ? (
            <div className="rules-empty-state">
              <p>No rules {describeActiveFilters(activeFilters)}.</p>
              {hasActiveFilters ? (
                <button type="button" className="secondary-button" onClick={clearAllFilters}>
                  Clear all filters
                </button>
              ) : null}
            </div>
          ) : (
            <div className="rule-grid" role="table" aria-label="Matching rules">
              <div className="rule-grid__row rule-grid__row--header" role="row">
                <span role="columnheader">Rule</span>
                <span role="columnheader">Family</span>
                <span role="columnheader">Tunable</span>
                <span role="columnheader">Assigned to</span>
                <span role="columnheader">Last change</span>
              </div>

              {filteredRules.map((rule) => (
                <div className="rule-card rule-grid__row" role="row" key={rule.id}>
                  <div className="rule-grid__cell rule-grid__cell--rule" role="cell">
                    <span className="rule-grid__rule-name">{rule.name}</span>
                    <span className="rule-grid__rule-description">{rule.description}</span>
                  </div>

                  <span className="rule-grid__cell" role="cell">
                    {rule.family}
                  </span>

                  <div className="rule-grid__cell" role="cell">
                    {rule.tunable ? (
                      <button
                        type="button"
                        className={
                          rule.risk === 'elevated'
                            ? 'rule-grid__tunable rule-grid__tunable--elevated'
                            : 'rule-grid__tunable rule-grid__tunable--tunable'
                        }
                        onClick={() => scrollToRuleMetrics(rule)}
                      >
                        {rule.varianceMetricIds.length} metric
                        {rule.varianceMetricIds.length === 1 ? '' : 's'}
                        {rule.risk === 'elevated' ? ' · elevated risk' : ''}
                      </button>
                    ) : (
                      <span className="rule-grid__tunable rule-grid__tunable--fixed">
                        No adjustable metric
                      </span>
                    )}
                  </div>

                  <div className="rule-grid__cell rule-grid__profiles" role="cell">
                    {mappingProfiles.length === 0 ? (
                      <span className="rule-grid__profiles-empty">No profiles yet</span>
                    ) : (
                      mappingProfiles.map((name) => (
                        <span key={name} className="rule-grid__profile-chip">
                          {name}
                        </span>
                      ))
                    )}
                  </div>

                  <span className="rule-grid__cell rule-grid__cell--muted" role="cell">
                    {ruleLastChange(rule)}
                  </span>
                </div>
              ))}

              <div className="rule-grid__footer">
                Showing {filteredRules.length} of {rules.length} · {totalTunableCount} tunable ·{' '}
                {totalFixedCount} fixed
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </section>
  );
}

/** Panel that shows the step-by-step progress stepper while a reconciliation run is in flight. */
export function ProcessProgressSection({
  progressSteps,
}: Readonly<{
  progressSteps: ProgressStep[];
}>) {
  return (
    <SectionCard
      title="Process Progress"
      description="Track overall reconciliation progress and each individual step until completion."
    >
      <div className="process-progress-grid">
        {/* R2 V3.2 (D6): the "Overall Process Meter" card and its percentage lived here --
            deleted, not just its number, per the acceptance criterion "no percentage anywhere,
            collapsed or expanded." Fixing only RunBar's own copy would have left this one exactly
            one click away. The run-bar summary (RunBar.tsx) now carries the phase word, elapsed
            time, and the step-n-of-4 counter that replaces it. */}
        {/* R2 V2.5: no per-step <progress> meter -- a step has no partial completion the backend
            can report, so a meter value here implied a precision that never existed. The chip
            (via `resolveStepState`) carries the state on its own now. */}
        <ul className="step-progress-list" aria-label="Reconciliation step progress">
          {progressSteps.map((step) => {
            const stepState = resolveStepState(step.status);

            return (
              <li className="step-progress-item" key={step.id}>
                <div className="step-progress-head">
                  <h3>{step.label}</h3>
                  <span className={`step-progress-state ${stepState.className}`}>
                    {stepState.label}
                  </span>
                </div>
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
