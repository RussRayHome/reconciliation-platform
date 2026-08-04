import { Fragment, useCallback, useEffect, useState } from 'react';

import { apiFetch } from '../lib/api';
import { SkeletonPanel, KpiWellsSkeleton, SkeletonLines, TableSkeleton } from './Skeleton';

type Verdict = 'pass' | 'fail' | 'warn' | 'neutral';

type TestItem = {
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped';
  reason?: string;
  durationMs?: number;
};

type LintIssue = {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  file: string;
  line: number;
  message: string;
};

type CoverageFileEntry = {
  filePath: string;
  lines: number;
  branches: number;
  functions: number;
  uncoveredLineCount: number;
  meetsMinimum: boolean;
};

type DbTestItem = {
  name: string;
  category: 'migration' | 'constraint' | 'seed' | 'behavior' | 'other';
  status: 'passed' | 'failed';
  durationMs?: number;
  failureMessage?: string;
};

type E2eSpecItem = {
  name: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  durationMs: number;
  retries: number;
  artifactPath?: string;
};

type SecurityCveFinding = {
  id: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'INFO' | 'UNKNOWN';
  component: string;
  scanner: string;
  packageName?: string;
  installedVersion?: string;
  fixedVersion?: string;
  path?: 'direct' | 'transitive' | 'base-image';
  status?: 'open' | 'patch-available' | 'mitigated';
};

type SecurityComponentScore = {
  component: string;
  scanner: string;
  status: 'ok' | 'skipped' | 'error';
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  note?: string;
  cveFindings?: SecurityCveFinding[];
};

type DeveloperCheckResponse = {
  name: string;
  ok: boolean;
  durationMs: number;
  summary: string;
  areaLabel?: string;
  passedCount?: number;
  failedCount?: number;
  totalCount?: number;
  testItems?: TestItem[];
  lintIssues?: LintIssue[];
  coverageFiles?: CoverageFileEntry[];
  coverageBenchmarks?: Array<{
    key: string;
    label: string;
    value: string;
    meetsThreshold: boolean;
  }>;
  dbTestItems?: DbTestItem[];
  e2eSpecs?: E2eSpecItem[];
  /** Set while the check is still executing detached on the server. */
  running?: boolean;
  securityComponentScores?: SecurityComponentScore[];
  securityAggregateScore?: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    info: number;
  };
};

type RepoHealthKpis = {
  overallStatus: 'healthy' | 'attention-needed';
  failedChecks: number;
  lastCiRun: { status: 'healthy' | 'attention-needed'; durationMs: number; at: string };
  commitsThisWeek: number | null;
  branchFreshness: { remoteRef: string; aheadCount: number | null; behindCount: number | null };
  openPrCount: number | null;
  openPrNote?: string;
};

type DeveloperStatusResponse = {
  generatedAt: string;
  overallStatus: 'healthy' | 'attention-needed';
  failedChecks: number;
  passedChecks: number;
  totalChecks: number;
  totalDurationMs: number;
  checks: DeveloperCheckResponse[];
  repoHealth: RepoHealthKpis;
  cache: {
    ttlMs: number;
    ageMs: number;
    fromCache: boolean;
    stale?: boolean;
    refreshInProgress?: boolean;
  };
};

