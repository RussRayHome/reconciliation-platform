/**
 * Combines the artifacts each parallel check job produced (a meta.json with name/command/exitCode
 * /durationMs, plus whatever raw report file that check type writes) into one
 * DeveloperStatusPayload-shaped JSON. Runs no checks itself -- pure parsing/assembly, reusing the
 * same functions the old in-app dashboard used, reading from files instead of live subprocess
 * output. See run-check.ts for why checks moved to separate jobs instead of running here.
 *
 * Usage: tsx scripts/ci/aggregate-dashboard-status.ts --env dev --artifacts .ci-artifacts --out dashboard-status/dev.json
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  buildCoverageBenchmarks,
  parseAuditSummary,
  parseCoverageSummaryJson,
  parseDbTestItems,
  parseEslintJsonIssues,
  parsePlaywrightJsonSpecs,
  parseSecurityHighlights,
  parseSecurityMetadata,
  parseVitestJsonTestItems,
  truncateOutput,
} from '../../apps/api/src/services/developerStatusParsing';
import type {
  CoverageMetrics,
  DeveloperCheck,
  DeveloperStatusPayload,
  RepoHealthKpis,
  TestItem,
} from '../../apps/api/src/services/developerStatusTypes';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd());

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown error';
  }
};

const args = process.argv.slice(2);
const readFlag = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? (args[index + 1] as string) : fallback;
};
const envName = readFlag('env', 'dev');
const artifactsDir = resolve(repoRoot, readFlag('artifacts', '.ci-artifacts'));
const outPath = resolve(repoRoot, readFlag('out', `dashboard-status/${envName}.json`));

mkdirSync(dirname(outPath), { recursive: true });

const readJson = <T,>(path: string): T | null => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

const readText = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

type CheckMeta = { name: string; command: string; exitCode: number; ok: boolean; durationMs: number };

/** Reads one check's meta.json (written by run-check.ts). A missing meta.json means that check's
 *  job never even got to the point of running the command (e.g. its own setup steps failed) --
 *  reported as a distinct, clearly-labeled failure rather than silently omitted from the payload. */
const readCheckMeta = (key: string, name: string): CheckMeta => {
  const meta = readJson<CheckMeta>(join(artifactsDir, key, 'meta.json'));
  if (meta) return meta;
  return {
    name,
    command: '(unknown -- job did not produce meta.json)',
    exitCode: 1,
    ok: false,
    durationMs: 0,
  };
};

const testCounts = (items: TestItem[]): { passed: number; failed: number; total: number } => ({
  passed: items.filter((i) => i.status === 'passed').length,
  failed: items.filter((i) => i.status === 'failed').length,
  total: items.length,
});

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
      .catch((error: unknown) => {
        console.log(`[aggregate-dashboard-status] gh pr list (openPrCount) failed: ${describeError(error)}`);
        return null;
      }),
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

type LastDevCommit = { sha: string; author: string; at: string; message: string };

/** Answers "when did dev last move, and by whom." Field separator (\x1f) rather than a delimiter
 *  character, since commit subjects can contain anything including pipes/colons/quotes. */
const collectLastDevCommit = async (): Promise<LastDevCommit | null> => {
  const raw = await readGitCommandOutput(['log', '-1', '--format=%H%x1f%an%x1f%cI%x1f%s', 'origin/dev']);
  if (!raw) return null;

  const [sha, author, at, ...messageParts] = raw.split('\x1f');
  if (!sha || !author || !at) return null;

  return { sha, author, at, message: messageParts.join('\x1f') };
};

type BranchStatus = {
  name: string;
  /** Commits this branch has that dev doesn't -- i.e. genuinely outstanding, not yet merged. */
  aheadOfDev: number;
  /** Commits dev has that this branch doesn't -- how stale the branch is relative to dev. */
  behindDev: number;
  lastCommitAt: string | null;
  pullRequest: { number: number; title: string; url: string } | null;
};

/** These aren't "branches with outstanding work" -- dev/stage/main are the trunk lines being
 *  compared against, status-data is the publish target for this very pipeline, not application code. */
const NON_FEATURE_BRANCHES = new Set(['dev', 'stage', 'main', 'status-data', 'HEAD']);

