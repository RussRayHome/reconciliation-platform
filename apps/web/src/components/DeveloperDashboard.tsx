import { useCallback, useEffect, useState } from 'react';

import { BentoModule } from './BentoModule';

type RuntimeState = 'ready' | 'attention' | 'pending';

type DeveloperStatusResponse = {
  generatedAt: string;
  overallStatus: 'healthy' | 'attention-needed';
  failedChecks: number;
  passedChecks: number;
  totalChecks: number;
  totalDurationMs: number;
  checks: Array<{
    name: string;
    ok: boolean;
    durationMs: number;
    summary: string;
    areaLabel?: string;
  }>;
  cache: {
    ttlMs: number;
    ageMs: number;
    fromCache: boolean;
    stale?: boolean;
    refreshInProgress?: boolean;
  };
};

type DeveloperRuntimeResponse = {
  apiStatus: 'reachable';
  startedAt: string;
  uptimeMs: number;
  lastRequestAt: string | null;
  failedRequestsLastWindow: number;
  exceptionsLastWindow: number;
  gitContext: { branch: string | null; commit: string | null; isDirty: boolean | null };
  promotionReadiness: {
    overall: RuntimeState;
    summary: string;
    checkedAt: string;
    sync: {
      remote: string;
      trackingBranch: string | null;
      aheadCount: number | null;
      behindCount: number | null;
      inSync: boolean | null;
    };
    baseline: { tagName: string; exists: boolean; matchesHead: boolean | null };
    environments: Array<{
      name: string;
      runtime: string;
      sourceBranch: string | null;
      targetRevision: string | null;
      status: RuntimeState;
      note: string;
    }>;
  };
  recentFailedRequests: Array<{
    timestamp: string;
    method: string;
    path: string;
    statusCode: number;
  }>;
  recentExceptions: Array<{ timestamp: string; errorName: string; message: string; path: string }>;
  recentReconciliationRuns: Array<{
    timestamp: string;
    status: 'Succeeded' | 'Failed';
    periodLabel?: string;
    durationMs: number;
    exceptionCount?: number;
    failureReason?: string;
  }>;
};

type RuntimeEvent = {
  key: string;
  timestamp: string;
  tone: 'run' | 'failed-request' | 'exception' | 'lifecycle';
  label: string;
  detail: string;
};

const parseJsonResponse = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
};

