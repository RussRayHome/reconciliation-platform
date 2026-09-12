import { Link } from 'react-router';

import { StatCard } from '@recon/ui';

import type { ApprovalCountsByGroup } from '@recon/domain';

import type { ReconciliationRunResponse } from '../lib/api';
import { routePaths } from '../routes/routePaths';
import { formatCompactDate } from '../lib/format';
import type { SavedTriageView } from '../lib/exceptionTriage';
import { useSavedViewCounts } from '../hooks/useSavedViewCounts';
import { useRecentRuns } from '../hooks/useRecentRuns';

/** Greeting by local hour -- the design's "Good morning, M." is time-of-day, not a fixed string. */
const greetingFor = (hour: number): string => {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const formatCurrency = (amount: number): string =>
  amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

/**
 * Screen 1c -- Runs home, the landing route (UI-4, #403).
 *
 * **Land on state, not on a blank upload form.** Before this, `/` was the import screen: a returning
 * analyst with fourteen open exceptions was shown an empty file picker and had to navigate to find
 * their own work. The Continue card puts the run's five measures and its next action one click away.
 *
 * The header names the open-decision count rather than greeting blandly, because that number is the
 * reason the user opened the app. An organization with no runs never reaches this screen -- App.tsx
 * forwards it to New run, which is the actionable thing for someone who has not run anything yet.
 */
export function RunsHomeScreen({
  profileLabel,
  run,
  openExceptionCount,
  decidedExceptionCount,
  approvalCounts,
  onApplySavedView,
  now = new Date(),
}: Readonly<{
  profileLabel: string;
  run: ReconciliationRunResponse | undefined;
  openExceptionCount: number | null;
  decidedExceptionCount: number;
  approvalCounts: ApprovalCountsByGroup | null;
  onApplySavedView: (view: SavedTriageView) => void;
  /** Injected so the greeting is testable without freezing the system clock. */
  now?: Date;
}>) {
  const greeting = greetingFor(now.getHours());
  // "Needs you" is not a count of everything pending -- it is the subset that is waiting on THIS
  // user to act. A rejected profile is back in the submitter's court; a pending resolution or rule
  // is waiting on an approver. Each row states who it waits on, because "3 pending" without that
  // is the kind of number people learn to ignore.
  const needsYou = approvalCounts
    ? [
        {
          key: 'mappingProfile',
          count: approvalCounts.mappingProfile.rejected,
          label: 'mapping profile rejected',
          detail: 'Returned to you — reopen it as a draft',
          to: routePaths.mappingProfiles,
        },
        {
          key: 'exceptionResolution',
          count: approvalCounts.exceptionResolution.pending,
          label: 'resolutions awaiting an approver',
          detail: 'Submitted and not yet decided',
          to: routePaths.approvals,
        },
        {
          key: 'matchingRule',
          count: approvalCounts.matchingRule.pending,
          label: 'rule versions awaiting activation',
          detail: 'A draft is submitted but not active',
          to: routePaths.mappingRules,
        },
      ].filter((row) => row.count > 0)
    : [];

  // The rail's hook, not a second implementation: a count here that disagreed with the list it
  // opens would be worse than no count. Lifted to hooks/ by this phase for exactly that reason.
  const savedViewCounts = useSavedViewCounts(run?.exceptions ?? []);
  const recentRuns = useRecentRuns();
  const RECENT_RUN_LIMIT = 5;
  const firstName = profileLabel.split(' ')[0] ?? profileLabel;
  const summary = run?.summary;

  const headline =
    openExceptionCount !== null && openExceptionCount > 0
      ? `${greeting}, ${firstName} — ${openExceptionCount} exception${
          openExceptionCount === 1 ? '' : 's'
        } still need${openExceptionCount === 1 ? 's' : ''} a decision`
      : `${greeting}, ${firstName} — nothing is waiting on you`;

  return (
    <div className="runs-home">
      <header className="runs-home__header">
        <div>
          <p className="runs-home__eyebrow">Runs</p>
          <h1 className="runs-home__title">{headline}</h1>
        </div>
        <Link className="primary-button runs-home__new-run" to={routePaths.importFiles}>
          New run
        </Link>
      </header>

      {run && summary ? (
        <section className="runs-home__continue" aria-label="Continue where you left off">
          <div className="runs-home__continue-body">
            <p className="runs-home__run-identity">
              <span className="runs-home__run-period">{run.periodLabel ?? 'Latest run'}</span>
              <span className="runs-home__run-meta">
                {run.completedAt ? `Finished ${formatCompactDate(run.completedAt)}` : 'In progress'}
              </span>
            </p>

            <div className="runs-home__wells">
              <StatCard
                label="Reviewed"
                value={summary.totalRecordsReviewed.toLocaleString('en-US')}
                hue="bank"
              />
              <StatCard
                label="Exact"
                value={summary.exactMatches.toLocaleString('en-US')}
                helper={
                  summary.totalRecordsReviewed > 0
                    ? `${((summary.exactMatches / summary.totalRecordsReviewed) * 100).toFixed(1)}%`
                    : undefined
                }
                hue="gl"
              />
              <StatCard label="Probable" value={run.probableMatches.length} hue="ap" />
              <StatCard
                label="Exceptions"
                value={run.exceptions.length}
                helper={`${decidedExceptionCount} decided · ${openExceptionCount ?? 0} open`}
                hue="ar"
              />
              <StatCard
                label="Exposure"
                value={formatCurrency(summary.unresolvedExposure)}
                hue="payroll"
              />
            </div>
          </div>

          {/* Three actions, in the order the design ranks them: the one with a number on it is the
              primary, because "resume" is what a returning user came to do. */}
          <div className="runs-home__actions">
            <Link className="primary-button" to={routePaths.exceptions}>
              Resume exceptions{openExceptionCount ? ` · ${openExceptionCount}` : ''}
            </Link>
            <Link className="secondary-button" to={routePaths.probableMatches}>
              Confirm {run.probableMatches.length} probable match
              {run.probableMatches.length === 1 ? '' : 'es'}
            </Link>
            <Link className="ghost-button" to={routePaths.export}>
              Export workbook
            </Link>
          </div>
        </section>
      ) : (
        /* A run exists but its report has not hydrated yet. Deliberately not a spinner standing in
           for the whole screen: the header above is already true and useful, and swapping it out
           for a skeleton would make the page flash on every visit. */
        <p className="runs-home__empty">Loading your most recent run…</p>
      )}

      <div className="runs-home__panels">
        <section className="runs-home__panel" aria-labelledby="runs-home-needs-you">
          <h2 className="runs-home__panel-title" id="runs-home-needs-you">
            Needs you
          </h2>
          {needsYou.length > 0 ? (
            <ul className="runs-home__needs-list">
              {needsYou.map((row) => (
                <li key={row.key} className="runs-home__needs-row">
                  <Link className="runs-home__needs-link" to={row.to}>
                    <span className="runs-home__needs-count">{row.count}</span>
                    <span className="runs-home__needs-label">{row.label}</span>
                  </Link>
                  <span className="runs-home__needs-detail">{row.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            /* Absent, not a row of zeros -- the same rule the rail badges follow. "Nothing is
               waiting on you" is a real answer; three zeros is noise that teaches the user to
               stop reading the panel. */
            <p className="runs-home__panel-empty">Nothing is waiting on your decision.</p>
          )}
        </section>

        <section className="runs-home__panel" aria-labelledby="runs-home-saved-views">
          <h2 className="runs-home__panel-title" id="runs-home-saved-views">
            Saved views
          </h2>
          {savedViewCounts.length > 0 ? (
            <ul className="runs-home__views-list">
              {savedViewCounts.map(({ view, count }) => (
                <li key={view.id}>
                  <button
                    type="button"
                    className="runs-home__view-button"
                    onClick={() => onApplySavedView(view)}
                  >
                    <span className="runs-home__view-name">{view.name}</span>
                    <span className="runs-home__view-count">{count}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="runs-home__panel-empty">
              Save a filter on the Exceptions screen and it appears here.
            </p>
          )}
        </section>
      </div>

      <section className="runs-home__recent" aria-labelledby="runs-home-recent">
        <header className="runs-home__recent-header">
          <h2 className="runs-home__panel-title" id="runs-home-recent">
            Recent runs
          </h2>
          <span className="runs-home__recent-meta">
            Last {RECENT_RUN_LIMIT} periods
            {recentRuns.runs.length > RECENT_RUN_LIMIT
              ? ` · ${recentRuns.runs.length} runs in all`
              : ''}
          </span>
        </header>

        {recentRuns.error ? (
          <p className="runs-home__panel-empty">{recentRuns.error}</p>
        ) : recentRuns.isLoading ? (
          <p className="runs-home__panel-empty">Loading recent runs…</p>
        ) : recentRuns.runs.length === 0 ? (
          <p className="runs-home__panel-empty">No runs yet.</p>
        ) : (
          <table className="runs-home__recent-table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Status</th>
                <th scope="col" className="runs-home__num">
                  Reviewed
                </th>
                <th scope="col" className="runs-home__num">
                  Open
                </th>
                <th scope="col" className="runs-home__num">
                  Exposure
                </th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.runs.slice(0, RECENT_RUN_LIMIT).map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="runs-home__recent-period">{item.label}</span>
                    {item.accountIdentifier ? (
                      <span className="runs-home__recent-account">{item.accountIdentifier}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className="badge">{item.status}</span>
                  </td>
                  {/* An em dash, not a zero. A run that never reached matching has no summary, and
                      printing 0 would claim it reviewed nothing rather than that we cannot say. */}
                  <td className="runs-home__num">
                    {item.totalRecordsReviewed === null
                      ? '—'
                      : item.totalRecordsReviewed.toLocaleString('en-US')}
                  </td>
                  <td
                    className={
                      item.openExceptionCount !== null && item.openExceptionCount > 0
                        ? 'runs-home__num runs-home__num--attention'
                        : 'runs-home__num'
                    }
                  >
                    {item.openExceptionCount === null ? '—' : item.openExceptionCount}
                  </td>
                  <td className="runs-home__num">
                    {item.unresolvedExposure === null
                      ? '—'
                      : formatCurrency(item.unresolvedExposure)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
