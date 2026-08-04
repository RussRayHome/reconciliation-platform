import type {
  CoverageBenchmark,
  CoverageBenchmarkKey,
  CoverageFileEntry,
  CoverageMetrics,
  DbTestItem,
  DeveloperCheck,
  E2eSpecItem,
  LintIssue,
  SecurityComponentScore,
  SecurityCveFinding,
  SecuritySeverityScore,
  TestItem,
} from './developerStatusTypes';

/** Formats a command and its arguments into a single display string for check labels. */
export const formatCommand = (command: string, args: string[]): string =>
  [command, ...args].join(' ');

/** Truncates long command output to `limit` characters, preserving the head and tail with a truncation marker. */
export const truncateOutput = (value: string, limit = 24000): string => {
  if (value.length <= limit) {
    return value;
  }

  const marker = '\n...output truncated...\n';
  const headLength = Math.floor(limit * 0.6);
  const tailLength = Math.max(0, limit - headLength - marker.length);

  return `${value.slice(0, headLength)}${marker}${value.slice(-tailLength)}`;
};

const stripAnsi = (value: string): string =>
  value
    .split('\u001b')
    .map((segment, index) => (index === 0 ? segment : segment.replace(/^\[[0-9;]*m/, '')))
    .join('');

const parseSummaryCounts = (value: string): { passed: number; failed: number } | null => {
  const passedMatch = /(\d+)\s+passed\b/i.exec(value);
  const failedMatch = /(\d+)\s+failed\b/i.exec(value);
  const passed = Number(passedMatch?.[1] ?? '0');
  const failed = Number(failedMatch?.[1] ?? '0');

  if (passed === 0 && failed === 0) {
    return null;
  }

  return { passed, failed };
};

const parseDbPreflightCounts = (
  value: string,
): { passed: number; failed: number; total: number } | null => {
  const totalsMatch = /Totals:\s*PASS=(\d+)\s*WARN=(\d+)\s*FAIL=(\d+)/i.exec(value);
  if (!totalsMatch) {
    return null;
  }

  const passCount = Number(totalsMatch[1] ?? '0');
  const warnCount = Number(totalsMatch[2] ?? '0');
  const failCount = Number(totalsMatch[3] ?? '0');
  const passed = passCount + warnCount;
  const failed = failCount;

  return {
    passed,
    failed,
    total: passed + failed,
  };
};

/** Extracts pass/fail/total counts from Vitest or Playwright test runner stdout. Returns `null` if no counts are found. */
type ParsedTestMetrics = {
  passed: number;
  failed: number;
  total: number;
  passedFileCount?: number;
  failedFileCount?: number;
  totalFileCount?: number;
};

const parseVitestFileMetrics = (lines: string[]): { passed: number; failed: number } | null => {
  const vitestFilesLine = [...lines].reverse().find((line) => /^Test Files?\b/i.test(line));
  return vitestFilesLine ? parseSummaryCounts(vitestFilesLine) : null;
};

export const parseTestMetrics = (output: string): ParsedTestMetrics | null => {
  const clean = stripAnsi(output);
  const lines = clean
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const vitestFileCounts = parseVitestFileMetrics(lines);

  const vitestTestsLine = [...lines].reverse().find((line) => /^Tests\b/i.test(line));
  const vitestCounts = vitestTestsLine ? parseSummaryCounts(vitestTestsLine) : null;
  if (vitestCounts) {
    const metrics: ParsedTestMetrics = {
      ...vitestCounts,
      total: vitestCounts.passed + vitestCounts.failed,
    };

    if (vitestFileCounts) {
      metrics.passedFileCount = vitestFileCounts.passed;
      metrics.failedFileCount = vitestFileCounts.failed;
      metrics.totalFileCount = vitestFileCounts.passed + vitestFileCounts.failed;
    }

    return metrics;
  }

  if (vitestFileCounts) {
    return {
      passed: vitestFileCounts.passed,
      failed: vitestFileCounts.failed,
      total: vitestFileCounts.passed + vitestFileCounts.failed,
      passedFileCount: vitestFileCounts.passed,
      failedFileCount: vitestFileCounts.failed,
      totalFileCount: vitestFileCounts.passed + vitestFileCounts.failed,
    };
  }

  // Playwright puts "N passed" and "N failed" on the SAME line only when a run has just one
  // outcome. Once there's a mix, it prints "N failed" (followed by the list of failing tests),
  // then later "N passed" as a separate trailing line -- so the two counts must be searched for
  // independently rather than requiring one line to contain both, or a run with real failures
  // silently reports "Failed: 0" (the reversed single-line search finds the trailing "N passed"
  // line first and never reaches the earlier "N failed" line above the failure list).
  const playwrightPassedLine = [...lines].reverse().find((line) => /^\d+\s+passed\b/i.test(line));
  const playwrightFailedLine = [...lines].reverse().find((line) => /^\d+\s+failed\b/i.test(line));
  const playwrightCounts = playwrightPassedLine || playwrightFailedLine
    ? parseSummaryCounts([playwrightFailedLine, playwrightPassedLine].filter(Boolean).join('\n'))
    : null;
  if (playwrightCounts) {
    return {
      ...playwrightCounts,
      total: playwrightCounts.passed + playwrightCounts.failed,
    };
  }

  const dbPreflightCounts = parseDbPreflightCounts(clean);
  if (dbPreflightCounts) {
    return dbPreflightCounts;
  }

  return null;
};

/** Produces a one-line test summary string (e.g. "Passed: 23, Failed: 0") from raw test runner stdout. */
export const summarizeTestOutput = (stdout: string): string => {
  const metrics = parseTestMetrics(stdout);
  if (metrics) {
    return `Passed: ${metrics.passed}, Failed: ${metrics.failed}`;
  }

  const clean = stripAnsi(stdout);
  const hasFailureSignal =
    /\[FAIL\]/i.test(clean) ||
    /(^|\n)\s*(?:FAIL|✘)\b/i.test(clean) ||
    /(^|\n)\s*npm ERR!/i.test(clean) ||
    /preflight failed/i.test(clean) ||
    /Test timeout|Error:/i.test(clean);

  if (hasFailureSignal) {
    return 'Failed (see details)';
  }

  return 'Completed successfully';
};

/** Extracts the problem count from ESLint stdout and returns a concise summary string. */
export const summarizeLintOutput = (stdout: string): string => {
  const problemsMatch = /(\d+) problems?/i.exec(stdout);
  if (problemsMatch) {
    const problemCount = Number(problemsMatch[1]);
    return problemCount === 0 ? 'No lint problems' : `${problemCount} lint problems`;
  }

  return 'No lint problems';
};

/** Returns a fixed summary string for a successful typecheck run (tsc exits 0 with no output). */
export const summarizeTypecheckOutput = (): string => 'No type errors';

/** Parses Vitest coverage table output and returns statement/branch/function/line percentages, or `null` if absent. */
export const parseCoverageMetrics = (output: string): CoverageMetrics | null => {
  const clean = stripAnsi(output);
  const allFilesMatch =
    /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/i.exec(clean);
  if (!allFilesMatch) {
    return null;
  }

  const [, statements, branches, functions, lines] = allFilesMatch;
  return {
    statements: statements ?? '0',
    branches: branches ?? '0',
    functions: functions ?? '0',
    lines: lines ?? '0',
  };
};

const parseJsonPayloadFromMixedOutput = (output: string): unknown => {
  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    return null;
  }

  try {
    return JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as unknown;
  } catch {
    return null;
  }
};

