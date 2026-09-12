import { Link } from 'react-router';

import { StatCard } from '@recon/ui';

import type { ReconciliationRunResponse } from '../lib/api';
import { routePaths } from '../routes/routePaths';
import { formatCompactDate } from '../lib/format';

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
  now = new Date(),
}: Readonly<{
  profileLabel: string;
  run: ReconciliationRunResponse | undefined;
  openExceptionCount: number | null;
  decidedExceptionCount: number;
  /** Injected so the greeting is testable without freezing the system clock. */
  now?: Date;
}>) {
  const greeting = greetingFor(now.getHours());
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
    </div>
  );
}
