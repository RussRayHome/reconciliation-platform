import { Fragment, useCallback, useEffect, useState } from 'react';

import { dashboardApiFetch } from '../lib/api';
import { SkeletonPanel, KpiWellsSkeleton, SkeletonLines, TableSkeleton } from './Skeleton';
import { RepoStatusSection, type RepoStatusPayload } from './RepoStatus';
import { ComplexityPanel, type ComplexityScan } from './ComplexityPanel';
import { DetailPanel, StatusPill, type Verdict } from './StatusPrimitives';

/*
 * Ported from apps/web/src/components/DeveloperDashboard.tsx (the product's in-app "Developer
 * dashboard" tab) rather than built from scratch, per the standing decision to reuse that screen
 * -- same cards/panels, same DeveloperStatusPayload shape (this app's /api/status just proxies
 * the published dashboard-status/<env>.json, produced by the same developerStatusParsing.ts
 * functions the old live endpoint used). What changed vs. the original:
 *   - No "Force refresh" button / no detached-check polling -- this dashboard is deliberately
 *     passive, it only ever shows the last scheduled GitHub Actions run, never triggers one.
 *   - No /api/developer/runtime call (live git branch/commit) -- replaced with the environment +
 *     revision already present in the published payload's own promotionReadiness data.
 *   - No `cache` field (fromCache/stale) -- the payload is a static publish, not a live cache.
 *   - Adds the signed-in GitHub user + a sign-out action in the header.
 *
 * Secret Integrity (below) is the one deliberate exception to "deliberately passive": its findings
 * are still read-only from the published payload, but its runbook actions (Rotate now / Triage /
 * Dismiss / Verify purge) really do write, via POST /api/secret-actions, to a
 * dashboard_secret_change_log table in the product's own Postgres (see secretActionsStore.ts and
 * changesets 0035/0036) -- reusing its backup/pgaudit coverage for this SOX-relevant audit trail,
 * via a least-privilege role scoped to that one table and nothing else in the schema.
 *
 * Repository status used to be a separate /repo route reachable via a card link; per the
 * follow-up design instruction it's now rendered inline at the top of this same page (below the
 * shared header, above "Testing & verification"), sharing this component's single /api/status
 * fetch rather than each screen fetching it independently.
 */

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

type SecretFindingOccurrence = {
  file: string;
  startLine?: number;
  commit?: string;
  author?: string;
  date?: string;
  presentAtHead: boolean;
};

type SecretFinding = {
  fingerprint: string;
  maskedSecret: string;
  ruleId: string;
  description: string;
  sources: string[];
  verified: boolean | null;
  occurrences: SecretFindingOccurrence[];
};

const SECRET_ACTION_TYPES = ['rotate', 'triage', 'dismiss', 'verify_purge'] as const;
type SecretActionType = (typeof SECRET_ACTION_TYPES)[number];

type SecretChangeLogEntry = {
  id: number;
  fingerprint: string;
  action: SecretActionType;
  actor: string;
  ticket: string | null;
  note: string | null;
  createdAt: string;
};

type SecretActionsResponse = {
  changeLog: SecretChangeLogEntry[];
  latestByFingerprint: Record<string, SecretChangeLogEntry>;
};

const EMPTY_SECRET_ACTIONS: SecretActionsResponse = { changeLog: [], latestByFingerprint: {} };

type SecretScanRunRecord = {
  id: number;
  generatedAt: string;
  status: string;
  gitleaksAvailable: boolean;
  trufflehogAvailable: boolean;
  aggregate: { critical: number; high: number; moderate: number; low: number; info: number };
};

type SecretFindingHistoryEntry = {
  runId: number;
  generatedAt: string;
  presentAtHead: boolean;
  verified: boolean | null;
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
  securityComponentScores?: SecurityComponentScore[];
  securityAggregateScore?: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    info: number;
  };
  secretFindings?: SecretFinding[];
  secretFindingsAggregate?: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    info: number;
  };
  secretScanTools?: { gitleaks: boolean; trufflehog: boolean };
  complexityScan?: ComplexityScan;
};

type PromotionReadiness = {
  environments: Array<{ name: string; targetRevision: string | null }>;
};