const readOptionalText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
};

const toSearchableText = (value: unknown): string => readOptionalText(value) ?? '';

const toNonNegativeInteger = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.trunc(numeric));
};

const clipText = (value: string, maxLength: number): string => {
  const normalized = value.replaceAll(/\s+/gu, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
};

const zeroSecurityScore = (): SecuritySeverityScore => ({
  critical: 0,
  high: 0,
  moderate: 0,
  low: 0,
  info: 0,
  total: 0,
});

const normalizeSecurityScore = (value: unknown): SecuritySeverityScore => {
  if (typeof value !== 'object' || value === null) {
    return zeroSecurityScore();
  }

  const source = value as Record<string, unknown>;
  const critical = toNonNegativeInteger(source.critical);
  const high = toNonNegativeInteger(source.high);
  const moderate = toNonNegativeInteger(source.moderate);
  const low = toNonNegativeInteger(source.low);
  const info = toNonNegativeInteger(source.info);
  const computedTotal = critical + high + moderate + low + info;
  const providedTotal = toNonNegativeInteger(source.total);

  return {
    critical,
    high,
    moderate,
    low,
    info,
    total: providedTotal > 0 ? providedTotal : computedTotal,
  };
};

const addSecurityScores = (
  left: SecuritySeverityScore,
  right: SecuritySeverityScore,
): SecuritySeverityScore => ({
  critical: left.critical + right.critical,
  high: left.high + right.high,
  moderate: left.moderate + right.moderate,
  low: left.low + right.low,
  info: left.info + right.info,
  total: left.total + right.total,
});

type SecurityScanPayload = {
  components?: unknown;
  aggregate?: unknown;
  cveFindings?: unknown;
};

const readSecurityScanPayload = (output: string): SecurityScanPayload | null => {
  const payload = parseJsonPayloadFromMixedOutput(output);
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  return payload;
};

const cveIdRegex = /CVE-\d{4}-\d+/iu;
const ghsaIdRegex = /GHSA-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/iu;

const securityCveSeverityRank: Record<SecurityCveFinding['severity'], number> = {
  CRITICAL: 0,
  HIGH: 1,
  MODERATE: 2,
  LOW: 3,
  INFO: 4,
  UNKNOWN: 5,
};

const securityCveSeverityLabels = new Set<SecurityCveFinding['severity']>([
  'CRITICAL',
  'HIGH',
  'MODERATE',
  'LOW',
  'INFO',
  'UNKNOWN',
]);

const normalizeSecurityCveId = (value: unknown): string | null => {
  const text = toSearchableText(value).toUpperCase();
  const match = cveIdRegex.exec(text) ?? ghsaIdRegex.exec(text);
  return match ? match[0] : null;
};

const normalizeSecurityCveSeverity = (value: unknown): SecurityCveFinding['severity'] => {
  const normalized = toSearchableText(value).trim().toUpperCase();

  if (normalized === 'MEDIUM') {
    return 'MODERATE';
  }

  if (securityCveSeverityLabels.has(normalized as SecurityCveFinding['severity'])) {
    return normalized as SecurityCveFinding['severity'];
  }

  return 'UNKNOWN';
};

const normalizeSecurityCveDescription = (value: unknown): string => {
  const normalized = toSearchableText(value).replaceAll(/\s+/gu, ' ').trim();

  if (!normalized) {
    return 'No description provided.';
  }

  return normalized.length > 220 ? `${normalized.slice(0, 217).trimEnd()}...` : normalized;
};

const normalizeSecurityCveFinding = (
  entry: unknown,
  fallbackComponent?: string,
  fallbackScanner?: string,
): SecurityCveFinding | null => {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }

  const source = entry as Record<string, unknown>;
  const id =
    normalizeSecurityCveId(source.id) ??
    normalizeSecurityCveId(source.cve) ??
    normalizeSecurityCveId(source.vulnerabilityId);
  if (!id) {
    return null;
  }

  const path = readOptionalText(source.path);
  const status = readOptionalText(source.status);
  const validPath =
    path === 'direct' || path === 'transitive' || path === 'base-image' ? path : undefined;
  const validStatus =
    status === 'open' || status === 'patch-available' || status === 'mitigated'
      ? status
      : undefined;

  return {
    id,
    description: normalizeSecurityCveDescription(source.description ?? source.title),
    severity: normalizeSecurityCveSeverity(source.severity),
    component: readOptionalText(source.component) ?? fallbackComponent ?? 'Unknown component',
    scanner: readOptionalText(source.scanner) ?? fallbackScanner ?? 'Unknown scanner',
    packageName: readOptionalText(source.packageName) ?? undefined,
    installedVersion: readOptionalText(source.installedVersion) ?? undefined,
    fixedVersion: readOptionalText(source.fixedVersion) ?? undefined,
    path: validPath,
    status: validStatus,
  };
};

