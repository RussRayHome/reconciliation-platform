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
  countComplexityMethods,
  parseAuditSummary,
  parseComplexityScan,
  parseCoverageSummaryJson,
  parseDbTestItems,
  parseEslintJsonIssues,
  parsePlaywrightJsonSpecs,
  parseSecretMetadata,
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

// --- Repository Status screen (/repo) ---
// Per the design handoff (2026-08-05): repo/branch health is a genuinely different question from
// "did the quality-gate checks pass," and computing a verdict for it independently in the UI is
// exactly how the old RepoHealthBand ended up contradicting the checks-suite verdict (header pill
// said Failing, the Overall tile said Healthy -- two independent computations of the same idea).
// This verdict is about promotion/branch hygiene, computed once, here, server-side.

const STALE_BRANCH_DAYS = 14;
const STAGE_ATTENTION_THRESHOLD = 10;

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

const resolveRepoSlug = async (): Promise<string> => {
  const envSlug = process.env.GITHUB_REPOSITORY?.trim();
  if (envSlug) return envSlug;

  const remote = await readGitCommandOutput(['remote', 'get-url', 'origin']);
  if (!remote) return 'unknown/unknown';

  const match = /[:/]([^/]+\/[^/]+?)(\.git)?$/u.exec(remote);
  return match?.[1] ?? 'unknown/unknown';
};

/** dev always shows its real CI result (this very pipeline run). stage/prod don't get faked data --
 *  dashboard-status.yml only runs against dev today (see the workflow's own TARGET_BRANCH comment),
 *  so their `ci` is honestly null until that's extended, per the design doc's "never hand-authored"
 *  and "degrade per section" rules. */