type DeveloperStatusResponse = {
  generatedAt: string;
  environment: string;
  overallStatus: 'healthy' | 'attention-needed';
  failedChecks: number;
  passedChecks: number;
  totalChecks: number;
  totalDurationMs: number;
  checks: DeveloperCheckResponse[];
  promotionReadiness: PromotionReadiness;
  repoStatus: RepoStatusPayload;
};

type Session = { login: string; name: string | null; avatarUrl: string | null };

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

const isResolvingAction = (entry: SecretChangeLogEntry | undefined): boolean =>
  entry?.action === 'rotate' || entry?.action === 'dismiss' || entry?.action === 'verify_purge';

type SecretBand = 'verified-live' | 'unverified' | 'resolved';

const bandForFinding = (
  finding: SecretFinding,
  latest: SecretChangeLogEntry | undefined,
): SecretBand => {
  if (isResolvingAction(latest)) return 'resolved';
  return finding.verified === true ? 'verified-live' : 'unverified';
};

const secretVerdict = (
  check: DeveloperCheckResponse | undefined,
  latestByFingerprint: Record<string, SecretChangeLogEntry>,
): Verdict => {
  if (!check) return 'neutral';
  const findings = check.secretFindings ?? [];
  const unresolved = findings.filter(
    (finding) => bandForFinding(finding, latestByFingerprint[finding.fingerprint]) !== 'resolved',
  );
  if (!check.ok || unresolved.some((finding) => finding.verified === true)) return 'fail';
  if (unresolved.some((finding) => finding.occurrences.some((occurrence) => occurrence.presentAtHead))) return 'warn';
  return unresolved.length > 0 ? 'warn' : 'pass';
};

const e2eVerdict = (check: DeveloperCheckResponse | undefined): Verdict => {
  if (!check) return 'neutral';
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

function VerdictBanner({ verdict }: Readonly<{ verdict: 'Healthy' | 'Degraded' | 'Failing' }>) {
  const tone: Verdict = verdict === 'Healthy' ? 'pass' : verdict === 'Degraded' ? 'warn' : 'fail';
  return <StatusPill verdict={tone} label={verdict} />;
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
    <DetailPanel
      id="unit-tests"
      title="Unit tests — failed & skipped"
      subtitle={
        <>
          {check?.passedCount ?? 0} passed hidden · {formatDuration(check?.durationMs ?? 0)}
        </>
      }
    >
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
    </DetailPanel>
  );
}

function StaticAnalysisPanel({ lint }: Readonly<{ lint: DeveloperCheckResponse | undefined }>) {
  const issues = lint?.lintIssues ?? [];

  return (
    <DetailPanel id="static" title="Static code analysis — issue listing" subtitle={lint?.summary ?? 'ESLint'}>
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
    </DetailPanel>
  );
}