const normalizeSecurityCveFindings = (
  value: unknown,
  fallbackComponent?: string,
  fallbackScanner?: string,
): SecurityCveFinding[] => {
  const input = Array.isArray(value) ? value : [];
  const deduped = new Map<string, SecurityCveFinding>();

  for (const entry of input) {
    const finding = normalizeSecurityCveFinding(entry, fallbackComponent, fallbackScanner);
    if (!finding) {
      continue;
    }

    const key = `${finding.id}|${finding.component}|${finding.scanner}`;
    const existing = deduped.get(key);
    if (existing) {
      const existingRank = securityCveSeverityRank[existing.severity];
      const incomingRank = securityCveSeverityRank[finding.severity];
      const description =
        finding.description.length > existing.description.length
          ? finding.description
          : existing.description;

      deduped.set(key, {
        ...existing,
        description,
        severity: incomingRank < existingRank ? finding.severity : existing.severity,
      });

      continue;
    }

    deduped.set(key, finding);
  }

  return [...deduped.values()].sort((left, right) => {
    const leftRank = securityCveSeverityRank[left.severity];
    const rightRank = securityCveSeverityRank[right.severity];
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const idSort = left.id.localeCompare(right.id);
    if (idSort !== 0) {
      return idSort;
    }

    return left.component.localeCompare(right.component);
  });
};

