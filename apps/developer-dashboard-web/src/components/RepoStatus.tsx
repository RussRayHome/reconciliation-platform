import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { dashboardApiFetch } from '../lib/api';

/*
 * Repository status screen (/repo) -- per the 2026-08-05 design handoff. Replaces the old
 * RepoHealthBand + "Branches ahead of dev" table on the checks dashboard, which computed its own
 * "Overall" verdict independently of the header pill (two contradicting answers to the same
 * question) and rendered raw signed integers ("-15") with no subject. Everything here is derived
 * server-side (scripts/ci/aggregate-dashboard-status.ts's collectRepoStatus) and rendered as-is --
 * this component does not recompute verdict, branch state, or next actions.
 */

type Tone = 'pass' | 'warn' | 'fail' | 'info' | 'neutral';

type RepoStatusEnvironment = {
  name: 'dev' | 'stage' | 'prod';
  branch: string;
  isCurrent: boolean;
  sha: string | null;
  deployedAt: string | null;
  behindCount: number | null;
  driftLabel: string;
  driftNote: string;
  ci: { status: 'pass' | 'fail' | 'not-run'; durationMs: number | null } | null;
};

type RepoStatusBranch = {
  name: string;
  subject: string;
  author: string;
  isBot: boolean;
  aheadOfDev: number;
  behindDev: number;
  checksStatus: 'passing' | 'failing' | 'not-run';
  failingChecks: string[];
  state: 'review' | 'ready' | 'blocked' | 'stale';
  lastCommitAt: string | null;
  nextAction: string;
  actionDetail: string;
  pullRequest: { number: number; title: string; url: string } | null;
};

type RepoStatusCommit = { sha: string; author: string; committedAt: string; subject: string };

type RepoStatusDecision = { kind: string; tone: 'amber' | 'crimson' | 'blue'; title: string; detail: string };

type RepoStatusPayload = {
  verdict: 'healthy' | 'attention' | 'blocked';
  repo: { slug: string; defaultBranch: string; refreshedAt: string };
  environments: RepoStatusEnvironment[];
  branches: RepoStatusBranch[];
  commits: RepoStatusCommit[];
  commitActivity: Array<{ date: string; count: number }>;
  decisions: RepoStatusDecision[];
};

type StatusResponse = { repoStatus: RepoStatusPayload };

const parseJsonResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}.`);
  }
  return (await response.json()) as T;
};

const formatDuration = (ms: number | null): string => {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

/** Absolute timestamps only, same-day gets "today" -- per the design doc, no relative time on the
 *  promotion track (a bare "3 days ago" hides whether that's fine or alarming; the drift figure
 *  next to it already carries that judgment). */
const formatAbsolute = (iso: string | null): string => {
  if (!iso) return '—';
  const value = new Date(iso);
  if (!Number.isFinite(value.valueOf())) return '—';
  const isToday = value.toDateString() === new Date().toDateString();
  const time = value.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (isToday) return `${time} today`;
  const date = value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
};

const formatClock = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const value = new Date(iso);
  return Number.isFinite(value.valueOf()) ? value.toLocaleString('en-US', { hour12: false }) : '—';
};

const formatAge = (iso: string | null): string => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).valueOf();
  const hours = ms / 3_600_000;
  if (hours < 24) {
    const rounded = Math.max(1, Math.round(hours));
    return `${rounded} hour${rounded === 1 ? '' : 's'}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
};

const STALE_AGE_DAYS = 14;
const isStaleAge = (iso: string | null): boolean =>
  iso !== null && (Date.now() - new Date(iso).valueOf()) / 86_400_000 >= STALE_AGE_DAYS;

const behindTone = (behind: number): Tone => (behind === 0 ? 'neutral' : behind <= 5 ? 'warn' : 'fail');

function Dot({ tone }: Readonly<{ tone: Tone }>) {
  return <span className={`repo-status__dot repo-status__dot--${tone}`} />;
}

const VERDICT_META: Record<RepoStatusPayload['verdict'], { label: string; tone: Tone }> = {
  healthy: { label: 'Healthy', tone: 'pass' },
  attention: { label: 'Attention', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'fail' },
};

const ENV_ORDER: RepoStatusEnvironment['name'][] = ['dev', 'stage', 'prod'];

function EnvironmentCard({ env }: Readonly<{ env: RepoStatusEnvironment }>) {
  const failing = env.ci?.status === 'fail';
  const inSync = env.isCurrent || env.behindCount === 0;
  const tone: Tone = failing ? 'fail' : inSync ? 'pass' : 'warn';
  const stateLabel = failing ? 'Failing' : env.isCurrent ? 'Current' : inSync ? 'Up to date' : 'Behind';

  return (
    <div className={`repo-status__env${env.isCurrent ? ' repo-status__env--current' : ''}`}>
      <div className="repo-status__env-row">
        <span className="repo-status__env-name mono">{env.name}</span>
        <span className={`repo-status__state repo-status__state--${tone}`}>
          <Dot tone={tone} />
          {stateLabel}
        </span>
      </div>
      <div>
        <span className={`repo-status__drift repo-status__drift--${tone}`}>{env.driftLabel}</span>
        <span className="repo-status__drift-note">{env.driftNote}</span>
      </div>
      <div className="repo-status__rule" />
      <div className="repo-status__pairs">
        <div>
          <span>Commit</span>
          <span className="mono">{env.sha ?? '—'}</span>
        </div>
        <div>
          <span>Deployed</span>
          <span>{formatAbsolute(env.deployedAt)}</span>
        </div>
        <div>
          <span>CI</span>
          <span>
            {env.ci
              ? `${env.ci.status === 'pass' ? 'Pass' : 'Fail'} · ${formatDuration(env.ci.durationMs)}`
              : 'Not run'}
          </span>
        </div>
      </div>
    </div>
  );
}

