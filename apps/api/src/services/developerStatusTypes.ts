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
  lines: number;
  branches: number;
  functions: number;
  uncoveredLineCount: number;
  meetsMinimum: boolean;
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

/** Full status payload returned by `GET /api/developer/status`. */
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