const readLegacyAuditScore = (output: string): SecuritySeverityScore | null => {
  const payload = parseJsonPayloadFromMixedOutput(output) as {
    metadata?: {
      vulnerabilities?: {
        info?: number;
        low?: number;
        moderate?: number;
        high?: number;
        critical?: number;
        total?: number;
      };
    };
  } | null;

  const vulnerabilities = payload?.metadata?.vulnerabilities;
  if (!vulnerabilities) {
    return null;
  }

  return normalizeSecurityScore(vulnerabilities);
};

/** Produces a one-line security summary string from multi-component scan output or legacy npm audit output. */
export const parseAuditSummary = (output: string): string => {
  const securityScanPayload = readSecurityScanPayload(output);
  const aggregateScore = normalizeSecurityScore(securityScanPayload?.aggregate);
  const componentCount = Array.isArray(securityScanPayload?.components)
    ? securityScanPayload.components.length
    : 0;

  if (componentCount > 0) {
    return `Vulnerabilities across ${componentCount} components: total ${aggregateScore.total} (critical ${aggregateScore.critical}, high ${aggregateScore.high}, moderate ${aggregateScore.moderate}, low ${aggregateScore.low}, info ${aggregateScore.info})`;
  }

  const legacyScore = readLegacyAuditScore(output);
  if (!legacyScore) {
    return 'Security audit completed';
  }

  return `Vulnerabilities: total ${legacyScore.total} (critical ${legacyScore.critical}, high ${legacyScore.high}, moderate ${legacyScore.moderate}, low ${legacyScore.low}, info ${legacyScore.info})`;
};

/** Returns a set of severity-count highlight strings (e.g. "Critical: 0") for the security check card. */
export const parseSecurityHighlights = (output: string): string[] => {
  const securityScanPayload = readSecurityScanPayload(output);
  if (Array.isArray(securityScanPayload?.components) && securityScanPayload.components.length > 0) {
    const aggregate = normalizeSecurityScore(securityScanPayload.aggregate);
    return [
      `Critical: ${aggregate.critical}`,
      `High: ${aggregate.high}`,
      `Moderate: ${aggregate.moderate}`,
      `Low: ${aggregate.low}`,
      `Info: ${aggregate.info}`,
    ];
  }

  const legacyScore = readLegacyAuditScore(output);
  if (!legacyScore) {
    return [];
  }

  return [
    `Critical: ${legacyScore.critical}`,
    `High: ${legacyScore.high}`,
    `Moderate: ${legacyScore.moderate}`,
    `Low: ${legacyScore.low}`,
    `Info: ${legacyScore.info}`,
  ];
};