type FilterId = 'all' | RepoStatusBranch['state'];
const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'review', label: 'In review' },
  { id: 'ready', label: 'Ready' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'stale', label: 'Stale' },
];

const STATE_DOT_TONE: Record<RepoStatusBranch['state'], Tone> = {
  review: 'info',
  ready: 'pass',
  blocked: 'fail',
  stale: 'warn',
};

const CHECKS_META: Record<RepoStatusBranch['checksStatus'], { label: string; tone: Tone }> = {
  passing: { label: 'Passing', tone: 'pass' },
  failing: { label: 'failing', tone: 'fail' },
  'not-run': { label: 'Not run', tone: 'neutral' },
};

function BranchRow({ branch }: Readonly<{ branch: RepoStatusBranch }>) {
  const dotTone = branch.isBot ? 'info' : STATE_DOT_TONE[branch.state];
  const checksMeta = CHECKS_META[branch.checksStatus];
  const checksLabel = branch.checksStatus === 'failing' ? `${branch.failingChecks.length} failing` : checksMeta.label;
  const stale = isStaleAge(branch.lastCommitAt);

  return (
    <tr>
      <td>
        <div className="repo-status__branch-cell">
          <div className="repo-status__branch-row">
            <Dot tone={dotTone} />
            <span className="repo-status__branch-name" title={branch.name}>
              {branch.name}
            </span>
          </div>
          <span className="repo-status__branch-subject" title={branch.subject}>
            {branch.subject}
          </span>
        </div>
      </td>
      <td>{branch.author}</td>
      <td className="num">
        <div className="repo-status__divergence">
          <span className="repo-status__dot--pass">↑{branch.aheadOfDev}</span>
          <span className={`repo-status__dot--${behindTone(branch.behindDev)}`}>↓{branch.behindDev}</span>
        </div>
      </td>
      <td>
        <span className={`repo-status__checks repo-status__state--${checksMeta.tone}`}>
          <Dot tone={checksMeta.tone} />
          {checksLabel}
        </span>
      </td>
      <td className={stale ? 'repo-status__state--warn' : undefined}>{formatAge(branch.lastCommitAt)}</td>
      <td>
        <div className="repo-status__action">
          <span className={`repo-status__state--${STATE_DOT_TONE[branch.state]}`}>{branch.nextAction}</span>
          <span className="repo-status__action-sub">{branch.actionDetail}</span>
        </div>
      </td>
    </tr>
  );
}

const formatBarDayLabel = (dateStr: string, index: number): string => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  if (index === 0 || day === 1) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  return String(day);
};