type DeveloperRuntimeResponse = {
  gitContext: { branch: string | null; commit: string | null };
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

const formatClock = (iso: string | null | undefined): string => {
  if (!iso) {
    return '—';
  }

  const value = new Date(iso);
  return Number.isFinite(value.valueOf()) ? value.toLocaleString('en-US', { hour12: false }) : '—';
};

const shortRevision = (revision: string | null | undefined): string =>
  revision ? revision.slice(0, 10) : '—';

const findCheck = (
  checks: DeveloperCheckResponse[],
  name: string,
): DeveloperCheckResponse | undefined => checks.find((check) => check.name === name);

const unitVerdict = (check: DeveloperCheckResponse | undefined): Verdict =>
  !check ? 'neutral' : check.ok ? 'pass' : 'fail';

const staticVerdict = (
  lint: DeveloperCheckResponse | undefined,
  typecheck: DeveloperCheckResponse | undefined,
): Verdict => {
  if (!lint || !typecheck) return 'neutral';
  if (!lint.ok || !typecheck.ok) return 'fail';
  const warningCount = (lint.lintIssues ?? []).filter((issue) => issue.severity !== 'error').length;
  return warningCount > 0 ? 'warn' : 'pass';
};

const coverageVerdict = (check: DeveloperCheckResponse | undefined): Verdict => {
  if (!check) return 'neutral';
  if (!check.ok) return 'fail';
  const belowMinimum = (check.coverageFiles ?? []).filter((file) => !file.meetsMinimum).length;
  return belowMinimum > 0 ? 'fail' : 'pass';
};

const securityVerdict = (check: DeveloperCheckResponse | undefined): Verdict => {
  if (!check) return 'neutral';
  const score = check.securityAggregateScore;
  if (!check.ok || (score && (score.critical > 0 || score.high > 0))) return 'fail';
  if (score && (score.moderate > 0 || score.low > 0)) return 'warn';
  return 'pass';
};

const e2eVerdict = (check: DeveloperCheckResponse | undefined): Verdict => {
  if (!check) return 'neutral';
  // A detached run in progress carries ok: true so it does not count as a failure; without this
  // it would render a green "pass" pill before a single spec has reported.
  if (check.running === true) return 'neutral';
  if (!check.ok) return 'fail';
  const hasFlaky = (check.e2eSpecs ?? []).some((spec) => spec.status === 'flaky');
  return hasFlaky ? 'warn' : 'pass';
};

const dbVerdict = (check: DeveloperCheckResponse | undefined): Verdict =>
  !check ? 'neutral' : check.ok ? 'pass' : 'fail';

const overallVerdict = (verdicts: Verdict[]): 'Healthy' | 'Degraded' | 'Failing' => {
  if (verdicts.includes('fail')) return 'Failing';
  if (verdicts.includes('warn')) return 'Degraded';
  return 'Healthy';
};

function StatusPill({ verdict, label }: Readonly<{ verdict: Verdict; label: string }>) {
  return <span className={`status-pill status-pill--${verdict}`}>{label}</span>;
}

function VerdictBanner({ verdict }: Readonly<{ verdict: 'Healthy' | 'Degraded' | 'Failing' }>) {
  const tone: Verdict = verdict === 'Healthy' ? 'pass' : verdict === 'Degraded' ? 'warn' : 'fail';
  return <StatusPill verdict={tone} label={verdict} />;
}

function RepoHealthBand({ repoHealth }: Readonly<{ repoHealth: RepoHealthKpis }>) {
  const { branchFreshness } = repoHealth;
  const drift =
    branchFreshness.behindCount === null
      ? '—'
      : branchFreshness.behindCount === 0
        ? 'Up to date'
        : `−${branchFreshness.behindCount}`;

  return (
    <div className="kpi-wells kpi-wells--six">
      <div
        className="kpi-well"
        data-tone={repoHealth.overallStatus === 'healthy' ? 'positive' : 'critical'}
      >
        <span>Overall</span>
        <strong>{repoHealth.overallStatus === 'healthy' ? 'Healthy' : 'Attention'}</strong>
      </div>
      <div className="kpi-well" data-tone="neutral">
        <span>Open PRs</span>
        <strong>{repoHealth.openPrCount ?? '—'}</strong>
        {repoHealth.openPrNote ? (
          <span className="kpi-well__detail">{repoHealth.openPrNote}</span>
        ) : null}
      </div>
      <div className="kpi-well" data-tone={branchFreshness.behindCount ? 'warning' : 'neutral'}>
        <span>Branch freshness</span>
        <strong>{drift}</strong>
        <span className="kpi-well__detail">{branchFreshness.remoteRef}</span>
      </div>
      <div
        className="kpi-well"
        data-tone={repoHealth.lastCiRun.status === 'healthy' ? 'positive' : 'critical'}
      >
        <span>Last CI run</span>
        <strong>{repoHealth.lastCiRun.status === 'healthy' ? 'Pass' : 'Fail'}</strong>
        <span className="kpi-well__detail">{formatDuration(repoHealth.lastCiRun.durationMs)}</span>
      </div>
      <div className="kpi-well" data-tone={repoHealth.failedChecks > 0 ? 'critical' : 'positive'}>
        <span>Failed checks</span>
        <strong>{repoHealth.failedChecks}</strong>
      </div>
      <div className="kpi-well" data-tone="neutral">
        <span>Commits</span>
        <strong>{repoHealth.commitsThisWeek ?? '—'}</strong>
        <span className="kpi-well__detail">this week</span>
      </div>
    </div>
  );
}

function OverviewCard({
  href,
  title,
  verdict,
  verdictLabel,
  headline,
  headlineUnit,
  stats,
  hint,
}: Readonly<{
  href: string;
  title: string;
  verdict: Verdict;
  verdictLabel: string;
  headline: string;
  headlineUnit?: string;
  stats: string[];
  hint: string;
}>) {
  const edgeClass =
    verdict === 'fail'
      ? ' overview-card--edge-fail'
      : verdict === 'warn'
        ? ' overview-card--edge-warn'
        : '';

  return (
    <a className={`overview-card${edgeClass}`} href={href}>
      <div className="overview-card__head">
        <h3>{title}</h3>
        <StatusPill verdict={verdict} label={verdictLabel} />
      </div>
      <span className="overview-card__big">
        {headline}
        {headlineUnit ? <small>{headlineUnit}</small> : null}
      </span>
      <div className="overview-card__stats">
        {stats.map((stat) => (
          <span key={stat}>{stat}</span>
        ))}
      </div>
      <span className="overview-card__hint">{hint} →</span>
    </a>
  );
}

function UnitTestsPanel({ check }: Readonly<{ check: DeveloperCheckResponse | undefined }>) {
  const items = (check?.testItems ?? []).filter((item) => item.status !== 'passed');

  return (
    <div className="detail-panel" id="unit-tests">
      <div className="detail-panel__head">
        <h3>Unit tests — failed &amp; skipped</h3>
        <span className="detail-panel__sub">
          {check?.passedCount ?? 0} passed hidden · {formatDuration(check?.durationMs ?? 0)}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="detail-panel__empty">All unit tests passed.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Suite</th>
              <th>Result</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.suite}:${item.name}`}>
                <td className="mono">{item.name}</td>
                <td className="mono">{item.suite}</td>
                <td>
                  <StatusPill
                    verdict={item.status === 'failed' ? 'fail' : 'neutral'}
                    label={item.status === 'failed' ? 'Failed' : 'Skipped'}
                  />
                </td>
                <td>{item.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StaticAnalysisPanel({ lint }: Readonly<{ lint: DeveloperCheckResponse | undefined }>) {
  const issues = lint?.lintIssues ?? [];

  return (
    <div className="detail-panel" id="static">
      <div className="detail-panel__head">
        <h3>Static code analysis — issue listing</h3>
        <span className="detail-panel__sub">{lint?.summary ?? 'ESLint'}</span>
      </div>
      {issues.length === 0 ? (
        <p className="detail-panel__empty">No lint issues.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Severity</th>
              <th>Location</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, index) => (
              <tr key={`${issue.file}:${issue.line}:${issue.rule}:${index}`}>
                <td className="mono">{issue.rule}</td>
                <td>
                  <StatusPill
                    verdict={issue.severity === 'error' ? 'fail' : 'warn'}
                    label={
                      issue.severity === 'error'
                        ? 'Error'
                        : issue.severity === 'warning'
                          ? 'Warning'
                          : 'Info'
                    }
                  />
                </td>
                <td className="mono">
                  {issue.file}:{issue.line}
                </td>
                <td>{issue.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DatabaseTestsPanel({ check }: Readonly<{ check: DeveloperCheckResponse | undefined }>) {
  const items = check?.dbTestItems ?? [];

  return (
    <div className="detail-panel" id="db-tests">
      <div className="detail-panel__head">
        <h3>Database tests — full listing</h3>
        <span className="detail-panel__sub">{check?.summary ?? 'Postgres'}</span>
      </div>
      {items.length === 0 ? (
        <p className="detail-panel__empty">
          No per-test detail available in this runtime — see the check summary above.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Category</th>
              <th>Result</th>
              <th className="num">Duration</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.name}>
                <td className="mono">{item.name}</td>
                <td>{item.category}</td>
                <td>
                  <StatusPill
                    verdict={item.status === 'passed' ? 'pass' : 'fail'}
                    label={item.status === 'passed' ? 'Pass' : 'Fail'}
                  />
                </td>
                <td className="num">{formatDuration(item.durationMs ?? 0)}</td>
                <td className="detail-panel__failure-message">{item.failureMessage ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CoverageMicroBar({ pct, warn }: Readonly<{ pct: number; warn: boolean }>) {
  const toneClass = pct < 75 ? 'bar__fill--bad' : warn ? 'bar__fill--warn' : '';
  return (
    <span className="bar">
      <i className={toneClass} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  );
}

function CoveragePanel({ check }: Readonly<{ check: DeveloperCheckResponse | undefined }>) {
  const [expanded, setExpanded] = useState(false);
  const files = check?.coverageFiles ?? [];
  const belowMinimum = files.filter((file) => !file.meetsMinimum).length;
  // Files are already sorted lowest-first. Always show every failing/borderline row (<80%
  // lines); collapse the comfortably-passing tail behind a real, working expand button.
  const previewCount = Math.max(
    files.filter((file) => file.lines < 80).length,
    Math.min(files.length, 15),
  );
  const visible = expanded ? files : files.slice(0, previewCount);
  const remaining = files.length - visible.length;

  return (
    <div className="detail-panel" id="coverage">
      <div className="detail-panel__head">
        <h3>Coverage by file — entire application</h3>
        <span className="detail-panel__sub">
          All {files.length} files, lowest first ·{' '}
          <strong className={belowMinimum > 0 ? 'detail-panel__warning-text' : undefined}>
            minimum 75% lines per file
            {belowMinimum > 0 ? ` — ${belowMinimum} files below minimum` : ''}
          </strong>
        </span>
      </div>
      {files.length === 0 ? (
        <p className="detail-panel__empty">No coverage report available for this run.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th className="num">Lines</th>
                <th className="num">Branches</th>
                <th className="num">Functions</th>
                <th className="num">Uncovered</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((file) => (
                <tr key={file.filePath}>
                  <td className="mono">{file.filePath}</td>
                  <td className={`num${!file.meetsMinimum ? ' detail-panel__warning-text' : ''}`}>
                    {file.lines.toFixed(1)}%
                  </td>
                  <td className="num">{file.branches.toFixed(1)}%</td>
                  <td className="num">{file.functions.toFixed(1)}%</td>
                  <td className="num">{file.uncoveredLineCount}</td>
                  <td>
                    <CoverageMicroBar pct={file.lines} warn={file.lines < 80} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {remaining > 0 ? (
            <button
              type="button"
              className="detail-panel__expand"
              onClick={() => setExpanded(true)}
            >
              Show remaining {remaining} files
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

const securityComponentOrder = ['API', 'Web Server', 'Container Component', 'Database'];

function SecurityPanel({ check }: Readonly<{ check: DeveloperCheckResponse | undefined }>) {
  const scores = check?.securityComponentScores ?? [];
  const ordered = [...scores].sort(
    (a, b) =>
      securityComponentOrder.indexOf(a.component) - securityComponentOrder.indexOf(b.component),
  );
  const aggregate = check?.securityAggregateScore;

  return (
    <div className="detail-panel" id="security">
      <div className="detail-panel__head">
        <h3>Security — vulnerabilities by major component</h3>
        <span className="detail-panel__sub">
          Trivy + npm audit · {aggregate?.critical ?? 0} critical · {aggregate?.high ?? 0} high ·{' '}
          {aggregate?.moderate ?? 0} moderate and {aggregate?.low ?? 0} low
        </span>
      </div>
      {ordered.length === 0 ? (
        <p className="detail-panel__empty">No security scan data available for this run.</p>
      ) : (
        ordered.map((component) => {
          const findings = (component.cveFindings ?? []).filter(
            (finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH',
          );

          return (
            <div className="vuln-group" key={component.component}>
              <div className="vuln-group__head">
                <h4>{component.component}</h4>
                {component.critical > 0 ? (
                  <StatusPill verdict="fail" label={`${component.critical} critical`} />
                ) : null}
                {component.high > 0 ? (
                  <StatusPill verdict="warn" label={`${component.high} high`} />
                ) : null}
                {component.critical === 0 && component.high === 0 ? (
                  <StatusPill verdict="pass" label="Clear" />
                ) : null}
              </div>
              {findings.length === 0 ? (
                <p className="detail-panel__empty">No critical/high findings.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>CVE</th>
                      <th>Severity</th>
                      <th>Package</th>
                      <th className="num">Installed</th>
                      <th className="num">Fixed in</th>
                      <th>Path</th>
                      <th>Source</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {findings.map((finding) => (
                      <Fragment key={finding.id}>
                        <tr>
                          <td className="mono">
                            <a
                              href={`https://nvd.nist.gov/vuln/detail/${finding.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {finding.id}
                            </a>
                          </td>
                          <td>
                            <StatusPill
                              verdict={finding.severity === 'CRITICAL' ? 'fail' : 'warn'}
                              label={finding.severity === 'CRITICAL' ? 'Critical' : 'High'}
                            />
                          </td>
                          <td className="mono">{finding.packageName ?? '—'}</td>
                          <td className="num mono">{finding.installedVersion ?? '—'}</td>
                          <td className="num mono">{finding.fixedVersion ?? '—'}</td>
                          <td>{finding.path ?? '—'}</td>
                          <td>{finding.scanner}</td>
                          <td>
                            <StatusPill
                              verdict={finding.status === 'open' ? 'neutral' : 'warn'}
                              label={finding.status ?? 'open'}
                            />
                          </td>
                        </tr>
                        <tr className="detail-panel__desc-row">
                          <td colSpan={8}>{finding.description}</td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function E2ePanel({ check }: Readonly<{ check: DeveloperCheckResponse | undefined }>) {
  const specs = [...(check?.e2eSpecs ?? [])].sort((a, b) => {
    const rank = (status: E2eSpecItem['status']): number =>
      status === 'failed' ? 0 : status === 'flaky' ? 1 : status === 'skipped' ? 2 : 3;
    return rank(a.status) - rank(b.status);
  });

  const isRunning = check?.running === true;

  return (
    <div className="detail-panel" id="e2e">
      <div className="detail-panel__head">
        <h3>E2E test results</h3>
        <span className="detail-panel__sub">
          {isRunning
            ? 'Playwright · running in the background'
            : `Playwright · ${specs.length} specs · ${formatDuration(check?.durationMs ?? 0)}`}
        </span>
      </div>
      {isRunning ? (
        <p className="detail-panel__empty" role="status" aria-live="polite">
          E2E tests are running in the background. This section refreshes automatically once they
          finish — no need to force refresh again.
        </p>
      ) : specs.length === 0 ? (
        <p className="detail-panel__empty">No per-spec detail available for this run.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Spec / flow</th>
              <th>Result</th>
              <th className="num">Duration</th>
              <th className="num">Retries</th>
              <th>Artifacts</th>
            </tr>
          </thead>
          <tbody>
            {specs.map((spec) => (
              <tr key={spec.name}>
                <td className="mono">{spec.name}</td>
                <td>
                  <StatusPill
                    verdict={
                      spec.status === 'failed' ? 'fail' : spec.status === 'flaky' ? 'warn' : 'pass'
                    }
                    label={
                      spec.status === 'failed'
                        ? 'Fail'
                        : spec.status === 'flaky'
                          ? 'Flaky'
                          : spec.status === 'skipped'
                            ? 'Skipped'
                            : 'Pass'
                    }
                  />
                </td>
                <td className="num">{formatDuration(spec.durationMs)}</td>
                <td className="num">{spec.retries}</td>
                <td>
                  {spec.artifactPath ? (
                    <span className="detail-panel__artifact">trace available</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Developer Dashboard "Application Health" screen: repo-health KPI band, six
 * drill-down result cards (unit/static/db/coverage/security/e2e), and a full
 * detail panel per card with per-item data pulled straight from the latest
 * quality-gate run.
 */
export function DeveloperDashboard() {
  const [status, setStatus] = useState<DeveloperStatusResponse | null>(null);
  const [runtime, setRuntime] = useState<DeveloperRuntimeResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'refresh' | 'force' | null>(null);

  // `silent` skips the busy indicator so the background poll does not disable the toolbar buttons
  // or flicker their labels every time it ticks.
  const loadDashboard = useCallback(
    async (forceRefresh: boolean, silent = false): Promise<void> => {
      if (!silent) {
        setBusyAction(forceRefresh ? 'force' : 'refresh');
      }

      const statusRequest = apiFetch(
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

      const runtimeRequest = apiFetch('/api/developer/runtime')
        .then((response) => parseJsonResponse<DeveloperRuntimeResponse>(response))
        .then((payload) => setRuntime(payload))
        .catch(() => undefined);

      await Promise.all([statusRequest, runtimeRequest]);
      if (!silent) {
        setBusyAction(null);
      }
    },
    [],
  );

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  const hasRunningCheck = (status?.checks ?? []).some((check) => check.running === true);

  // While a check runs detached on the server (currently only E2E, which takes minutes), poll for
  // the result so the panel fills itself in. A plain non-force reload is enough — the server
  // swaps the finished result into its cache, so no extra work is triggered by polling.
  useEffect(() => {
    if (!hasRunningCheck) {
      return;
    }

    const timer = setInterval(() => {
      void loadDashboard(false, true);
    }, 15000);

    return () => clearInterval(timer);
  }, [hasRunningCheck, loadDashboard]);

  if (!status) {
    return (
      <section
        className="developer-dashboard"
        id="tab-panel-developer"
        aria-label="Developer dashboard"
      >
        <header className="developer-dashboard__header">
          <h2>Developer dashboard</h2>
        </header>
        {statusError ? (
          <p className="developer-dashboard__error">{statusError}</p>
        ) : (
          <SkeletonPanel label="Loading application health">
            <KpiWellsSkeleton count={6} six />
            <TableSkeleton rows={4} columns={4} />
            <SkeletonLines count={4} />
          </SkeletonPanel>
        )}
      </section>
    );
  }

  const unitCheck = findCheck(status.checks, 'Unit tests');
  const lintCheck = findCheck(status.checks, 'Static analysis (lint)');
  const typecheckCheck = findCheck(status.checks, 'Static analysis (typecheck)');
  const dbCheck = findCheck(status.checks, 'Postgres DB tests');
  const coverageCheck = findCheck(status.checks, 'Coverage');
  const securityCheck = findCheck(status.checks, 'Security vulnerabilities');
  const e2eCheck = findCheck(status.checks, 'E2E tests');

  const verdicts = {
    unit: unitVerdict(unitCheck),
    staticAnalysis: staticVerdict(lintCheck, typecheckCheck),
    db: dbVerdict(dbCheck),
    coverage: coverageVerdict(coverageCheck),
    security: securityVerdict(securityCheck),
    e2e: e2eVerdict(e2eCheck),
  };
  const verdict = overallVerdict(Object.values(verdicts));

  const lintErrorCount = (lintCheck?.lintIssues ?? []).filter(
    (issue) => issue.severity === 'error',
  ).length;
  const lintWarningCount = (lintCheck?.lintIssues ?? []).filter(
    (issue) => issue.severity === 'warning',
  ).length;
  const lintInfoCount = (lintCheck?.lintIssues ?? []).filter(
    (issue) => issue.severity === 'info',
  ).length;
  const belowMinimumFiles = (coverageCheck?.coverageFiles ?? []).filter(
    (file) => !file.meetsMinimum,
  ).length;
  const linesBenchmark = coverageCheck?.coverageBenchmarks?.find(
    (benchmark) => benchmark.key === 'L',
  );
  const securityAggregate = securityCheck?.securityAggregateScore;
  const e2eFlakyCount = (e2eCheck?.e2eSpecs ?? []).filter((spec) => spec.status === 'flaky').length;

  return (
    <section
      className="developer-dashboard"
      id="tab-panel-developer"
      aria-label="Developer dashboard"
    >
      <header className="developer-dashboard__header">
        <div className="developer-dashboard__title-row">
          <h2>Developer dashboard</h2>
          <VerdictBanner verdict={verdict} />
          <span className="developer-dashboard__revision mono">
            {runtime?.gitContext.branch ?? '—'} @ {shortRevision(runtime?.gitContext.commit)}
          </span>
          <span className="developer-dashboard__meta">
            Refreshed {formatClock(status.generatedAt)}
          </span>
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

      {statusError ? <p className="developer-dashboard__error">{statusError}</p> : null}

      <RepoHealthBand repoHealth={status.repoHealth} />

      <div className="developer-dashboard__section-head">
        <h2>Testing &amp; verification</h2>
        <span className="developer-dashboard__section-sub">
          All results from the latest check run on{' '}
          <span className="mono">{shortRevision(runtime?.gitContext.commit)}</span>
        </span>
      </div>

      <div className="overview-cards">
        <OverviewCard
          href="#unit-tests"
          title="Unit tests"
          verdict={verdicts.unit}
          verdictLabel={verdicts.unit === 'pass' ? 'Pass' : 'Fail'}
          headline={
            unitCheck?.totalCount
              ? `${(((unitCheck.passedCount ?? 0) / unitCheck.totalCount) * 100).toFixed(1)}`
              : '—'
          }
          headlineUnit="%"
          stats={[
            `${unitCheck?.passedCount ?? 0} passed`,
            `${unitCheck?.failedCount ?? 0} failed`,
            formatDuration(unitCheck?.durationMs ?? 0),
          ]}
          hint="Failed & skipped tests"
        />
        <OverviewCard
          href="#static"
          title="Static code analysis"
          verdict={verdicts.staticAnalysis}
          verdictLabel={
            lintErrorCount + lintWarningCount === 0
              ? 'Clean'
              : `${lintErrorCount + lintWarningCount} issues`
          }
          headline={String(lintErrorCount + lintWarningCount + lintInfoCount)}
          stats={[
            `${lintErrorCount} errors`,
            `${lintWarningCount} warnings`,
            `${lintInfoCount} info`,
          ]}
          hint="Issue listing"
        />
        <OverviewCard
          href="#db-tests"
          title="Database tests"
          verdict={verdicts.db}
          verdictLabel={dbCheck?.ok ? 'Pass' : 'Fail'}
          headline={String(dbCheck?.passedCount ?? 0)}
          headlineUnit={dbCheck?.totalCount ? ` / ${dbCheck.totalCount}` : undefined}
          stats={[formatDuration(dbCheck?.durationMs ?? 0), dbCheck?.summary ?? '']}
          hint="View all"
        />
        <OverviewCard
          href="#coverage"
          title="Code coverage"
          verdict={verdicts.coverage}
          verdictLabel={belowMinimumFiles > 0 ? `${belowMinimumFiles} files < 75%` : 'Clear'}
          headline={linesBenchmark?.value ?? '—'}
          headlineUnit="%"
          stats={['min 75% per file', `${belowMinimumFiles} below minimum`]}
          hint="All files"
        />
        <OverviewCard
          href="#security"
          title="Security"
          verdict={verdicts.security}
          verdictLabel={
            securityAggregate
              ? `${securityAggregate.critical} critical · ${securityAggregate.high} high`
              : '—'
          }
          headline={String((securityAggregate?.critical ?? 0) + (securityAggregate?.high ?? 0))}
          stats={[
            `${securityAggregate?.critical ?? 0} critical`,
            `${securityAggregate?.high ?? 0} high`,
            `${securityAggregate?.moderate ?? 0} moderate`,
          ]}
          hint="CVEs by component"
        />
        <OverviewCard
          href="#e2e"
          title="E2E tests"
          verdict={verdicts.e2e}
          verdictLabel={
            verdicts.e2e === 'fail' ? 'Fail' : verdicts.e2e === 'warn' ? 'Flaky' : 'Pass'
          }
          headline={
            e2eCheck?.totalCount
              ? `${(((e2eCheck.passedCount ?? 0) / e2eCheck.totalCount) * 100).toFixed(0)}`
              : '—'
          }
          headlineUnit="%"
          stats={[
            `${e2eCheck?.passedCount ?? 0} passed`,
            `${e2eCheck?.failedCount ?? 0} failed`,
            `${e2eFlakyCount} flaky`,
          ]}
          hint="By spec"
        />
      </div>

      <UnitTestsPanel check={unitCheck} />
      <StaticAnalysisPanel lint={lintCheck} />
      <DatabaseTestsPanel check={dbCheck} />
      <CoveragePanel check={coverageCheck} />
      <SecurityPanel check={securityCheck} />
      <E2ePanel check={e2eCheck} />

      <footer className="developer-dashboard__footer">
        <span>Generated {formatClock(status.generatedAt)}</span>
        <span>{status.cache.fromCache ? 'Cached result' : 'Fresh run'}</span>
      </footer>
    </section>
  );
}