/** Every remote branch with commits dev doesn't have yet, each cross-referenced against open PRs --
 *  this is the closest honest answer to "what's outstanding and not checked into dev," since a
 *  CI checkout can only ever see what reached GitHub, never truly-local uncommitted work. */
const collectBranchesPanel = async (): Promise<BranchStatus[]> => {
  const branchListRaw = await readGitCommandOutput([
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/remotes/origin',
  ]);
  const branchNames = (branchListRaw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('origin/'))
    .map((line) => line.slice('origin/'.length))
    .filter((name) => name.length > 0 && !NON_FEATURE_BRANCHES.has(name));

  const openPrs = await execFileAsync('gh', [
    'pr',
    'list',
    '--state',
    'open',
    '--json',
    'number,title,url,headRefName',
  ], { cwd: repoRoot, timeout: 8000 })
    .then(
      (result) =>
        JSON.parse(result.stdout?.toString() ?? '[]') as Array<{
          number: number;
          title: string;
          url: string;
          headRefName: string;
        }>,
    )
    .catch((error: unknown) => {
      console.log(`[aggregate-dashboard-status] gh pr list (branches panel) failed: ${describeError(error)}`);
      return [];
    });
  const prByBranch = new Map(openPrs.map((pr) => [pr.headRefName, pr]));

  const branches = await Promise.all(
    branchNames.map(async (name): Promise<BranchStatus | null> => {
      const counts = await readGitCommandOutput([
        'rev-list',
        '--left-right',
        '--count',
        `origin/dev...origin/${name}`,
      ]);
      const [behindRaw, aheadRaw] = (counts ?? '').split(/\s+/u);
      const aheadOfDev = Number.parseInt(aheadRaw ?? '', 10);
      const behindDev = Number.parseInt(behindRaw ?? '', 10);

      // Fully merged into dev already (0 unique commits) -- nothing outstanding, skip it.
      if (!Number.isFinite(aheadOfDev) || aheadOfDev === 0) {
        return null;
      }

      const lastCommitAt = await readGitCommandOutput(['log', '-1', '--format=%cI', `origin/${name}`]);
      const pr = prByBranch.get(name);

      return {
        name,
        aheadOfDev,
        behindDev: Number.isFinite(behindDev) ? behindDev : 0,
        lastCommitAt,
        pullRequest: pr ? { number: pr.number, title: pr.title, url: pr.url } : null,
      };
    }),
  );

  const outstanding = branches.filter((branch): branch is BranchStatus => branch !== null);
  outstanding.sort((a, b) => b.aheadOfDev - a.aheadOfDev);

  // No silent truncation: log what's dropped rather than let a long tail quietly disappear.
  const BRANCH_PANEL_CAP = 20;
  if (outstanding.length > BRANCH_PANEL_CAP) {
    console.log(
      `[aggregate-dashboard-status] branches panel: showing top ${BRANCH_PANEL_CAP} of ${outstanding.length} branches with outstanding commits`,
    );
  }

  return outstanding.slice(0, BRANCH_PANEL_CAP);
};

