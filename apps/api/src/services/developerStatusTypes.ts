export type CoverageBenchmarkKey = 'S' | 'B' | 'F' | 'L';

export type CoverageBenchmark = {
  key: CoverageBenchmarkKey;
  label: string;
  value: string;
  threshold: string;
  meetsThreshold: boolean;
};

export type SecuritySeverityScore = {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  total: number;
};

export type SecurityComponentScore = SecuritySeverityScore & {
  component: string;
  scanner: string;
  status: 'ok' | 'skipped' | 'error';
  note?: string;
  cveFindings?: SecurityCveFinding[];
};

export type SecurityCveFinding = {
  id: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'INFO' | 'UNKNOWN';
  component: string;
  scanner: string;
};

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
  passedCount?: number;
  failedCount?: number;
  totalCount?: number;
  coverageBenchmarks?: CoverageBenchmark[];
  securityComponentScores?: SecurityComponentScore[];
  securityAggregateScore?: SecuritySeverityScore;
  securityCveFindings?: SecurityCveFinding[];
};

export type TestBreakdown = {
  type: 'unit' | 'integration' | 'e2e' | 'postgres';
  label: string;
  passed: number;
  failed: number;
  total: number;
};

export type DeveloperHistoryTestTotals = {
  passed: number;
  failed: number;
  total: number;
  byType: TestBreakdown[];
};

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
};

export type CoverageMetrics = {
  statements: string;
  branches: string;
  functions: string;
  lines: string;
};

export type DeveloperStatusCacheInfo = {
  ttlMs: number;
  ageMs: number;
  fromCache: boolean;
};

export type DeveloperStatusResult = {
  payload: DeveloperStatusPayload;
  cache: DeveloperStatusCacheInfo;
};

export type CreateDeveloperStatusServiceOptions = {
  repoRoot: string;
  defaultDatabaseUrl: string;
  statusCacheTtlMs?: number;
  statusHistoryLimit?: number;
};