const collectEnvironments = async (
  devCiOk: boolean,
  devCiDurationMs: number,
): Promise<RepoStatusEnvironment[]> => {
  const defs: Array<{ name: RepoStatusEnvironment['name']; branch: string }> = [
    { name: 'dev', branch: 'dev' },
    { name: 'stage', branch: 'stage' },
    { name: 'prod', branch: 'main' },
  ];

  return Promise.all(
    defs.map(async ({ name, branch }): Promise<RepoStatusEnvironment> => {
      const isCurrent = name === 'dev';
      const [sha, deployedAt, behindRaw] = await Promise.all([
        readGitCommandOutput(['rev-parse', '--short', `origin/${branch}`]),
        readGitCommandOutput(['log', '-1', '--format=%cI', `origin/${branch}`]),
        isCurrent
          ? Promise.resolve('0')
          : readGitCommandOutput(['rev-list', '--count', `origin/${branch}..origin/dev`]),
      ]);
      const behindCount = behindRaw !== null ? Number.parseInt(behindRaw, 10) : null;
      const behindKnown = behindCount !== null && Number.isFinite(behindCount);

      const driftLabel = isCurrent || (behindKnown && behindCount === 0) ? 'In sync' : behindKnown ? `${behindCount} behind` : 'Unknown';
      const driftNote = isCurrent
        ? 'Integration target'
        : behindKnown && behindCount > 0
          ? `${behindCount} commit${behindCount === 1 ? '' : 's'} on dev not yet promoted`
          : behindKnown
            ? 'Up to date with dev'
            : 'Unable to compare with dev';

      return {
        name,
        branch,
        isCurrent,
        sha,
        deployedAt,
        behindCount,
        driftLabel,
        driftNote,
        ci: isCurrent ? { status: devCiOk ? 'pass' : 'fail', durationMs: devCiDurationMs } : null,
      };
    }),
  );
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

type OpenPrDetail = {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  author?: { login?: string; is_bot?: boolean };
  reviewDecision?: string;
  reviewRequests?: Array<{ login?: string; name?: string }>;
  statusCheckRollup?: Array<{ name?: string; conclusion?: string }>;
};

const deriveBranchState = (params: {
  hasPr: boolean;
  checksStatus: RepoStatusBranch['checksStatus'];
  failingChecks: string[];
  reviewDecision: string;
  reviewRequests: string[];
  behindDev: number;
  lastCommitAt: string | null;
  now: number;
}): Pick<RepoStatusBranch, 'state' | 'nextAction' | 'actionDetail'> => {
  const ageDays = params.lastCommitAt
    ? (params.now - new Date(params.lastCommitAt).valueOf()) / 86_400_000
    : Number.POSITIVE_INFINITY;

  if (!params.hasPr) {
    return ageDays >= STALE_BRANCH_DAYS
      ? { state: 'stale', nextAction: 'Rebase or close', actionDetail: 'no pull request opened' }
      : { state: 'stale', nextAction: 'Open a pull request', actionDetail: 'no pull request opened yet' };
  }

  if (params.checksStatus === 'failing') {
    return {
      state: 'blocked',
      nextAction: 'Fix failing checks',
      actionDetail: params.failingChecks.join(' · ') || 'checks failing',
    };
  }

  if (params.reviewDecision === 'APPROVED') {
    return {
      state: 'ready',
      nextAction: 'Ready to merge',
      actionDetail: params.behindDev > 0 ? 'approved · rebase first' : 'approved',
    };
  }

  if (ageDays >= STALE_BRANCH_DAYS) {
    return {
      state: 'stale',
      nextAction: 'Decide: keep or drop',
      actionDetail: `no activity in ${Math.floor(ageDays)} days`,
    };
  }

  return {
    state: 'review',
    nextAction: 'Awaiting review',
    actionDetail:
      params.reviewRequests.length > 0
        ? `requested from ${params.reviewRequests.join(', ')}`
        : 'no reviewer requested yet',
  };
};

const BRANCH_STATE_RANK: Record<RepoStatusBranch['state'], number> = {
  blocked: 0,
  review: 1,
  ready: 2,
  stale: 3,
};

/** Every remote branch with commits dev doesn't have yet, with state/nextAction derived server-side
 *  (per the design doc: this is policy, and belongs in the payload, not the component) from a
 *  single `gh pr list` call carrying review decision + check rollup -- no N+1 `gh pr view` calls. */
const collectRepoStatusBranches = async (): Promise<RepoStatusBranch[]> => {
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
    'number,title,url,headRefName,author,reviewDecision,statusCheckRollup,reviewRequests',
  ], { cwd: repoRoot, timeout: 8000 })
    .then((result) => JSON.parse(result.stdout?.toString() ?? '[]') as OpenPrDetail[])
    .catch((error: unknown) => {
      console.log(`[aggregate-dashboard-status] gh pr list (repo status branches) failed: ${describeError(error)}`);
      return [];
    });
  const prByBranch = new Map(openPrs.map((pr) => [pr.headRefName, pr]));

  const now = Date.now();

  const branches = await Promise.all(
    branchNames.map(async (name): Promise<RepoStatusBranch | null> => {
      const counts = await readGitCommandOutput([
        'rev-list',
        '--left-right',
        '--count',
        `origin/dev...origin/${name}`,
      ]);
      const [behindRaw, aheadRaw] = (counts ?? '').split(/\s+/u);
      const aheadOfDev = Number.parseInt(aheadRaw ?? '', 10);
      const behindDev = Number.parseInt(behindRaw ?? '', 10);

      if (!Number.isFinite(aheadOfDev) || aheadOfDev === 0) {
        return null;
      }

      const headInfo = await readGitCommandOutput(['log', '-1', '--format=%an%x1f%cI%x1f%s', `origin/${name}`]);
      const [author, lastCommitAt, ...subjectParts] = (headInfo ?? '').split('\x1f');

      const pr = prByBranch.get(name);
      const isBot = pr ? Boolean(pr.author?.is_bot) : /(^|[/-])bot([/-]|$)|dependabot/i.test(name);

      const checkRuns = pr?.statusCheckRollup ?? [];
      const failingChecks = checkRuns
        .filter((c) => c.conclusion === 'FAILURE')
        .map((c) => c.name)
        .filter((n): n is string => Boolean(n));
      const checksStatus: RepoStatusBranch['checksStatus'] =
        checkRuns.length === 0 ? 'not-run' : failingChecks.length > 0 ? 'failing' : 'passing';

      const derived = deriveBranchState({
        hasPr: Boolean(pr),
        checksStatus,
        failingChecks,
        reviewDecision: pr?.reviewDecision ?? '',
        reviewRequests: (pr?.reviewRequests ?? []).map((r) => r.login ?? r.name ?? '').filter(Boolean),
        behindDev: Number.isFinite(behindDev) ? behindDev : 0,
        lastCommitAt: lastCommitAt || null,
        now,
      });

      return {
        name,
        subject: subjectParts.join('\x1f') || '(no subject)',
        author: author || 'unknown',
        isBot,
        aheadOfDev,
        behindDev: Number.isFinite(behindDev) ? behindDev : 0,
        checksStatus,
        failingChecks,
        lastCommitAt: lastCommitAt || null,
        pullRequest: pr ? { number: pr.number, title: pr.title, url: pr.url } : null,
        ...derived,
      };
    }),
  );

  return branches
    .filter((branch): branch is RepoStatusBranch => branch !== null)
    .sort((a, b) => BRANCH_STATE_RANK[a.state] - BRANCH_STATE_RANK[b.state]);
};

type RepoStatusCommit = { sha: string; author: string; committedAt: string; subject: string };