/** Parses multi-component Trivy/npm-audit scan output into per-component scores, CVE findings, and aggregate totals. */
export const parseSecurityMetadata = (output: string): Partial<DeveloperCheck> => {
  const securityScanPayload = readSecurityScanPayload(output);
  const payload = securityScanPayload ?? {};
  const sourceComponents = Array.isArray(payload.components) ? payload.components : [];

  const componentScores = sourceComponents
    .map((item): SecurityComponentScore | null => {
      if (typeof item !== 'object' || item === null) {
        return null;
      }

      const source = item as Record<string, unknown>;
      const component = readOptionalText(source.component);
      if (!component) {
        return null;
      }

      const scanner = readOptionalText(source.scanner) ?? 'unknown';
      const rawStatus = (readOptionalText(source.status) ?? 'ok').toLowerCase();
      const status: SecurityComponentScore['status'] =
        rawStatus === 'error' || rawStatus === 'skipped' ? rawStatus : 'ok';
      const score = normalizeSecurityScore(source);
      const cveFindings = normalizeSecurityCveFindings(source.cveFindings, component, scanner);
      const note =
        typeof source.note === 'string' && source.note.trim().length > 0
          ? source.note.trim()
          : undefined;

      return {
        component,
        scanner,
        status,
        note,
        cveFindings: cveFindings.length > 0 ? cveFindings : undefined,
        ...score,
      };
    })
    .filter((item): item is SecurityComponentScore => item !== null);

  const findingsFromComponents = componentScores.flatMap((item) => item.cveFindings ?? []);

  const findingsFromPayload = normalizeSecurityCveFindings(payload.cveFindings);
  const securityCveFindings =
    findingsFromPayload.length > 0
      ? findingsFromPayload
      : normalizeSecurityCveFindings(findingsFromComponents);

  const aggregateFromComponents = componentScores.reduce<SecuritySeverityScore>(
    (total, item) => addSecurityScores(total, item),
    zeroSecurityScore(),
  );
  const aggregateFromPayload = normalizeSecurityScore(payload.aggregate);
  const hasAggregatePayload = typeof payload.aggregate === 'object' && payload.aggregate !== null;
  const aggregate = hasAggregatePayload ? aggregateFromPayload : aggregateFromComponents;

  if (componentScores.length === 0 && !hasAggregatePayload && securityCveFindings.length === 0) {
    return {};
  }

  return {
    securityComponentScores: componentScores,
    securityAggregateScore: aggregate,
    securityCveFindings: securityCveFindings.length > 0 ? securityCveFindings : undefined,
  };
};

/** Extracts up to 3 failure highlight strings (failing test name, timeout/error message, trace path) from test output. */
export const parseTestHighlights = (output: string): string[] => {
  const clean = stripAnsi(output);
  const highlights: string[] = [];
  const hasFailure = /(^|\n)\s*(?:FAIL|✘)\b|\b\d+\s+failed\b|Test timeout|Error:/i.test(clean);

  if (!hasFailure) {
    return [];
  }

  const failingTestMatch = /([^\s]+\.(?:spec|test)\.[^\s:]+:\d+:\d+)\s+›\s+([^\n]+)/.exec(clean);
  if (failingTestMatch) {
    highlights.push(
      `Failing test: ${failingTestMatch[1] ?? 'unknown'} - ${(failingTestMatch[2] ?? 'unknown').trim()}`,
    );
  }

  const timeoutOrErrorMatch = /(Test timeout[^\n]*|Error:\s*[^\n]*)/.exec(clean);
  if (timeoutOrErrorMatch) {
    highlights.push((timeoutOrErrorMatch[1] ?? 'Error').trim());
  }

  const tracePathMatch = /(test-results\/[\w\-./]+\/trace\.zip)/.exec(clean);
  if (tracePathMatch) {
    highlights.push(`Trace: ${tracePathMatch[1] ?? 'not available'}`);
  }

  return highlights.slice(0, 3);
};

/** Returns a curried function that extracts test-type metadata (pass/fail counts and area label) from runner output. */
export const parseTestMetadata =
  (testType: 'unit' | 'integration' | 'e2e' | 'postgres', areaLabel: string) =>
  (output: string): Partial<DeveloperCheck> => {
    const metrics = parseTestMetrics(output);

    return {
      areaLabel,
      testType,
      passedFileCount: metrics?.passedFileCount,
      failedFileCount: metrics?.failedFileCount,
      totalFileCount: metrics?.totalFileCount,
      passedCount: metrics?.passed,
      failedCount: metrics?.failed,
      totalCount: metrics?.total,
    };
  };