const run = async (): Promise<void> => {
  const generatedAt = new Date().toISOString();
  console.log(`[aggregate-dashboard-status] env=${envName} artifacts=${artifactsDir}`);

  // --- Unit tests ---
  const unitMeta = readCheckMeta('unit', 'Unit tests');
  const unitItems = readText(join(artifactsDir, 'unit', 'unit-results.json'));
  const unitTestItems = unitItems ? parseVitestJsonTestItems(unitItems, repoRoot) : [];
  const unitCounts = testCounts(unitTestItems);
  const unitTests: DeveloperCheck = {
    name: unitMeta.name,
    command: unitMeta.command,
    ok: unitMeta.ok,
    exitCode: unitMeta.exitCode,
    durationMs: unitMeta.durationMs,
    summary: `Passed: ${unitCounts.passed}, Failed: ${unitCounts.failed}`,
    details: unitMeta.ok ? 'See job log for full output.' : 'Check failed -- see job log for full output.',
    areaLabel: 'Unit',
    testType: 'unit',
    passedCount: unitCounts.passed,
    failedCount: unitCounts.failed,
    totalCount: unitCounts.total,
    testItems: unitTestItems,
  };

  // --- Integration tests ---
  const integrationMeta = readCheckMeta('integration', 'Integration tests');
  const integrationItemsRaw = readText(join(artifactsDir, 'integration', 'integration-results.json'));
  const integrationTestItems = integrationItemsRaw
    ? parseVitestJsonTestItems(integrationItemsRaw, repoRoot)
    : [];
  const integrationCounts = testCounts(integrationTestItems);
  const integrationTests: DeveloperCheck = {
    name: integrationMeta.name,
    command: integrationMeta.command,
    ok: integrationMeta.ok,
    exitCode: integrationMeta.exitCode,
    durationMs: integrationMeta.durationMs,
    summary: `Passed: ${integrationCounts.passed}, Failed: ${integrationCounts.failed}`,
    details: integrationMeta.ok
      ? 'See job log for full output.'
      : 'Check failed -- see job log for full output.',
    areaLabel: 'Integration',
    testType: 'integration',
    passedCount: integrationCounts.passed,
    failedCount: integrationCounts.failed,
    totalCount: integrationCounts.total,
    testItems: integrationTestItems,
  };

  // --- Postgres DB tests ---
  const postgresMeta = readCheckMeta('postgres', 'Postgres DB tests');
  const postgresItemsRaw = readText(join(artifactsDir, 'postgres', 'postgres-results.json'));
  const dbTestItems = postgresItemsRaw ? parseDbTestItems(postgresItemsRaw, repoRoot) : [];
  const postgresPassed = dbTestItems.filter((i) => i.status === 'passed').length;
  const postgresFailed = dbTestItems.filter((i) => i.status === 'failed').length;
  const postgresTests: DeveloperCheck = {
    name: postgresMeta.name,
    command: postgresMeta.command,
    ok: postgresMeta.ok,
    exitCode: postgresMeta.exitCode,
    durationMs: postgresMeta.durationMs,
    summary: `Passed: ${postgresPassed}, Failed: ${postgresFailed}`,
    details: postgresMeta.ok
      ? 'See job log for full output.'
      : 'Check failed -- see job log for full output.',
    areaLabel: 'Postgres DB',
    testType: 'postgres',
    passedCount: postgresPassed,
    failedCount: postgresFailed,
    totalCount: dbTestItems.length,
    dbTestItems,
  };

  // --- Lint ---
  const lintMeta = readCheckMeta('lint', 'Static analysis (lint)');
  const lintJsonRaw = readText(join(artifactsDir, 'lint', 'lint-results.json'));
  const lintIssues = lintJsonRaw ? parseEslintJsonIssues(lintJsonRaw, repoRoot) : [];
  const lint: DeveloperCheck = {
    name: lintMeta.name,
    command: lintMeta.command,
    ok: lintMeta.ok,
    exitCode: lintMeta.exitCode,
    durationMs: lintMeta.durationMs,
    summary: lintMeta.ok ? 'No lint problems' : `${lintIssues.length} lint issue(s) found`,
    details: lintMeta.ok ? 'See job log for full output.' : 'Check failed -- see job log for full output.',
    areaLabel: 'Static analysis',
    lintIssues,
  };

  // --- Typecheck ---
  const typecheckMeta = readCheckMeta('typecheck', 'Static analysis (typecheck)');
  const typecheck: DeveloperCheck = {
    name: typecheckMeta.name,
    command: typecheckMeta.command,
    ok: typecheckMeta.ok,
    exitCode: typecheckMeta.exitCode,
    durationMs: typecheckMeta.durationMs,
    summary: typecheckMeta.ok ? 'No type errors' : 'Type errors found',
    details: typecheckMeta.ok ? 'See job log for full output.' : 'Check failed -- see job log for full output.',
    areaLabel: 'Static analysis',
  };

  // --- Coverage ---
  const coverageMeta = readCheckMeta('coverage', 'Coverage');
  const coverageSummaryPath = join(artifactsDir, 'coverage', 'coverage-summary.json');
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
  const coverageMetrics = readCoverageSummaryMetrics();
  const coverageFiles = existsSync(coverageSummaryPath)
    ? parseCoverageSummaryJson(readFileSync(coverageSummaryPath, 'utf8'), repoRoot)
    : [];
  const coverage: DeveloperCheck = {
    name: coverageMeta.name,
    command: coverageMeta.command,
    ok: coverageMeta.ok,
    exitCode: coverageMeta.exitCode,
    durationMs: coverageMeta.durationMs,
    summary: coverageMetrics
      ? `Coverage S/B/F/L: S ${coverageMetrics.statements}% | B ${coverageMetrics.branches}% | F ${coverageMetrics.functions}% | L ${coverageMetrics.lines}%`
      : 'Coverage run completed',
    details: coverageMeta.ok ? 'See job log for full output.' : 'Check failed -- see job log for full output.',
    areaLabel: 'Coverage',
    coverageBenchmarks: coverageMetrics
      ? buildCoverageBenchmarks('', () => coverageMetrics)
      : undefined,
    coverageFiles,
  };

  // --- Security ---
  const securityMeta = readCheckMeta('security', 'Security vulnerabilities');
  const securityOutput = readText(join(artifactsDir, 'security', 'security-output.txt')) ?? '';
  const security: DeveloperCheck = {
    name: securityMeta.name,
    command: securityMeta.command,
    ok: securityMeta.ok,
    exitCode: securityMeta.exitCode,
    durationMs: securityMeta.durationMs,
    summary: parseAuditSummary(securityOutput),
    details: truncateOutput(securityOutput),
    highlights: parseSecurityHighlights(securityOutput),
    areaLabel: 'Security',
    ...parseSecurityMetadata(securityOutput),
  };

  // --- E2E ---
  const e2eMeta = readCheckMeta('e2e', 'E2E tests');
  const e2eJsonRaw = readText(join(artifactsDir, 'e2e', 'e2e-results.json'));
  const e2eSpecs = e2eJsonRaw ? parsePlaywrightJsonSpecs(e2eJsonRaw) : [];
  const e2ePassed = e2eSpecs.filter((s) => s.status === 'passed').length;
  const e2eFailed = e2eSpecs.filter((s) => s.status === 'failed').length;
  const e2e: DeveloperCheck = {
    name: e2eMeta.name,
    command: e2eMeta.command,
    ok: e2eMeta.ok,
    exitCode: e2eMeta.exitCode,
    durationMs: e2eMeta.durationMs,
    summary: `Passed: ${e2ePassed}, Failed: ${e2eFailed}`,
    details: e2eMeta.ok ? 'See job log for full output.' : 'Check failed -- see job log for full output.',
    areaLabel: 'E2E',
    testType: 'e2e',
    passedCount: e2ePassed,
    failedCount: e2eFailed,
    totalCount: e2eSpecs.length,
    e2eSpecs,
  };

  const checks = [unitTests, integrationTests, postgresTests, lint, typecheck, coverage, security, e2e];
  const failedChecks = checks.filter((c) => !c.ok).length;
  const passedChecks = checks.length - failedChecks;
  const totalDurationMs = checks.reduce((sum, c) => sum + c.durationMs, 0);
  const overallStatus: 'healthy' | 'attention-needed' = failedChecks === 0 ? 'healthy' : 'attention-needed';

  for (const check of checks) {
    console.log(`[aggregate-dashboard-status] ${check.name}: ok=${check.ok} (${check.durationMs}ms)`);
  }

  const [repoHealth, promotionReadiness, lastDevCommit, branches] = await Promise.all([
    collectRepoHealthKpis(overallStatus, failedChecks, totalDurationMs, generatedAt),
    collectPromotionReadiness(),
    collectLastDevCommit(),
    collectBranchesPanel(),
  ]);

  const testTotals = checks.reduce(
    (totals, check) => ({
      passed: totals.passed + (check.passedCount ?? 0),
      failed: totals.failed + (check.failedCount ?? 0),
      total: totals.total + (check.totalCount ?? 0),
    }),
    { passed: 0, failed: 0, total: 0 },
  );

  const payload: DeveloperStatusPayload & {
    environment: string;
    promotionReadiness: unknown;
    lastDevCommit: LastDevCommit | null;
    branches: BranchStatus[];
  } = {
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
    lastDevCommit,
    branches,
  };

  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    `[aggregate-dashboard-status] wrote ${outPath} — overallStatus=${overallStatus} (${failedChecks}/${checks.length} failed)`,
  );
};

run().catch((error) => {
  console.error('[aggregate-dashboard-status] fatal error', error);
  process.exitCode = 1;
});