const collectRecentDevCommits = async (limit: number): Promise<RepoStatusCommit[]> => {
  const raw = await readGitCommandOutput(['log', `-${limit}`, '--format=%h%x1f%an%x1f%cI%x1f%s', 'origin/dev']);
  if (!raw) return [];

  return raw.split('\n').map((line) => {
    const [sha, author, committedAt, ...subjectParts] = line.split('\x1f');
    return {
      sha: sha ?? '',
      author: author ?? '',
      committedAt: committedAt ?? '',
      subject: subjectParts.join('\x1f'),
    };
  });
};

const COMMIT_ACTIVITY_WINDOW_DAYS = 14;

/** One bucket per UTC day, oldest first, zero-filled -- the design doc calls out that gaps
 *  (weekends, stalls) are themselves signal, so a missing day must render as a visible 0, not
 *  disappear from the array. */
const collectCommitActivity = async (): Promise<Array<{ date: string; count: number }>> => {
  const raw = await readGitCommandOutput([
    'log',
    `--since=${COMMIT_ACTIVITY_WINDOW_DAYS} days ago`,
    '--format=%cI',
    'origin/dev',
  ]);
  const counts = new Map<string, number>();
  for (const line of (raw ?? '').split('\n')) {
    const date = line.slice(0, 10);
    if (!date) continue;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  const days: Array<{ date: string; count: number }> = [];
  const today = new Date();
  for (let i = COMMIT_ACTIVITY_WINDOW_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, count: counts.get(key) ?? 0 });
  }

  return days;
};