// Matches vitest.config.ts's coverage.thresholds — keep these in sync.
const coverageThresholds: Record<CoverageBenchmarkKey, number> = {
  S: 75,
  B: 75,
  F: 75,
  L: 75,
};

/** Builds per-dimension coverage benchmark objects from check output or the coverage-summary JSON fallback. */
export const buildCoverageBenchmarks = (
  output: string,
  readCoverageSummaryMetrics: () => CoverageMetrics | null,
): CoverageBenchmark[] | undefined => {
  const metrics = parseCoverageMetrics(output) ?? readCoverageSummaryMetrics();
  if (!metrics) {
    return undefined;
  }

  const items: Array<{ key: CoverageBenchmarkKey; label: string; value: string }> = [
    { key: 'S', label: 'Statements', value: metrics.statements },
    { key: 'B', label: 'Branches', value: metrics.branches },
    { key: 'F', label: 'Functions', value: metrics.functions },
    { key: 'L', label: 'Lines', value: metrics.lines },
  ];

  return items.map((item) => {
    const threshold = coverageThresholds[item.key];
    const score = Number.parseFloat(item.value);

    return {
      key: item.key,
      label: item.label,
      value: item.value,
      threshold: String(threshold),
      meetsThreshold: Number.isFinite(score) && score >= threshold,
    };
  });
};

const parseJsonArrayFromMixedOutput = (output: string): unknown => {
  const jsonStart = output.indexOf('[');
  const jsonEnd = output.lastIndexOf(']');

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    return null;
  }

  try {
    return JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as unknown;
  } catch {
    return null;
  }
};

/**
 * Strips a known repo-root prefix from an absolute file path. Tries the caller-supplied
 * `repoRoot` first (correct in every runtime, including inside a container where the repo is
 * mounted at e.g. `/app` rather than a path containing "reconciliation-platform"), falling back
 * to a `/reconciliation-platform/` marker for callers that don't have `repoRoot` on hand.
 */
const relativizeFilePath = (filePath: string, repoRoot?: string): string => {
  if (repoRoot) {
    const normalizedRoot = repoRoot.endsWith('/') ? repoRoot : `${repoRoot}/`;
    if (filePath.startsWith(normalizedRoot)) {
      return filePath.slice(normalizedRoot.length);
    }
  }

  const repoMarker = '/reconciliation-platform/';
  const markerIndex = filePath.indexOf(repoMarker);
  return markerIndex === -1 ? filePath : filePath.slice(markerIndex + repoMarker.length);
};

/**
 * Extracts every test result (pass/fail/skip) from a Vitest JSON reporter file. Vitest's `json`
 * reporter is Jest-compatible: `{ testResults: [{ name: filePath, assertionResults: [{ title,
 * status, duration, failureMessages }] }] }`. Callers filter to the statuses they need — Unit/
 * Integration panels keep only failed+skipped, the Database panel keeps everything.
 */
export const parseVitestJsonTestItems = (jsonRaw: string, repoRoot?: string): TestItem[] => {
  let payload: unknown;
  try {
    payload = JSON.parse(jsonRaw);
  } catch {
    return [];
  }

  if (typeof payload !== 'object' || payload === null) {
    return [];
  }

  const testResults = (payload as { testResults?: unknown }).testResults;
  if (!Array.isArray(testResults)) {
    return [];
  }

  const items: TestItem[] = [];

  for (const fileResult of testResults) {
    if (typeof fileResult !== 'object' || fileResult === null) continue;
    const fileEntry = fileResult as Record<string, unknown>;
    const suite = relativizeFilePath(readOptionalText(fileEntry.name) ?? 'unknown suite', repoRoot);
    const assertionResults = fileEntry.assertionResults;
    if (!Array.isArray(assertionResults)) continue;

    for (const assertion of assertionResults) {
      if (typeof assertion !== 'object' || assertion === null) continue;
      const source = assertion as Record<string, unknown>;
      const rawStatus = readOptionalText(source.status)?.toLowerCase();
      const status: TestItem['status'] =
        rawStatus === 'failed' ? 'failed' : rawStatus === 'passed' ? 'passed' : 'skipped';
      const failureMessages = Array.isArray(source.failureMessages) ? source.failureMessages : [];
      const reason =
        status === 'failed' && failureMessages.length > 0
          ? clipText(String(failureMessages[0]), 220)
          : undefined;

      items.push({
        name: readOptionalText(source.fullName ?? source.title) ?? 'unnamed test',
        suite,
        status,
        reason,
        durationMs: typeof source.duration === 'number' ? source.duration : undefined,
      });
    }
  }

  return items;
};

