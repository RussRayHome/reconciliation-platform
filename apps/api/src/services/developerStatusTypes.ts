/** Single-character key identifying a coverage dimension: Statements, Branches, Functions, Lines. */
export type CoverageBenchmarkKey = 'S' | 'B' | 'F' | 'L';

/** Coverage percentage for one dimension along with its threshold and pass/fail status. */
export type CoverageBenchmark = {
  key: CoverageBenchmarkKey;
  label: string;
  value: string;
  threshold: string;
  meetsThreshold: boolean;
};

/** Aggregated CVE counts across all severity levels for a single scanner result. */
export type SecuritySeverityScore = {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  total: number;
};

/** Severity counts and metadata for one scanned component (API, Database, Container, Web Server). */
export type SecurityComponentScore = SecuritySeverityScore & {
  component: string;
  scanner: string;
  status: 'ok' | 'skipped' | 'error';
  note?: string;
  cveFindings?: SecurityCveFinding[];
};

/** A single CVE finding from Trivy or npm audit, attributed to a component and scanner. */
export type SecurityCveFinding = {
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

/** One place a secret-scan finding's value was seen -- a single file/line/commit. A secret
 *  copy-pasted into multiple files (e.g. an env file and the incident doc describing it, per
 *  ISSUE-049) is one SecretFinding with multiple occurrences, not multiple findings. */
export type SecretFindingOccurrence = {
  file: string;
  startLine?: number;
  commit?: string;
  author?: string;
  date?: string;
  presentAtHead: boolean;
};

/** One secret-scan finding merged from gitleaks (breadth) and trufflehog (live verification),
 *  keyed by a sha256 fingerprint of the secret value. The value itself is never carried past the
 *  scanner script -- only the fingerprint and a partial display mask reach this type. */
export type SecretFinding = {
  fingerprint: string;
  maskedSecret: string;
  ruleId: string;
  description: string;
  sources: string[];
  verified: boolean | null;
  occurrences: SecretFindingOccurrence[];
};

/** Severity counts for the secret-scan check -- critical=verified live, high=present at HEAD but
 *  unverified, moderate=historical-only and unverified. low/info are unused but kept for shape
 *  parity with SecuritySeverityScore. */
export type SecretFindingsScore = SecuritySeverityScore;

/** Status record for one penetration-test suite shown under Security Vulnerabilities. */
export type PenetrationTestStatus = {
  testName: string;
  testType: string;
  status: 'passed' | 'failed' | 'not-run';
  note?: string;
  source?: string;
};

/** One test result extracted from a Vitest JSON run (unit/integration/postgres). Callers filter to failed/skipped as needed. */
export type TestItem = {
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped';
  reason?: string;
  durationMs?: number;
};

/** One ESLint finding extracted from `eslint --format json`. */
export type LintIssue = {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  file: string;
  line: number;
  message: string;
};

/** Per-file coverage row extracted from coverage/coverage-summary.json (Istanbul json-summary format). */
export type CoverageFileEntry = {
  filePath: string;
  statements: number;
  lines: number;
  branches: number;
  functions: number;
  uncoveredLineCount: number;
  meetsMinimum: boolean;
};

/** One function/method's complexity metrics, extracted from escomplex's per-function report. No
 *  nesting depth or exit-point count -- escomplex doesn't report those, and the Code Health
 *  section hides those columns rather than estimate them. */
export type ComplexityMethod = {
  name: string;
  cc: number;
  lines: number;
  params: number;
  startLine: number;
};

/** One node in the complexity scan's directory tree -- a directory (with children) or a file
 *  (with its own methods). Mirrors scripts/escomplex-analysis.ts's ScanNode. */
export type ComplexityNode =
  | { type: 'dir'; name: string; children: ComplexityNode[] }
  | { type: 'file'; name: string; lines: number; methods: ComplexityMethod[] };

/** Whole-repo complexity scan as written by `scripts/escomplex-analysis.ts --json-out`. */
export type ComplexityScan = {
  scannedAt: string;
  root: ComplexityNode;
};

/** One database test result extracted from the Postgres preflight/Vitest run. */
export type DbTestItem = {
  name: string;
  category: 'migration' | 'constraint' | 'seed' | 'behavior' | 'other';
  status: 'passed' | 'failed';
  durationMs?: number;
  failureMessage?: string;
};

/** One Playwright spec result extracted from `playwright test --reporter=json`. */
export type E2eSpecItem = {
  name: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  durationMs: number;
  retries: number;
  artifactPath?: string;
};

/** One module in the dependency graph, normalized from dependency-cruiser's raw JSON by
 *  scripts/ci/depcruise-scan.ts. fanIn/fanOut/instability count LOCAL dependencies only (external
 *  packages excluded), so instability = fanOut/(fanIn+fanOut) stays consistent with the fanIn/
 *  fanOut numbers shown next to it in the UI. */
export type DependencyModule = {
  name: string;
  folder: string;
  loc: number;
  deps: string[];
  fanIn: number;
  fanOut: number;
  instability: number;
  cyclic: boolean;
};

/** One dependency-cruiser rule violation (from `.dependency-cruiser.cjs`'s `forbidden` rules). */
export type DependencyViolation = {
  id: string;
  sev: 'error' | 'warn' | 'info';
  from: string;
  to: string;
  note: string;
};

/** Whole-repo dependency graph scan as written by `scripts/ci/depcruise-scan.ts --json-out`. */
export type DependencyScan = {
  scannedAt: string;
  modules: DependencyModule[];
  violations: DependencyViolation[];
};

/** Last full run of this dashboard's own quality-gate check suite (stands in for a literal CI run). */
export type LastCiRunKpi = {
  status: 'healthy' | 'attention-needed';
  durationMs: number;
  at: string;
};

/** Ahead/behind counts between the local tracking branch and its remote, condensed for the KPI band. */
export type BranchFreshnessKpi = {
  remoteRef: string;
  aheadCount: number | null;
  behindCount: number | null;
};

/** Repo Health KPI band values shown at the top of the Developer Dashboard. */
export type RepoHealthKpis = {
  overallStatus: 'healthy' | 'attention-needed';
  failedChecks: number;
  lastCiRun: LastCiRunKpi;
  commitsThisWeek: number | null;
  branchFreshness: BranchFreshnessKpi;
  openPrCount: number | null;
  openPrNote?: string;
};

/** Full result for one quality-gate check including exit code, timing, and optional metadata. */
export type DeveloperCheck = {
  name: string;
  command: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  summary: string;
  details: string;
  highlights?: string[];
  areaLabel?: string;
  testType?: 'unit' | 'integration' | 'e2e' | 'postgres';
  passedFileCount?: number;
  failedFileCount?: number;
  totalFileCount?: number;
  passedCount?: number;
  failedCount?: number;
  totalCount?: number;
  coverageBenchmarks?: CoverageBenchmark[];
  securityComponentScores?: SecurityComponentScore[];
  securityAggregateScore?: SecuritySeverityScore;
  securityCveFindings?: SecurityCveFinding[];
  secretFindings?: SecretFinding[];
  secretFindingsAggregate?: SecretFindingsScore;
  secretScanTools?: { gitleaks: boolean; trufflehog: boolean };
  complexityScan?: ComplexityScan;
  dependencyScan?: DependencyScan;
  penetrationTestStatuses?: PenetrationTestStatus[];
  testItems?: TestItem[];
  lintIssues?: LintIssue[];
  dbTestItems?: DbTestItem[];
  e2eSpecs?: E2eSpecItem[];
  coverageFiles?: CoverageFileEntry[];
  /**
   * True while the check is still executing in the background. The E2E suite runs far longer than
   * a request should block for, so it is started detached and the payload carries a placeholder
   * until it finishes. A running check is neither passed nor failed — exclude it from both counts.
   */
  running?: boolean;
};

/** Pass/fail counts for one test suite type within a status snapshot. */
export type TestBreakdown = {
  type: 'unit' | 'integration' | 'e2e' | 'postgres';
  label: string;
  passed: number;
  failed: number;
  total: number;
};

/** Aggregated test totals across all suite types for a single status snapshot. */
export type DeveloperHistoryTestTotals = {
  passed: number;
  failed: number;
  total: number;
  byType: TestBreakdown[];
};

/** Condensed historical record of one status run, stored in the trailing history array. */
export type DeveloperStatusSnapshot = {
  generatedAt: string;
  overallStatus: 'healthy' | 'attention-needed';
  failedChecks: number;
  totalChecks: number;
  totalDurationMs: number;
  failingCheckNames: string[];
  failingAreas: string[];
  testTotals: DeveloperHistoryTestTotals;
  checks: Array<Pick<DeveloperCheck, 'name' | 'ok' | 'durationMs' | 'summary'>>;
};

/** Full status payload shape -- shared by scripts/ci/aggregate-dashboard-status.ts (the only
 *  remaining producer, publishing to the status-data branch) and its parsing helpers below. */
export type DeveloperStatusPayload = {
  generatedAt: string;
  repositoryPath: string;
  overallStatus: 'healthy' | 'attention-needed';
  failedChecks: number;
  passedChecks: number;
  totalChecks: number;
  totalDurationMs: number;
  checks: DeveloperCheck[];
  history: DeveloperStatusSnapshot[];
  repoHealth: RepoHealthKpis;
};

/** Raw percentage strings for each coverage dimension parsed from the coverage summary JSON. */
export type CoverageMetrics = {
  statements: string;
  branches: string;
  functions: string;
  lines: string;
};

/** Cache metadata attached to each status response so callers can detect stale results. */
export type DeveloperStatusCacheInfo = {
  ttlMs: number;
  ageMs: number;
  fromCache: boolean;
  stale?: boolean;
  refreshInProgress?: boolean;
};

/** Combined return value from `getStatus`, pairing the payload with cache metadata. */
export type DeveloperStatusResult = {
  payload: DeveloperStatusPayload;
  cache: DeveloperStatusCacheInfo;
};

/** Constructor options for `createDeveloperStatusService`. */
export type CreateDeveloperStatusServiceOptions = {
  repoRoot: string;
  defaultDatabaseUrl: string;
  statusCacheTtlMs?: number;
  statusHistoryLimit?: number;
  statusCachePath?: string;
};