function CommitActivityBars({ activity }: Readonly<{ activity: RepoStatusPayload['commitActivity'] }>) {
  const max = Math.max(1, ...activity.map((d) => d.count));

  return (
    <div className="repo-status__bars">
      {activity.map((day, index) => {
        const height = day.count === 0 ? 3 : Math.max(3, Math.round((day.count / max) * 52));
        const fill =
          day.count === 0
            ? 'var(--line-strong)'
            : day.count > max * 0.7
              ? 'var(--accent)'
              : 'color-mix(in srgb, var(--accent) 45%, transparent)';
        const label = new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        });

        return (
          <div key={day.date} className="repo-status__bar" title={`${label}: ${day.count} commits`}>
            <div className="repo-status__bar-fill" style={{ height: `${height}px`, background: fill }} />
            <span className="repo-status__bar-day">{formatBarDayLabel(day.date, index)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function RepoStatus() {
  const [status, setStatus] = useState<RepoStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const activeFilter: FilterId = (searchParams.get('state') as FilterId | null) ?? 'all';

  const load = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const response = await dashboardApiFetch('/api/status');
      const payload = await parseJsonResponse<StatusResponse>(response);
      setStatus(payload.repoStatus);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load repository status.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setFilter = (id: FilterId): void => {
    setSearchParams(id === 'all' ? {} : { state: id });
  };

  const filteredBranches = useMemo(() => {
    if (!status) return [];
    return activeFilter === 'all' ? status.branches : status.branches.filter((b) => b.state === activeFilter);
  }, [status, activeFilter]);

  const filterCounts = useMemo(() => {
    const counts: Record<FilterId, number> = { all: 0, review: 0, ready: 0, blocked: 0, stale: 0 };
    if (!status) return counts;
    counts.all = status.branches.length;
    for (const branch of status.branches) counts[branch.state] += 1;
    return counts;
  }, [status]);

  if (!status) {
    return (
      <div className="repo-status">
        <Link to="/" className="repo-status__back">
          ← Developer dashboard
        </Link>
        {error ? <p className="developer-dashboard__error">{error}</p> : <p>Loading repository status…</p>}
      </div>
    );
  }

  const orderedEnvs = ENV_ORDER.map((name) => status.environments.find((e) => e.name === name)).filter(
    (e): e is RepoStatusEnvironment => Boolean(e),
  );
  const trackHint =
    orderedEnvs
      .filter((e) => !e.isCurrent && (e.behindCount ?? 0) > 0)
      .map((e) => `${e.name} is ${e.behindCount} commits behind dev`)
      .join(' · ') || 'Everything is in sync with dev.';

  const blockedCount = filterCounts.blocked;
  const staleCount = filterCounts.stale;
  const flightHint = `${status.branches.length} open branch${status.branches.length === 1 ? '' : 'es'} · ${blockedCount} blocked · ${staleCount} stale`;

  const verdictMeta = VERDICT_META[status.verdict];
  const totalCommits = status.commitActivity.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="repo-status">
      <Link to="/" className="repo-status__back">
        ← Developer dashboard
      </Link>

      <header className="repo-status__header">
        <div>
          <div className="repo-status__title-row">
            <h1>Repository status</h1>
            <span className={`status-pill status-pill--${verdictMeta.tone}`}>{verdictMeta.label}</span>
          </div>
          <div className="repo-status__meta">
            <span className="mono">{status.repo.slug}</span>
            <span>
              Default branch <span className="mono">{status.repo.defaultBranch}</span>
            </span>
            <span>Refreshed {formatClock(status.repo.refreshedAt)}</span>
          </div>
        </div>
        <div className="repo-status__actions">
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <a
            className="accent-button"
            href={`https://github.com/${status.repo.slug}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in GitHub
          </a>
        </div>
      </header>

      {error ? <p className="developer-dashboard__error">{error}</p> : null}

      <section>
        <div className="repo-status__section-head">
          <h2 className="repo-status__kicker">Promotion track</h2>
          <span className="repo-status__hint">{trackHint}</span>
        </div>
        <div className="repo-status__track">
          {orderedEnvs.map((env) => (
            <EnvironmentCard key={env.name} env={env} />
          ))}
        </div>
      </section>

      <section>
        <div className="repo-status__section-head">
          <div className="repo-status__title-row">
            <h2 className="repo-status__kicker">Changes in flight</h2>
            <span className="repo-status__hint">{flightHint}</span>
          </div>
          <div className="repo-status__chips">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="repo-status__chip"
                aria-pressed={activeFilter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className="repo-status__chip-count mono">{filterCounts[f.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="repo-status__table-wrap">
          {filteredBranches.length === 0 ? (
            <p className="detail-panel__empty">No branches match this filter.</p>
          ) : (
            <table className="repo-status__table">
              <colgroup>
                <col style={{ width: '34%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Author</th>
                  <th className="num">Divergence</th>
                  <th>Checks</th>
                  <th>Age</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {filteredBranches.map((branch) => (
                  <BranchRow key={branch.name} branch={branch} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="repo-status__legend">
          <span>
            <span className="repo-status__dot--pass mono">↑</span>commits ahead of dev
          </span>
          <span>
            <span className="repo-status__dot--fail mono">↓</span>commits behind dev — rebase before merging
          </span>
          <span>
            <Dot tone="info" />
            bot branch
          </span>
        </div>
      </section>

      <section className="repo-status__bottom">
        <div className="repo-status__panel">
          <div className="repo-status__panel-top">
            <h2 className="repo-status__kicker">Commits landed on dev</h2>
            <span className="repo-status__hint">{totalCommits} commits · last 14 days</span>
          </div>
          <CommitActivityBars activity={status.commitActivity} />
          <div style={{ display: 'grid', gap: '0.625rem', paddingTop: '0.25rem' }}>
            {status.commits.length === 0 ? (
              <p className="detail-panel__empty">No commits in this window.</p>
            ) : (
              status.commits.map((commit) => (
                <div className="repo-status__commit" key={commit.sha}>
                  <span className="repo-status__commit-sha mono">{commit.sha}</span>
                  <div className="repo-status__commit-text">
                    <span className="repo-status__commit-subject">{commit.subject}</span>
                    <span className="repo-status__commit-meta">
                      {commit.author} · {formatAbsolute(commit.committedAt)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="repo-status__panel">
          <h2 className="repo-status__kicker">Needs a decision</h2>
          {status.decisions.length === 0 ? (
            <p className="detail-panel__empty">Nothing needs a decision.</p>
          ) : (
            status.decisions.map((decision, index) => (
              <div
                className={`repo-status__decision repo-status__decision--${decision.tone}`}
                key={`${decision.kind}-${index}`}
              >
                <span className="repo-status__decision-kind">{decision.kind}</span>
                <span className="repo-status__decision-title">{decision.title}</span>
                <span className="repo-status__decision-detail">{decision.detail}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