const dbTestCategoryFromName = (name: string): DbTestItem['category'] => {
  const normalized = name.toLowerCase();
  if (normalized.includes('migrat') || normalized.includes('changelog')) return 'migration';
  if (
    normalized.includes('constraint') ||
    normalized.includes('fk') ||
    normalized.includes('check_')
  )
    return 'constraint';
  if (normalized.includes('seed')) return 'seed';
  if (
    normalized.includes('isolation') ||
    normalized.includes('deadlock') ||
    normalized.includes('lifecycle')
  )
    return 'behavior';
  return 'other';
};

/** Maps every Vitest postgres-suite test result into the Database tests panel's row shape. */
export const parseDbTestItems = (jsonRaw: string, repoRoot?: string): DbTestItem[] =>
  parseVitestJsonTestItems(jsonRaw, repoRoot)
    .filter((item) => item.status !== 'skipped')
    .map((item) => ({
      name: item.name,
      category: dbTestCategoryFromName(item.name),
      status: item.status === 'failed' ? 'failed' : 'passed',
      durationMs: item.durationMs,
      failureMessage: item.reason,
    }));

/**
 * Recursively walks a Playwright JSON reporter's nested `suites` tree, extracting one row per
 * spec. `ok: true` with more than one result means it eventually passed after retries (flaky).
 */
export const parsePlaywrightJsonSpecs = (jsonRaw: string): E2eSpecItem[] => {
  let payload: unknown;
  try {
    payload = JSON.parse(jsonRaw);
  } catch {
    return [];
  }

  if (typeof payload !== 'object' || payload === null) {
    return [];
  }

  const items: E2eSpecItem[] = [];

  const visitSuite = (suite: unknown, titlePrefix: string): void => {
    if (typeof suite !== 'object' || suite === null) return;
    const source = suite as Record<string, unknown>;
    const suiteTitle = readOptionalText(source.title);
    const prefix = suiteTitle
      ? `${titlePrefix}${titlePrefix ? ' › ' : ''}${suiteTitle}`
      : titlePrefix;

    const specs = Array.isArray(source.specs) ? source.specs : [];
    for (const spec of specs) {
      if (typeof spec !== 'object' || spec === null) continue;
      const specSource = spec as Record<string, unknown>;
      const tests = Array.isArray(specSource.tests) ? specSource.tests : [];
      const firstTest = tests[0];
      const results =
        typeof firstTest === 'object' &&
        firstTest !== null &&
        Array.isArray((firstTest as Record<string, unknown>).results)
          ? ((firstTest as Record<string, unknown>).results as unknown[])
          : [];
      const lastResult = results[results.length - 1];
      const lastResultSource =
        typeof lastResult === 'object' && lastResult !== null
          ? (lastResult as Record<string, unknown>)
          : {};
      const ok = specSource.ok === true;
      const retries = Math.max(0, results.length - 1);
      // A spec skipped by a serial-mode abort still gets one result entry with
      // status: 'skipped' — an empty results array only happens if nothing ran at all.
      // Check the actual result status rather than inferring from array length.
      const lastResultStatus = readOptionalText(lastResultSource.status);
      const status: E2eSpecItem['status'] =
        results.length === 0 || lastResultStatus === 'skipped'
          ? 'skipped'
          : !ok
            ? 'failed'
            : retries > 0
              ? 'flaky'
              : 'passed';
      const totalDurationMs = results.reduce((sum: number, result) => {
        const duration =
          typeof result === 'object' && result !== null
            ? (result as Record<string, unknown>).duration
            : 0;
        return sum + (typeof duration === 'number' ? duration : 0);
      }, 0);
      const attachments = Array.isArray(lastResultSource.attachments)
        ? lastResultSource.attachments
        : [];
      const traceAttachment = attachments.find(
        (attachment): attachment is Record<string, unknown> =>
          typeof attachment === 'object' &&
          attachment !== null &&
          readOptionalText((attachment as Record<string, unknown>).name) === 'trace',
      );
      const artifactPath = traceAttachment
        ? (readOptionalText(traceAttachment.path) ?? undefined)
        : undefined;

      items.push({
        name: `${prefix}${prefix ? ' › ' : ''}${readOptionalText(specSource.title) ?? 'unnamed spec'}`,
        status,
        durationMs: totalDurationMs,
        retries,
        artifactPath,
      });
    }

    const nestedSuites = Array.isArray(source.suites) ? source.suites : [];
    for (const nested of nestedSuites) {
      visitSuite(nested, prefix);
    }
  };

  const topSuites = (payload as { suites?: unknown }).suites;
  if (Array.isArray(topSuites)) {
    for (const suite of topSuites) {
      visitSuite(suite, '');
    }
  }

  return items;
};