function DatabaseTestsPanel({ check }: Readonly<{ check: DeveloperCheckResponse | undefined }>) {
  const items = check?.dbTestItems ?? [];

  return (
    <DetailPanel id="db-tests" title="Database tests — full listing" subtitle={check?.summary ?? 'Postgres'}>
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
    </DetailPanel>
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
  const previewCount = Math.max(
    files.filter((file) => file.lines < 80).length,
    Math.min(files.length, 15),
  );
  const visible = expanded ? files : files.slice(0, previewCount);
  const remaining = files.length - visible.length;

  return (
    <DetailPanel
      id="coverage"
      title="Coverage by file — entire application"
      subtitle={
        <>
          All {files.length} files, lowest first ·{' '}
          <strong className={belowMinimum > 0 ? 'detail-panel__warning-text' : undefined}>
            minimum 75% lines per file
            {belowMinimum > 0 ? ` — ${belowMinimum} files below minimum` : ''}
          </strong>
        </>
      }
    >
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
    </DetailPanel>
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
    <DetailPanel
      id="security"
      title="Security — vulnerabilities by major component"
      subtitle={
        <>
          Trivy + npm audit · {aggregate?.critical ?? 0} critical · {aggregate?.high ?? 0} high ·{' '}
          {aggregate?.moderate ?? 0} moderate and {aggregate?.low ?? 0} low
        </>
      }
    >
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
    </DetailPanel>
  );
}

const SECRET_ACTION_LABELS: Record<SecretActionType, string> = {
  rotate: 'Rotate now',
  triage: 'Triage',
  dismiss: 'Dismiss',
  verify_purge: 'Verify purge',
};

const SECRET_BAND_LABELS: Record<SecretBand, string> = {
  'verified-live': 'Verified live',
  unverified: 'Unverified',
  resolved: 'Resolved',
};

const SECRET_BAND_ORDER: SecretBand[] = ['verified-live', 'unverified', 'resolved'];

function SecretIntegrityPanel({
  check,
  actions,
  onActionRecorded,
}: Readonly<{
  check: DeveloperCheckResponse | undefined;
  actions: SecretActionsResponse;
  onActionRecorded: () => void;
}>) {
  const [expandedFingerprint, setExpandedFingerprint] = useState<string | null>(null);
  const [draftTicket, setDraftTicket] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [submittingAction, setSubmittingAction] = useState<SecretActionType | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [collapsedBands, setCollapsedBands] = useState<Record<SecretBand, boolean>>({
    'verified-live': false,
    unverified: false,
    resolved: true,
  });
  const [runHistory, setRunHistory] = useState<SecretScanRunRecord[]>([]);
  const [findingHistoryByFingerprint, setFindingHistoryByFingerprint] = useState<
    Record<string, SecretFindingHistoryEntry[]>
  >({});
  const [loadingFindingHistory, setLoadingFindingHistory] = useState<string | null>(null);

  useEffect(() => {
    dashboardApiFetch('/api/secret-scan-history')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { runs: SecretScanRunRecord[] } | null) => {
        if (payload) setRunHistory(payload.runs);
      })
      .catch(() => {
        // Non-fatal: the panel still works with only the latest run's findings.
      });
  }, []);

  const loadFindingHistory = async (fingerprint: string): Promise<void> => {
    if (findingHistoryByFingerprint[fingerprint]) return;
    setLoadingFindingHistory(fingerprint);
    try {
      const response = await dashboardApiFetch(
        `/api/secret-scan-history?fingerprint=${encodeURIComponent(fingerprint)}`,
      );
      if (response.ok) {
        const payload = (await response.json()) as { findingHistory: SecretFindingHistoryEntry[] };
        setFindingHistoryByFingerprint((current) => ({ ...current, [fingerprint]: payload.findingHistory }));
      }
    } catch {
      // Non-fatal: the runbook still works without historical context.
    } finally {
      setLoadingFindingHistory(null);
    }
  };

  const findings = check?.secretFindings ?? [];
  const grouped: Record<SecretBand, SecretFinding[]> = {
    'verified-live': [],
    unverified: [],
    resolved: [],
  };
  for (const finding of findings) {
    grouped[bandForFinding(finding, actions.latestByFingerprint[finding.fingerprint])].push(finding);
  }

  const toggleFinding = (fingerprint: string): void => {
    const opening = expandedFingerprint !== fingerprint;
    setExpandedFingerprint(opening ? fingerprint : null);
    if (opening) {
      void loadFindingHistory(fingerprint);
    }
    setDraftTicket('');
    setDraftNote('');
    setSubmitError(null);
  };

  const submitAction = async (fingerprint: string, action: SecretActionType): Promise<void> => {
    setSubmittingAction(action);
    setSubmitError(null);
    try {
      const response = await dashboardApiFetch('/api/secret-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fingerprint,
          action,
          ticket: draftTicket.trim() || undefined,
          note: draftNote.trim() || undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}.`);
      }
      setExpandedFingerprint(null);
      setDraftTicket('');
      setDraftNote('');
      onActionRecorded();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to record this action.');
    } finally {
      setSubmittingAction(null);
    }
  };

  const renderFindingRow = (finding: SecretFinding) => {
    const latest = actions.latestByFingerprint[finding.fingerprint];
    const isExpanded = expandedFingerprint === finding.fingerprint;
    const history = actions.changeLog.filter((entry) => entry.fingerprint === finding.fingerprint);
    const scanHistory = findingHistoryByFingerprint[finding.fingerprint];
    const presentAtHead = finding.occurrences.some((occurrence) => occurrence.presentAtHead);
    const [firstOccurrence, ...restOccurrences] = finding.occurrences;
    if (!firstOccurrence) {
      // A finding always has at least one occurrence (enforced when the payload is parsed) --
      // this is just satisfying the type checker's inability to see that invariant.
      return null;
    }

    return (
      <Fragment key={finding.fingerprint}>
        <tr>
          <td className="mono">{finding.maskedSecret}</td>
          <td className="mono">{finding.ruleId}</td>
          <td className="mono">
            {firstOccurrence.file}
            {firstOccurrence.startLine ? `:${firstOccurrence.startLine}` : ''}
            {restOccurrences.length > 0 ? ` +${restOccurrences.length} more` : ''}
          </td>
          <td>
            {finding.verified === true ? (
              <StatusPill verdict="fail" label="Verified live" />
            ) : finding.verified === false ? (
              <StatusPill verdict="neutral" label="Confirmed inactive" />
            ) : (
              <StatusPill verdict="warn" label="Unverified" />
            )}
          </td>
          <td>
            <StatusPill
              verdict={presentAtHead ? 'warn' : 'neutral'}
              label={presentAtHead ? 'In current tree' : 'History only'}
            />
          </td>
          <td>{latest ? `${SECRET_ACTION_LABELS[latest.action]} · ${latest.actor}` : '—'}</td>
          <td>
            <button
              type="button"
              className="detail-panel__expand"
              onClick={() => toggleFinding(finding.fingerprint)}
            >
              {isExpanded ? 'Close' : 'Runbook'}
            </button>
          </td>
        </tr>
        {isExpanded ? (
          <tr className="detail-panel__desc-row">
            <td colSpan={7}>
              <div className="secret-runbook">
                <p>
                  {finding.description} · value withheld, fingerprint {finding.fingerprint} · sources:{' '}
                  {finding.sources.join(', ')}
                </p>
                <table className="secret-runbook__history">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Commit</th>
                      <th>Author</th>
                      <th>Presence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finding.occurrences.map((occurrence) => (
                      <tr key={`${occurrence.file}:${occurrence.startLine ?? ''}:${occurrence.commit ?? ''}`}>
                        <td className="mono">
                          {occurrence.file}
                          {occurrence.startLine ? `:${occurrence.startLine}` : ''}
                        </td>
                        <td className="mono">{occurrence.commit ?? '—'}</td>
                        <td>{occurrence.author ?? '—'}</td>
                        <td>{occurrence.presentAtHead ? 'In current tree' : 'History only'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="secret-runbook__form">
                  <input
                    type="text"
                    placeholder="Ticket (optional)"
                    value={draftTicket}
                    onChange={(event) => setDraftTicket(event.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Note (optional)"
                    value={draftNote}
                    onChange={(event) => setDraftNote(event.target.value)}
                  />
                </div>
                {submitError ? <p className="developer-dashboard__error">{submitError}</p> : null}
                <div className="secret-runbook__actions">
                  {SECRET_ACTION_TYPES.map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="secondary-button"
                      disabled={submittingAction !== null}
                      onClick={() => void submitAction(finding.fingerprint, action)}
                    >
                      {submittingAction === action ? 'Recording…' : SECRET_ACTION_LABELS[action]}
                    </button>
                  ))}
                </div>
                {history.length > 0 ? (
                  <table className="secret-runbook__history">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Action</th>
                        <th>Actor</th>
                        <th>Ticket</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((entry) => (
                        <tr key={entry.id}>
                          <td className="mono">{formatClock(entry.createdAt)}</td>
                          <td>{SECRET_ACTION_LABELS[entry.action]}</td>
                          <td>{entry.actor}</td>
                          <td>{entry.ticket ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {scanHistory && scanHistory.length > 0 ? (
                  <table className="secret-runbook__history">
                    <thead>
                      <tr>
                        <th>Scan date</th>
                        <th>Verification</th>
                        <th>Presence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scanHistory.map((entry) => (
                        <tr key={entry.runId}>
                          <td className="mono">{formatClock(entry.generatedAt)}</td>
                          <td>
                            {entry.verified === true
                              ? 'Verified live'
                              : entry.verified === false
                                ? 'Confirmed inactive'
                                : 'Unverified'}
                          </td>
                          <td>{entry.presentAtHead ? 'In current tree' : 'History only'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : loadingFindingHistory === finding.fingerprint ? (
                  <p className="detail-panel__empty">Loading scan history…</p>
                ) : null}
              </div>
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  return (
    <DetailPanel
      id="secret-integrity"
      title="Secret integrity — gitleaks + trufflehog"
      subtitle={
        <>
          {check?.secretScanTools?.gitleaks ? 'gitleaks' : 'gitleaks unavailable'} ·{' '}
          {check?.secretScanTools?.trufflehog ? 'trufflehog verification' : 'trufflehog unavailable'} ·{' '}
          {findings.length} finding{findings.length === 1 ? '' : 's'}
        </>
      }
    >
      {findings.length === 0 ? (
        <p className="detail-panel__empty">No secrets detected in the latest scan.</p>
      ) : (
        SECRET_BAND_ORDER.map((band) => {
          const bandFindings = grouped[band];
          if (bandFindings.length === 0) return null;
          const collapsed = collapsedBands[band];

          return (
            <div className="vuln-group" key={band}>
              <div className="vuln-group__head">
                <h4>
                  {SECRET_BAND_LABELS[band]} ({bandFindings.length})
                </h4>
                <button
                  type="button"
                  className="detail-panel__expand"
                  onClick={() =>
                    setCollapsedBands((current) => ({ ...current, [band]: !current[band] }))
                  }
                >
                  {collapsed ? 'Show' : 'Hide'}
                </button>
              </div>
              {collapsed ? null : (
                <table>
                  <thead>
                    <tr>
                      <th>Secret</th>
                      <th>Rule</th>
                      <th>Location</th>
                      <th>Verification</th>
                      <th>Presence</th>
                      <th>Latest action</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>{bandFindings.map(renderFindingRow)}</tbody>
                </table>
              )}
            </div>
          );
        })
      )}
      <div className="secret-changelog">
        <h4>Secret change log</h4>
        {actions.changeLog.length === 0 ? (
          <p className="detail-panel__empty">No actions recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Secret</th>
                <th>Actor</th>
                <th>Ticket</th>
              </tr>
            </thead>
            <tbody>
              {actions.changeLog.map((entry) => {
                const finding = findings.find((item) => item.fingerprint === entry.fingerprint);
                return (
                  <tr key={entry.id}>
                    <td className="mono">{formatClock(entry.createdAt)}</td>
                    <td>{SECRET_ACTION_LABELS[entry.action]}</td>
                    <td className="mono">{finding?.maskedSecret ?? `fp:${entry.fingerprint.slice(0, 8)}`}</td>
                    <td>{entry.actor}</td>
                    <td>{entry.ticket ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="secret-changelog">
        <h4>Scan history</h4>
        {runHistory.length === 0 ? (
          <p className="detail-panel__empty">No prior scan runs recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Scan date</th>
                <th className="num">Verified live</th>
                <th className="num">In current tree</th>
                <th className="num">Historical</th>
                <th>Tools</th>
              </tr>
            </thead>
            <tbody>
              {runHistory.map((run) => (
                <tr key={run.id}>
                  <td className="mono">{formatClock(run.generatedAt)}</td>
                  <td className="num">{run.aggregate.critical}</td>
                  <td className="num">{run.aggregate.high}</td>
                  <td className="num">{run.aggregate.moderate}</td>
                  <td>
                    {[run.gitleaksAvailable ? 'gitleaks' : null, run.trufflehogAvailable ? 'trufflehog' : null]
                      .filter(Boolean)
                      .join(' + ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </DetailPanel>
  );
}

function E2ePanel({ check }: Readonly<{ check: DeveloperCheckResponse | undefined }>) {
  const specs = [...(check?.e2eSpecs ?? [])].sort((a, b) => {
    const rank = (status: E2eSpecItem['status']): number =>
      status === 'failed' ? 0 : status === 'flaky' ? 1 : status === 'skipped' ? 2 : 3;
    return rank(a.status) - rank(b.status);
  });

  return (
    <DetailPanel
      id="e2e"
      title="E2E test results"
      subtitle={
        <>
          Playwright · {specs.length} specs · {formatDuration(check?.durationMs ?? 0)}
        </>
      }
    >
      {specs.length === 0 ? (
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
    </DetailPanel>
  );
}

const signOut = async (): Promise<void> => {
  await dashboardApiFetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
};

/**
 * Developer Dashboard "Application Health" screen: repo-health KPI band, six
 * drill-down result cards (unit/static/db/coverage/security/e2e), and a full
 * detail panel per card with per-item data pulled from the latest published
 * quality-gate run (see .github/workflows/dashboard-status.yml).
 */
export function DeveloperDashboard({ session }: Readonly<{ session: Session }>) {
  const [status, setStatus] = useState<DeveloperStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [secretActions, setSecretActions] = useState<SecretActionsResponse>(EMPTY_SECRET_ACTIONS);

  const loadDashboard = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const response = await dashboardApiFetch('/api/status');
      const payload = await parseJsonResponse<DeveloperStatusResponse>(response);
      setStatus(payload);
      setStatusError(null);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Unable to load the published status.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Independent of loadDashboard/its 60s status cache: this reads live, mutable action state, not
  // the passive nightly-published payload, and needs to refresh right after a runbook action posts.
  const loadSecretActions = useCallback(async (): Promise<void> => {
    try {
      const response = await dashboardApiFetch('/api/secret-actions');
      const payload = await parseJsonResponse<SecretActionsResponse>(response);
      setSecretActions(payload);
    } catch {
      // Non-fatal: the panel still renders scan findings without action history.
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadSecretActions();
  }, [loadSecretActions]);

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
  const secretCheck = findCheck(status.checks, 'Secret integrity');
  const e2eCheck = findCheck(status.checks, 'E2E tests');
  const complexityCheck = findCheck(status.checks, 'Complexity');

  const verdicts = {
    unit: unitVerdict(unitCheck),
    staticAnalysis: staticVerdict(lintCheck, typecheckCheck),
    db: dbVerdict(dbCheck),
    coverage: coverageVerdict(coverageCheck),
    security: securityVerdict(securityCheck),
    secrets: secretVerdict(secretCheck, secretActions.latestByFingerprint),
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
  const branchesBenchmark = coverageCheck?.coverageBenchmarks?.find(
    (benchmark) => benchmark.key === 'B',
  );
  const securityAggregate = securityCheck?.securityAggregateScore;
  const e2eFlakyCount = (e2eCheck?.e2eSpecs ?? []).filter((spec) => spec.status === 'flaky').length;

  const secretFindings = secretCheck?.secretFindings ?? [];
  const secretBandCounts = secretFindings.reduce(
    (counts, finding) => {
      counts[bandForFinding(finding, secretActions.latestByFingerprint[finding.fingerprint])] += 1;
      return counts;
    },
    { 'verified-live': 0, unverified: 0, resolved: 0 } as Record<SecretBand, number>,
  );

  const revision = status.promotionReadiness.environments.find(
    (env) => env.name === status.environment,
  )?.targetRevision;

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
            {status.environment} @ {shortRevision(revision)}
          </span>
          <span className="developer-dashboard__meta">
            Published {formatClock(status.generatedAt)}
          </span>
        </div>
        <div className="developer-dashboard__actions">
          <span className="developer-dashboard__meta">Signed in as {session.login}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadDashboard()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <a
            className="secondary-button"
            href={`https://github.com/${status.repoStatus.repo.slug}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in GitHub
          </a>
          <button type="button" className="secondary-button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {statusError ? <p className="developer-dashboard__error">{statusError}</p> : null}

      <RepoStatusSection status={status.repoStatus} />

      <div className="developer-dashboard__section-head">
        <h2>Testing &amp; verification</h2>
        <span className="developer-dashboard__section-sub">
          All results from the latest published run on{' '}
          <span className="mono">{shortRevision(revision)}</span>
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
          stats={[
            `${branchesBenchmark?.value ?? '—'}% branches`,
            'min 75% per file',
            `${belowMinimumFiles} below minimum`,
          ]}
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
          href="#secret-integrity"
          title="Secret integrity"
          verdict={verdicts.secrets}
          verdictLabel={
            secretBandCounts['verified-live'] > 0
              ? `${secretBandCounts['verified-live']} verified live`
              : secretBandCounts.unverified > 0
                ? `${secretBandCounts.unverified} unverified`
                : 'Clear'
          }
          headline={String(secretFindings.length)}
          stats={[
            `${secretBandCounts['verified-live']} verified live`,
            `${secretBandCounts.unverified} unverified`,
            `${secretBandCounts.resolved} resolved`,
          ]}
          hint="Findings & runbook"
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
      <SecretIntegrityPanel
        check={secretCheck}
        actions={secretActions}
        onActionRecorded={() => void loadSecretActions()}
      />
      <E2ePanel check={e2eCheck} />

      <ComplexityPanel scan={complexityCheck?.complexityScan ?? null} />

      <footer className="developer-dashboard__footer">
        <span>Published {formatClock(status.generatedAt)}</span>
        <span>{status.environment}</span>
      </footer>
    </section>
  );
}