const formatDaysAgo = (iso: string | null): string => {
  if (!iso) return 'at an unknown time';
  const days = Math.floor((Date.now() - new Date(iso).valueOf()) / 86_400_000);
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

type RepoStatusDecision = { kind: string; tone: 'amber' | 'crimson' | 'blue'; title: string; detail: string };

const DECISION_CAP = 4;

/** Every card here is generated from the same branches/environments data the rest of the screen
 *  renders -- never hand-authored, per the design doc. */
const buildDecisions = async (
  branches: RepoStatusBranch[],
  stageEnv: RepoStatusEnvironment | undefined,
): Promise<RepoStatusDecision[]> => {
  const decisions: RepoStatusDecision[] = [];

  if (stageEnv && (stageEnv.behindCount ?? 0) > STAGE_ATTENTION_THRESHOLD) {
    const mergeBase = await readGitCommandOutput(['merge-base', 'origin/dev', 'origin/stage']);
    const mergeBaseDate = mergeBase ? await readGitCommandOutput(['log', '-1', '--format=%cI', mergeBase]) : null;
    const days = mergeBaseDate
      ? Math.max(0, Math.floor((Date.now() - new Date(mergeBaseDate).valueOf()) / 86_400_000))
      : null;

    decisions.push({
      kind: 'Promotion overdue',
      tone: 'amber',
      title: `stage has been ${stageEnv.behindCount} commits behind dev${days ? ` for ${days} day${days === 1 ? '' : 's'}` : ''}`,
      detail: 'Work is merged to dev but untested on stage. Promote, or say why not.',
    });
  }

  for (const branch of branches.filter((b) => b.state === 'blocked')) {
    decisions.push({
      kind: 'Blocked branch',
      tone: 'crimson',
      title: `${branch.name} has ${branch.failingChecks.length} failing check${branch.failingChecks.length === 1 ? '' : 's'}`,
      detail: `${branch.failingChecks.join(' and ') || 'Checks'} fail${branch.failingChecks.length === 1 ? 's' : ''}. This can't merge until they pass.`,
    });
  }

  for (const branch of branches.filter((b) => b.state === 'stale' && !b.pullRequest)) {
    decisions.push({
      kind: branch.isBot ? 'Stale bot branch' : 'Stale branch',
      tone: 'blue',
      title: `${branch.name} is ${branch.behindDev} behind with no PR`,
      detail: `Last commit ${formatDaysAgo(branch.lastCommitAt)}. Rebase and open a PR, or close it.`,
    });
  }

  return decisions.slice(0, DECISION_CAP);
};

type RepoStatusPayload = {
  verdict: 'healthy' | 'attention' | 'blocked';
  repo: { slug: string; defaultBranch: string; refreshedAt: string };
  environments: RepoStatusEnvironment[];
  branches: RepoStatusBranch[];
  commits: RepoStatusCommit[];
  commitActivity: Array<{ date: string; count: number }>;
  decisions: RepoStatusDecision[];
};

/** Per the design doc's verdict table: Blocked if any open branch has failing checks or dev's own
 *  CI run failed; Attention if no failures but a stale branch exists or stage is more than
 *  STAGE_ATTENTION_THRESHOLD commits behind dev; Healthy otherwise. Computed exactly once, here --
 *  the component must never re-derive it. */
const collectRepoStatus = async (devCiOk: boolean, devCiDurationMs: number): Promise<RepoStatusPayload> => {
  const [environments, branches, commits, commitActivity, repoSlug] = await Promise.all([
    collectEnvironments(devCiOk, devCiDurationMs),
    collectRepoStatusBranches(),
    collectRecentDevCommits(4),
    collectCommitActivity(),
    resolveRepoSlug(),
  ]);

  const anyBlocked = branches.some((b) => b.state === 'blocked');
  const anyStale = branches.some((b) => b.state === 'stale');
  const stageEnv = environments.find((e) => e.name === 'stage');
  const stageOverdue = (stageEnv?.behindCount ?? 0) > STAGE_ATTENTION_THRESHOLD;

  const verdict: RepoStatusPayload['verdict'] =
    anyBlocked || !devCiOk ? 'blocked' : anyStale || stageOverdue ? 'attention' : 'healthy';

  const decisions = await buildDecisions(branches, stageEnv);

  return {
    verdict,
    repo: { slug: repoSlug, defaultBranch: 'dev', refreshedAt: new Date().toISOString() },
    environments,
    branches,
    commits,
    commitActivity,
    decisions,
  };
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

  // --- Complexity ---
  const complexityMeta = readCheckMeta('complexity', 'Complexity');
  const complexityScanRaw = readText(join(artifactsDir, 'complexity', 'scan.json'));
  const complexityScan = complexityScanRaw ? parseComplexityScan(complexityScanRaw) : null;
  // Burn-in: `ok` is "did the scan itself run and parse", not "zero threshold violations" --
  // complexityMeta.ok/exitCode reflect the latter (escomplex-analysis.ts's own per-function gate,
  // same one `npm run analyze:complexity` has always enforced locally), and this check is brand
  // new with nobody having triaged the repo's existing violations yet. Once that triage happens
  // and the team wants this to gate for real, switch back to `ok: complexityMeta.ok` here AND
  // remove the matching `|| true` in dashboard-status.yml's complexity job at the same time --
  // otherwise a real scan crash would report ok:true from the meta.json fallback while this stays
  // silent about it.
  const complexity: DeveloperCheck = {
    name: complexityMeta.name,
    command: complexityMeta.command,
    ok: complexityScan !== null,
    exitCode: complexityMeta.exitCode,
    durationMs: complexityMeta.durationMs,
    summary: complexityScan
      ? `${countComplexityMethods(complexityScan.root)} methods analyzed${complexityMeta.ok ? '' : ' (threshold violations present -- informational during burn-in)'}`
      : 'Complexity scan unavailable for this run.',
    details:
      complexityScan !== null
        ? 'See job log for full output.'
        : 'Scan did not produce parseable output -- see job log.',
    areaLabel: 'Complexity',
    complexityScan: complexityScan ?? undefined,
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

  // --- Secret integrity ---
  const secretsMeta = readCheckMeta('secrets', 'Secret integrity');
  const secretsOutput = readText(join(artifactsDir, 'secrets', 'secret-scan-output.txt')) ?? '';
  const secretMetadata = parseSecretMetadata(secretsOutput);
  const secrets: DeveloperCheck = {
    name: secretsMeta.name,
    command: secretsMeta.command,
    ok: secretsMeta.ok,
    exitCode: secretsMeta.exitCode,
    durationMs: secretsMeta.durationMs,
    summary: secretMetadata.secretFindingsAggregate
      ? `Findings: ${secretMetadata.secretFindingsAggregate.total} (verified-live ${secretMetadata.secretFindingsAggregate.critical}, present-at-head ${secretMetadata.secretFindingsAggregate.high}, historical ${secretMetadata.secretFindingsAggregate.moderate})`
      : 'Secret scan completed',
    details: secretsMeta.ok ? 'See job log for full output.' : 'Check failed -- see job log for full output.',
    areaLabel: 'Secret integrity',
    ...secretMetadata,
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

  const checks = [
    unitTests,
    integrationTests,
    postgresTests,
    lint,
    typecheck,
    coverage,
    complexity,
    security,
    secrets,
    e2e,
  ];
  const failedChecks = checks.filter((c) => !c.ok).length;
  const passedChecks = checks.length - failedChecks;
  const totalDurationMs = checks.reduce((sum, c) => sum + c.durationMs, 0);
  const overallStatus: 'healthy' | 'attention-needed' = failedChecks === 0 ? 'healthy' : 'attention-needed';

  for (const check of checks) {
    console.log(`[aggregate-dashboard-status] ${check.name}: ok=${check.ok} (${check.durationMs}ms)`);
  }

  const [repoHealth, promotionReadiness, lastDevCommit, branches, repoStatus] = await Promise.all([
    collectRepoHealthKpis(overallStatus, failedChecks, totalDurationMs, generatedAt),
    collectPromotionReadiness(),
    collectLastDevCommit(),
    collectBranchesPanel(),
    collectRepoStatus(failedChecks === 0, totalDurationMs),
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
    repoStatus: RepoStatusPayload;
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
    repoStatus,
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
