/**
 * Runs the full quality-gate check suite and writes one DeveloperStatusPayload-shaped JSON file.
 * Meant to run inside GitHub Actions (scripts/ci workflow), never against a live dev/stage
 * deployment -- see issue_tracker for the incident that motivated moving execution here.
 *
 * Usage: tsx scripts/ci/generate-dashboard-status.ts --env dev --out dashboard-status/dev.json
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  buildCoverageBenchmarks,
  parseAuditSummary,
  parseCoverageMetrics,
  parseCoverageSummaryJson,
  parseDbTestItems,
  parseEslintJsonIssues,
  parsePlaywrightJsonSpecs,
  parseSecurityHighlights,
  parseSecurityMetadata,
  parseTestHighlights,
  parseTestMetadata,
  parseVitestJsonTestItems,
  summarizeLintOutput,
  summarizeTestOutput,
  summarizeTypecheckOutput,
  truncateOutput,
} from '../../apps/api/src/services/developerStatusParsing';
import type {
  CoverageMetrics,
  DeveloperCheck,
  DeveloperStatusPayload,
  RepoHealthKpis,
} from '../../apps/api/src/services/developerStatusTypes';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(__dirname, '..', '..');
const npmExecutable = 'npm';
const tempPath = join(repoRoot, '.dashboard-status-tmp');
const coverageSummaryPath = join(repoRoot, 'coverage', 'coverage-summary.json');

const args = process.argv.slice(2);
const readFlag = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? (args[index + 1] as string) : fallback;
};
const envName = readFlag('env', 'dev');
const outPath = resolve(repoRoot, readFlag('out', `dashboard-status/${envName}.json`));

mkdirSync(tempPath, { recursive: true });
mkdirSync(dirname(outPath), { recursive: true });

const formatCommand = (args: string[]): string => `${npmExecutable} ${args.join(' ')}`;

const readCoverageSummaryMetrics = (): CoverageMetrics | null => {
  if (!existsSync(coverageSummaryPath)) return null;
  try {
    const payload = JSON.parse(readFileSync(coverageSummaryPath, 'utf8')) as {
      total?: Record<string, { pct?: number }>;
    };
    const total = payload.total;
    if (!total) return null;
    const metrics = {
      statements: total.statements?.pct,
      branches: total.branches?.pct,
      functions: total.functions?.pct,
      lines: total.lines?.pct,
    };
    if (Object.values(metrics).some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
    return {
      statements: String(metrics.statements),
      branches: String(metrics.branches),
      functions: String(metrics.functions),
      lines: String(metrics.lines),
    };
  } catch {
    return null;
  }
};

const readCoverageFiles = () => {
  if (!existsSync(coverageSummaryPath)) return [];
  try {
    return parseCoverageSummaryJson(readFileSync(coverageSummaryPath, 'utf8'), repoRoot);
  } catch {
    return [];
  }
};

const readJsonReportFile = <T,>(path: string, parse: (raw: string) => T[]): T[] => {
  if (!existsSync(path)) return [];
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
};

/** Runs one check to completion. No timeout juggling, no background/deferred runs, no docker-
 *  sibling-mount fallback dance -- those all existed to work around the constrained local `tools`
 *  container this replaces. A GitHub Actions runner has real Docker and a real job timeout, so a
 *  hung check fails the job loudly instead of quietly wedging a long-lived server process. */