/** Parses ESLint's `--format json` array output (one entry per file) into a flat list of issue rows. */
export const parseEslintJsonIssues = (output: string, repoRoot?: string): LintIssue[] => {
  const payload = parseJsonArrayFromMixedOutput(output);
  if (!Array.isArray(payload)) {
    return [];
  }

  const issues: LintIssue[] = [];
  const severityLabel: Record<number, LintIssue['severity']> = { 1: 'warning', 2: 'error' };

  for (const fileResult of payload) {
    if (typeof fileResult !== 'object' || fileResult === null) continue;
    const source = fileResult as Record<string, unknown>;
    const file = relativizeFilePath(readOptionalText(source.filePath) ?? 'unknown file', repoRoot);
    const messages = Array.isArray(source.messages) ? source.messages : [];

    for (const message of messages) {
      if (typeof message !== 'object' || message === null) continue;
      const messageSource = message as Record<string, unknown>;
      const severityValue = typeof messageSource.severity === 'number' ? messageSource.severity : 1;

      issues.push({
        rule: readOptionalText(messageSource.ruleId) ?? 'parse-error',
        severity: severityLabel[severityValue] ?? 'info',
        file,
        line: toNonNegativeInteger(messageSource.line),
        message: readOptionalText(messageSource.message) ?? 'No message provided.',
      });
    }
  }

  return issues;
};

/**
 * Reads every per-file entry from an Istanbul `coverage-summary.json` payload (the `"total"` key
 * is the aggregate and is skipped), flagging rows below the 75%-lines-per-file minimum.
 */
export const parseCoverageSummaryJson = (
  jsonRaw: string,
  repoRoot?: string,
): CoverageFileEntry[] => {
  let payload: unknown;
  try {
    payload = JSON.parse(jsonRaw);
  } catch {
    return [];
  }

  if (typeof payload !== 'object' || payload === null) {
    return [];
  }

  const entries: CoverageFileEntry[] = [];

  for (const [filePath, value] of Object.entries(payload as Record<string, unknown>)) {
    if (filePath === 'total' || typeof value !== 'object' || value === null) continue;
    const source = value as Record<string, unknown>;
    const pctOf = (key: string): number => {
      const dimension = source[key];
      const pct =
        typeof dimension === 'object' && dimension !== null
          ? (dimension as Record<string, unknown>).pct
          : undefined;
      return typeof pct === 'number' && Number.isFinite(pct) ? pct : 0;
    };
    const linesDimension = source.lines;
    const uncoveredLineCount =
      typeof linesDimension === 'object' && linesDimension !== null
        ? toNonNegativeInteger((linesDimension as Record<string, unknown>).total) -
          toNonNegativeInteger((linesDimension as Record<string, unknown>).covered)
        : 0;
    const lines = pctOf('lines');

    entries.push({
      filePath: relativizeFilePath(filePath, repoRoot),
      statements: pctOf('statements'),
      lines,
      branches: pctOf('branches'),
      functions: pctOf('functions'),
      uncoveredLineCount: Math.max(0, uncoveredLineCount),
      meetsMinimum: lines >= 75,
    });
  }

  return entries.sort((left, right) => left.lines - right.lines);
};