const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) {
    return '—';
  }

  const totalSeconds = Math.round(ms / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

const formatClock = (iso: string | null): string => {
  if (!iso) {
    return '—';
  }

  const value = new Date(iso);
  return Number.isFinite(value.valueOf())
    ? value.toLocaleTimeString('en-US', { hour12: false })
    : '—';
};

const shortRevision = (revision: string | null): string => (revision ? revision.slice(0, 10) : '—');

const runtimeStateLabel: Record<RuntimeState, string> = {
  ready: 'Ready',
  attention: 'Attention',
  pending: 'Pending',
};

const buildRuntimeEvents = (runtime: DeveloperRuntimeResponse): RuntimeEvent[] => {
  const events: RuntimeEvent[] = [];

  for (const run of runtime.recentReconciliationRuns) {
    events.push({
      key: `run-${run.timestamp}-${run.periodLabel ?? ''}`,
      timestamp: run.timestamp,
      tone: 'run',
      label: `Reconciliation run ${run.status.toLowerCase()}`,
      detail: [
        run.periodLabel,
        formatDuration(run.durationMs),
        run.exceptionCount !== undefined ? `${run.exceptionCount} exceptions` : null,
        run.failureReason ?? null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }

  for (const request of runtime.recentFailedRequests) {
    events.push({
      key: `request-${request.timestamp}-${request.path}`,
      timestamp: request.timestamp,
      tone: 'failed-request',
      label: `Failed request ${request.statusCode}`,
      detail: `${request.method} ${request.path}`,
    });
  }

  for (const exception of runtime.recentExceptions) {
    events.push({
      key: `exception-${exception.timestamp}-${exception.errorName}`,
      timestamp: exception.timestamp,
      tone: 'exception',
      label: exception.errorName,
      detail: `${exception.message} (${exception.path})`,
    });
  }

  events.push({
    key: `lifecycle-${runtime.startedAt}`,
    timestamp: runtime.startedAt,
    tone: 'lifecycle',
    label: 'API server started',
    detail: `Uptime ${formatDuration(runtime.uptimeMs)}`,
  });

  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.timestamp).valueOf() - new Date(a.timestamp).valueOf(),
  );

  return sortedEvents.slice(0, 12);
};

const collectFailingAreas = (status: DeveloperStatusResponse): string[] => {
  const areas = status.checks
    .filter((check) => !check.ok)
    .map((check) => check.areaLabel ?? check.name);

  return [...new Set(areas)];
};

const buildPromotionBlockers = (runtime: DeveloperRuntimeResponse): string[] => {
  const blockers: string[] = [];
  const { sync, baseline } = runtime.promotionReadiness;

  if (sync.inSync === false) {
    const drift = [
      sync.aheadCount !== null ? `${sync.aheadCount} ahead` : null,
      sync.behindCount !== null ? `${sync.behindCount} behind` : null,
    ]
      .filter(Boolean)
      .join(' / ');
    const driftSuffix = drift ? ` (${drift})` : '';
    blockers.push(
      `Local ${sync.trackingBranch ?? 'dev'} is out of sync with ${sync.remote}${driftSuffix}.`,
    );
  }

  if (baseline.matchesHead === false) {
    blockers.push(`HEAD does not match baseline tag ${baseline.tagName}.`);
  }

  if (runtime.gitContext.isDirty === true) {
    blockers.push('Working tree has uncommitted changes.');
  }

  return blockers;
};

const resolveCacheLabel = (cache: DeveloperStatusResponse['cache']): string => {
  if (!cache.fromCache) {
    return 'Fresh';
  }

  return cache.stale ? 'Stale' : 'Cached';
};

function RepositoryHealthModule({
  status,
  statusError,
}: Readonly<{ status: DeveloperStatusResponse | null; statusError: string | null }>) {
  if (!status) {
    return statusError ? (
      <p className="developer-dashboard__error">{statusError}</p>
    ) : (
      <p className="developer-dashboard__loading">Loading repository checks…</p>
    );
  }

  const failingAreas = collectFailingAreas(status);

  return (
    <>
      {statusError ? <p className="developer-dashboard__error">{statusError}</p> : null}
      <div className="kpi-wells kpi-wells--six">
        <div
          className="kpi-well"
          data-tone={status.overallStatus === 'healthy' ? 'positive' : 'critical'}
        >
          <span>Overall</span>
          <strong>{status.overallStatus === 'healthy' ? 'Healthy' : 'Attention'}</strong>
        </div>
        <div className="kpi-well" data-tone={status.failedChecks > 0 ? 'critical' : 'positive'}>
          <span>Failed checks</span>
          <strong>{status.failedChecks}</strong>
        </div>
        <div className="kpi-well" data-tone="neutral">
          <span>Passed checks</span>
          <strong>
            {status.passedChecks}/{status.totalChecks}
          </strong>
        </div>
        <div className="kpi-well" data-tone="neutral">
          <span>Check runtime</span>
          <strong>{formatDuration(status.totalDurationMs)}</strong>
        </div>
        <div className="kpi-well" data-tone={status.cache.stale ? 'warning' : 'neutral'}>
          <span>Cache</span>
          <strong>{resolveCacheLabel(status.cache)}</strong>
          <span className="kpi-well__detail">age {formatDuration(status.cache.ageMs)}</span>
        </div>
        <div className="kpi-well" data-tone={failingAreas.length > 0 ? 'warning' : 'positive'}>
          <span>Failing areas</span>
          <strong>{failingAreas.length}</strong>
          {failingAreas.length > 0 ? (
            <span className="kpi-well__detail">{failingAreas.join(', ')}</span>
          ) : null}
        </div>
      </div>
    </>
  );
}

function EnvironmentPromotionModule({
  runtime,
  runtimeError,
}: Readonly<{ runtime: DeveloperRuntimeResponse | null; runtimeError: string | null }>) {
  if (!runtime) {
    return runtimeError ? (
      <p className="developer-dashboard__error">{runtimeError}</p>
    ) : (
      <p className="developer-dashboard__loading">Loading promotion readiness…</p>
    );
  }

  const promotionBlockers = buildPromotionBlockers(runtime);
  const promotionReady = runtime.promotionReadiness.overall === 'ready';

  return (
    <>
      {runtimeError ? <p className="developer-dashboard__error">{runtimeError}</p> : null}
      <table className="env-matrix">
        <thead>
          <tr>
            <th scope="col">Environment</th>
            <th scope="col">Runtime</th>
            <th scope="col">Source</th>
            <th scope="col">Revision</th>
            <th scope="col">Status</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {runtime.promotionReadiness.environments.map((environment) => (
            <tr key={environment.name}>
              <th scope="row">{environment.name}</th>
              <td>{environment.runtime}</td>
              <td className="env-matrix__mono">{environment.sourceBranch ?? '—'}</td>
              <td className="env-matrix__mono">{shortRevision(environment.targetRevision)}</td>
              <td>
                <span className="env-matrix__pill" data-state={environment.status}>
                  {runtimeStateLabel[environment.status]}
                </span>
              </td>
              <td className="env-matrix__note">{environment.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div
        className="promotion-callout"
        data-tone={promotionReady ? 'ready' : 'blocked'}
        role="note"
      >
        <strong>{runtime.promotionReadiness.summary}</strong>
        {promotionBlockers.length > 0 ? (
          <ul>
            {promotionBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}

function RuntimeHealthModule({ runtime }: Readonly<{ runtime: DeveloperRuntimeResponse | null }>) {
  if (!runtime) {
    return <p className="developer-dashboard__loading">Loading runtime summary…</p>;
  }

  return (
    <dl className="runtime-meta">
      <div>
        <dt>API status</dt>
        <dd>
          <span className="runtime-chip">Reachable</span>
        </dd>
      </div>
      <div>
        <dt>Uptime</dt>
        <dd className="runtime-meta__mono">{formatDuration(runtime.uptimeMs)}</dd>
      </div>
      <div>
        <dt>Last request</dt>
        <dd className="runtime-meta__mono">{formatClock(runtime.lastRequestAt)}</dd>
      </div>
      <div>
        <dt>Branch</dt>
        <dd className="runtime-meta__mono">
          {runtime.gitContext.branch ?? '—'}
          {runtime.gitContext.isDirty === true ? ' (dirty)' : ''}
        </dd>
      </div>
      <div>
        <dt>Commit</dt>
        <dd className="runtime-meta__mono">{shortRevision(runtime.gitContext.commit)}</dd>
      </div>
      <div>
        <dt>Failures (10m)</dt>
        <dd className="runtime-meta__mono">
          {runtime.failedRequestsLastWindow} requests · {runtime.exceptionsLastWindow} exceptions
        </dd>
      </div>
    </dl>
  );
}

function RuntimeEventsModule({ runtime }: Readonly<{ runtime: DeveloperRuntimeResponse | null }>) {
  if (!runtime) {
    return <p className="developer-dashboard__loading">Loading runtime events…</p>;
  }

  const runtimeEvents = buildRuntimeEvents(runtime);

  if (runtimeEvents.length === 0) {
    return <p className="developer-dashboard__loading">No runtime events recorded yet.</p>;
  }

  return (
    <ul className="runtime-events">
      {runtimeEvents.map((event) => (
        <li key={event.key} className="runtime-event" data-tone={event.tone}>
          <span className="runtime-event__time">{formatClock(event.timestamp)}</span>
          <span className="runtime-event__label">{event.label}</span>
          <span className="runtime-event__detail">{event.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * In-shell developer dashboard: repo-health KPI strip, environment promotion
 * matrix with readiness callout, and runtime health event feed. Ports the
 * legacy static dashboard's fetch flow onto React state.
 */
export function DeveloperDashboard() {
  const [status, setStatus] = useState<DeveloperStatusResponse | null>(null);
  const [runtime, setRuntime] = useState<DeveloperRuntimeResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'refresh' | 'force' | null>(null);

  const loadDashboard = useCallback(async (forceRefresh: boolean): Promise<void> => {
    setBusyAction(forceRefresh ? 'force' : 'refresh');

    const statusRequest = fetch(
      forceRefresh ? '/api/developer/status?force=true' : '/api/developer/status',
    )
      .then((response) => parseJsonResponse<DeveloperStatusResponse>(response))
      .then((payload) => {
        setStatus(payload);
        setStatusError(null);
      })
      .catch((error: unknown) => {
        setStatusError(error instanceof Error ? error.message : 'Unable to load repo status.');
      });

    const runtimeRequest = fetch('/api/developer/runtime')
      .then((response) => parseJsonResponse<DeveloperRuntimeResponse>(response))
      .then((payload) => {
        setRuntime(payload);
        setRuntimeError(null);
      })
      .catch((error: unknown) => {
        setRuntimeError(
          error instanceof Error ? error.message : 'Unable to load runtime overview.',
        );
      });

    await Promise.all([statusRequest, runtimeRequest]);
    setBusyAction(null);
  }, []);

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  return (
    <section
      className="developer-dashboard"
      id="tab-panel-developer"
      aria-label="Developer dashboard"
    >
      <header className="developer-dashboard__header">
        <div>
          <h2>Developer Dashboard</h2>
          <p className="developer-dashboard__subtitle">
            Repository health, promotion readiness, and API runtime diagnostics.
            {status ? ` Generated ${formatClock(status.generatedAt)}.` : ''}
          </p>
        </div>
        <div className="developer-dashboard__actions">
          <button
            type="button"
            className="accent-button"
            onClick={() => void loadDashboard(false)}
            disabled={busyAction !== null}
          >
            {busyAction === 'refresh' ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadDashboard(true)}
            disabled={busyAction !== null}
          >
            {busyAction === 'force' ? 'Re-running checks…' : 'Force refresh'}
          </button>
        </div>
      </header>

      <div className="bento-grid">
        <BentoModule title="Repository health" span={12} ariaLabel="Repository health">
          <RepositoryHealthModule status={status} statusError={statusError} />
        </BentoModule>

        <BentoModule title="Environment promotion" span={8} ariaLabel="Environment promotion">
          <EnvironmentPromotionModule runtime={runtime} runtimeError={runtimeError} />
        </BentoModule>

        <BentoModule title="Runtime health" span={4} ariaLabel="Runtime health">
          <RuntimeHealthModule runtime={runtime} />
        </BentoModule>

        <BentoModule title="Recent events" span={12} ariaLabel="Recent runtime events">
          <RuntimeEventsModule runtime={runtime} />
        </BentoModule>
      </div>
    </section>
  );
}