const runCheck = async (
  name: string,
  args: string[],
  summarize: (stdout: string, stderr: string) => string,
  extractHighlights?: (output: string) => string[],
  parseMetadata?: (output: string) => Partial<DeveloperCheck>,
  extraEnv?: Record<string, string>,
): Promise<DeveloperCheck> => {
  const started = Date.now();
  const command = formatCommand(args);
  try {
    const result = await execFileAsync(npmExecutable, args, {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      maxBuffer: 1024 * 1024 * 16,
    });
    const durationMs = Date.now() - started;
    const stdout = result.stdout?.toString() ?? '';
    const stderr = result.stderr?.toString() ?? '';
    const output = `${stdout}\n${stderr}`.trim();
    return {
      name,
      command,
      ok: true,
      exitCode: 0,
      durationMs,
      summary: summarize(stdout, stderr),
      details: truncateOutput(output),
      highlights: extractHighlights?.(output),
      ...(parseMetadata?.(output) ?? {}),
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    const stdout = failure.stdout ?? '';
    const stderr = failure.stderr ?? '';
    const output = `${stdout}\n${stderr}`.trim();
    return {
      name,
      command,
      ok: false,
      exitCode: failure.code ?? 1,
      durationMs,
      summary: summarize(stdout, stderr),
      details: truncateOutput(output),
      highlights: extractHighlights?.(output),
      ...(parseMetadata?.(output) ?? {}),
    };
  }
};

const readGitCommandOutput = async (gitArgs: string[]): Promise<string | null> => {
  try {
    const result = await execFileAsync('git', gitArgs, { cwd: repoRoot, timeout: 8000 });
    const value = result.stdout?.toString().trim() ?? '';
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

const collectRepoHealthKpis = async (
  overallStatus: RepoHealthKpis['overallStatus'],
  failedChecks: number,
  totalDurationMs: number,
  generatedAt: string,
): Promise<RepoHealthKpis> => {
  const [commitsThisWeekRaw, aheadBehindRaw, openPrRaw] = await Promise.all([
    readGitCommandOutput(['rev-list', '--count', '--since=7 days ago', 'HEAD']),
    readGitCommandOutput(['rev-list', '--left-right', '--count', 'origin/stage...origin/dev']),
    execFileAsync('gh', ['pr', 'list', '--state', 'open', '--json', 'number', '--jq', 'length'], {
      cwd: repoRoot,
      timeout: 8000,
    })
      .then((r) => r.stdout?.toString().trim() ?? null)
      .catch(() => null),
  ]);

  const commitsThisWeek = commitsThisWeekRaw ? Number.parseInt(commitsThisWeekRaw, 10) : null;
  const [aheadRaw, behindRaw] = (aheadBehindRaw ?? '').split(/\s+/u);
  const aheadCount = Number.parseInt(aheadRaw ?? '', 10);
  const behindCount = Number.parseInt(behindRaw ?? '', 10);
  const openPrCount = openPrRaw ? Number.parseInt(openPrRaw, 10) : null;

  return {
    overallStatus,
    failedChecks,
    lastCiRun: { status: overallStatus, durationMs: totalDurationMs, at: generatedAt },
    commitsThisWeek: Number.isFinite(commitsThisWeek) ? commitsThisWeek : null,
    branchFreshness: {
      remoteRef: 'origin/stage vs origin/dev',
      aheadCount: Number.isFinite(aheadCount) ? aheadCount : null,
      behindCount: Number.isFinite(behindCount) ? behindCount : null,
    },
    openPrCount: Number.isFinite(openPrCount as number) ? openPrCount : null,
  };
};

/** Branch sync + baseline-tag readiness, computed against a fresh CI checkout -- no risk of the
 *  "wedged local git state" class of problem a long-lived container can accumulate. */
const collectPromotionReadiness = async () => {
  const baselineTag = process.env.DEVELOPER_BASELINE_TAG?.trim() || 'stable-baseline-2026-05-14';
  const [headCommit, devCommit, stageCommit, mainCommit, baselineCommit] = await Promise.all([
    readGitCommandOutput(['rev-parse', '--short', 'HEAD']),
    readGitCommandOutput(['rev-parse', '--short', 'origin/dev']),
    readGitCommandOutput(['rev-parse', '--short', 'origin/stage']),
    readGitCommandOutput(['rev-parse', '--short', 'origin/main']),
    readGitCommandOutput(['rev-parse', '--short', `${baselineTag}^{}`]),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    baseline: {
      tagName: baselineTag,
      exists: baselineCommit !== null,
      commit: baselineCommit,
      matchesHead: baselineCommit && headCommit ? baselineCommit === headCommit : null,
    },
    environments: [
      { name: 'dev', targetRevision: devCommit },
      { name: 'stage', targetRevision: stageCommit },
      { name: 'main', targetRevision: mainCommit },
    ],
  };
};

const run = async (): Promise<void> => {
  const runStarted = Date.now();
  const generatedAt = new Date().toISOString();

  const unitJsonReportPath = join(tempPath, 'unit-results.json');
  const integrationJsonReportPath = join(tempPath, 'integration-results.json');
  const postgresJsonReportPath = join(tempPath, 'postgres-results.json');
  const lintJsonReportPath = join(tempPath, 'lint-results.json');
  const e2eJsonReportPath = join(tempPath, 'e2e-results.json');

  console.log(`[dashboard-status] env=${envName} generatedAt=${generatedAt}`);

  const unitTests = await runCheck(
    'Unit tests',
    ['run', 'test:unit', '--', '--reporter=default', '--reporter=json', `--outputFile.json=${unitJsonReportPath}`],
    (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
    parseTestHighlights,
    parseTestMetadata('unit', 'Unit'),
  );
  unitTests.testItems = readJsonReportFile(unitJsonReportPath, (raw) =>
    parseVitestJsonTestItems(raw, repoRoot),
  );
  console.log(`[dashboard-status] unit: ok=${unitTests.ok} (${unitTests.durationMs}ms)`);

  const integrationTests = await runCheck(
    'Integration tests',
    [
      'run',
      'test:integration:dashboard',
      '--',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${integrationJsonReportPath}`,
    ],
    (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
    parseTestHighlights,
    parseTestMetadata('integration', 'Integration'),
  );
  integrationTests.testItems = readJsonReportFile(integrationJsonReportPath, (raw) =>
    parseVitestJsonTestItems(raw, repoRoot),
  );
  console.log(
    `[dashboard-status] integration: ok=${integrationTests.ok} (${integrationTests.durationMs}ms)`,
  );

  const postgresTests = await runCheck(
    'Postgres DB tests',
    ['run', 'test:postgres', '--', '--reporter=json', `--outputFile.json=${postgresJsonReportPath}`],
    (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
    parseTestHighlights,
    parseTestMetadata('postgres', 'Postgres DB'),
  );
  postgresTests.dbTestItems = readJsonReportFile(postgresJsonReportPath, (raw) =>
    parseDbTestItems(raw, repoRoot),
  );
  console.log(`[dashboard-status] postgres: ok=${postgresTests.ok} (${postgresTests.durationMs}ms)`);

  const lint = await runCheck(
    'Static analysis (lint)',
    ['run', 'lint'],
    (stdout) => summarizeLintOutput(stdout),
    undefined,
    () => ({ areaLabel: 'Static analysis' }),
  );
  try {
    await execFileAsync(
      npmExecutable,
      ['run', 'lint', '--', '--format', 'json', '--output-file', lintJsonReportPath],
      { cwd: repoRoot, maxBuffer: 1024 * 1024 * 16 },
    );
  } catch {
    // ESLint exits non-zero when it finds issues even though --output-file was written fine.
  }
  lint.lintIssues = readJsonReportFile(lintJsonReportPath, (raw) =>
    parseEslintJsonIssues(raw, repoRoot),
  );
  console.log(`[dashboard-status] lint: ok=${lint.ok} (${lint.durationMs}ms)`);

  const typecheck = await runCheck(
    'Static analysis (typecheck)',
    ['run', 'typecheck'],
    () => summarizeTypecheckOutput(),
    undefined,
    () => ({ areaLabel: 'Static analysis' }),
  );
  console.log(`[dashboard-status] typecheck: ok=${typecheck.ok} (${typecheck.durationMs}ms)`);

  const summarizeCoverageOutput = (stdout: string): string => {
    const metrics = parseCoverageMetrics(stdout) ?? readCoverageSummaryMetrics();
    if (!metrics) return 'Coverage run completed';
    return `Coverage S/B/F/L: S ${metrics.statements}% | B ${metrics.branches}% | F ${metrics.functions}% | L ${metrics.lines}%`;
  };
  const parseCoverageHighlights = (output: string): string[] => {
    const metrics = parseCoverageMetrics(output) ?? readCoverageSummaryMetrics();
    if (!metrics) return [];
    return [
      `S: ${metrics.statements}%`,
      `B: ${metrics.branches}%`,
      `F: ${metrics.functions}%`,
      `L: ${metrics.lines}%`,
    ];
  };
  const coverage = await runCheck(
    'Coverage',
    ['run', 'coverage'],
    summarizeCoverageOutput,
    parseCoverageHighlights,
    (output) => ({
      areaLabel: 'Coverage',
      coverageBenchmarks: buildCoverageBenchmarks(output, readCoverageSummaryMetrics),
      coverageFiles: readCoverageFiles(),
    }),
  );
  console.log(`[dashboard-status] coverage: ok=${coverage.ok} (${coverage.durationMs}ms)`);

  const security = await runCheck(
    'Security vulnerabilities',
    ['run', 'security:scan:components', '--silent'],
    (stdout, stderr) => parseAuditSummary(stdout || stderr),
    parseSecurityHighlights,
    (output) => ({ areaLabel: 'Security', ...parseSecurityMetadata(output) }),
  );
  console.log(`[dashboard-status] security: ok=${security.ok} (${security.durationMs}ms)`);

  const e2e = await runCheck(
    'E2E tests',
    ['run', 'test:e2e', '--', '--reporter=list,json'],
    (stdout, stderr) => summarizeTestOutput(`${stdout}\n${stderr}`),
    parseTestHighlights,
    parseTestMetadata('e2e', 'E2E'),
    { PLAYWRIGHT_JSON_OUTPUT_NAME: e2eJsonReportPath },
  );
  e2e.e2eSpecs = readJsonReportFile(e2eJsonReportPath, parsePlaywrightJsonSpecs);
  console.log(`[dashboard-status] e2e: ok=${e2e.ok} (${e2e.durationMs}ms)`);

  const checks = [unitTests, integrationTests, postgresTests, lint, typecheck, coverage, security, e2e];
  const failedChecks = checks.filter((c) => !c.ok).length;
  const passedChecks = checks.length - failedChecks;
  const totalDurationMs = checks.reduce((sum, c) => sum + c.durationMs, 0);
  const overallStatus: 'healthy' | 'attention-needed' = failedChecks === 0 ? 'healthy' : 'attention-needed';

  const repoHealth = await collectRepoHealthKpis(overallStatus, failedChecks, totalDurationMs, generatedAt);
  const promotionReadiness = await collectPromotionReadiness();

  const testTotals = checks.reduce(
    (totals, check) => ({
      passed: totals.passed + (check.passedCount ?? 0),
      failed: totals.failed + (check.failedCount ?? 0),
      total: totals.total + (check.totalCount ?? 0),
    }),
    { passed: 0, failed: 0, total: 0 },
  );

  const payload: DeveloperStatusPayload & { environment: string; promotionReadiness: unknown } = {
    generatedAt,
    repositoryPath: repoRoot,
    overallStatus,
    failedChecks,
    passedChecks,
    totalChecks: checks.length,
    totalDurationMs,
    checks,
    history: [
      {
        generatedAt,
        overallStatus,
        failedChecks,
        totalChecks: checks.length,
        totalDurationMs,
        failingCheckNames: checks.filter((c) => !c.ok).map((c) => c.name),
        failingAreas: [...new Set(checks.filter((c) => !c.ok).map((c) => c.areaLabel ?? c.name))],
        testTotals: { ...testTotals, byType: [] },
        checks: checks.map((c) => ({ name: c.name, ok: c.ok, durationMs: c.durationMs, summary: c.summary })),
      },
    ],
    repoHealth,
    environment: envName,
    promotionReadiness,
  };

  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    `[dashboard-status] wrote ${outPath} — overallStatus=${overallStatus} (${failedChecks}/${checks.length} failed) in ${Date.now() - runStarted}ms`,
  );

  // Non-zero exit if anything failed, so the workflow run itself is visibly red in GitHub's UI --
  // the JSON still gets committed either way (see the workflow's `if: always()` publish step).
  if (failedChecks > 0) {
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error('[dashboard-status] fatal error', error);
  process.exitCode = 1;
});
