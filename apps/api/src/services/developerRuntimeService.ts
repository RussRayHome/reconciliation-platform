import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  getRuntimeSummary,
  listExceptions,
  listFailedRequests,
  listReconciliationRuns,
  noteRequestSeen,
  recordException as recordRuntimeException,
  recordFailedRequest as recordRuntimeFailedRequest,
} from './runtimeDiagnostics';

const execFileAsync = promisify(execFile);
const defaultRemoteName = 'origin';
const defaultTrackingBranch = 'dev';
const defaultBaselineTagName =
  process.env.DEVELOPER_BASELINE_TAG?.trim() || 'stable-baseline-2026-05-14';

type RuntimeState = 'ready' | 'attention' | 'pending';

type LocalGitContext = {
  branch: string | null;
  commit: string | null;
  latestMessage: string | null;
  isDirty: boolean | null;
};

type PromotionSyncStatus = {
  remote: string;
  trackingBranch: string | null;
  remoteRef: string | null;
  localCommit: string | null;
  remoteCommit: string | null;
  aheadCount: number | null;
  behindCount: number | null;
  inSync: boolean | null;
};

type BaselineAnchorStatus = {
  tagName: string;
  exists: boolean;
  commit: string | null;
  matchesHead: boolean | null;
};

type PromotionEnvironmentStatus = {
  name: 'dev' | 'stage' | 'prod';
  runtime: 'Docker Compose' | 'AWS';
  sourceBranch: string | null;
  targetRevision: string | null;
  status: RuntimeState;
  note: string;
};

type PromotionReadiness = {
  sync: PromotionSyncStatus;
  baseline: BaselineAnchorStatus;
  overall: RuntimeState;
  summary: string;
  environments: PromotionEnvironmentStatus[];
  checkedAt: string;
};

type RuntimeFailedRequest = Parameters<typeof recordRuntimeFailedRequest>[0];
type RuntimeException = Parameters<typeof recordRuntimeException>[0];

type CreateDeveloperRuntimeServiceOptions = {
  repoRoot: string;
  gitExecutable?: string;
  gitContextTtlMs?: number;
};

const diagnosticsPathPrefix = '/api/developer';
const originHeadPattern = /^origin\/(.+)$/u;

const parseAheadBehindCounts = (
  value: string | null,
): { behindCount: number | null; aheadCount: number | null } => {
  if (!value) {
    return { behindCount: null, aheadCount: null };
  }

  const [behindRaw, aheadRaw] = value.split(/\s+/u);
  const behindCount = Number.parseInt(behindRaw ?? '', 10);
  const aheadCount = Number.parseInt(aheadRaw ?? '', 10);

  return {
    behindCount: Number.isFinite(behindCount) ? behindCount : null,
    aheadCount: Number.isFinite(aheadCount) ? aheadCount : null,
  };
};

const resolveSyncState = (
  localCommit: string | null,
  remoteCommit: string | null,
  aheadCount: number | null,
  behindCount: number | null,
): boolean | null => {
  if (aheadCount !== null && behindCount !== null) {
    return aheadCount === 0 && behindCount === 0;
  }

  if (!localCommit || !remoteCommit) {
    return null;
  }

  return localCommit === remoteCommit;
};

const resolveOverallReadiness = (
  sync: PromotionSyncStatus,
  baseline: BaselineAnchorStatus,
  stageStatus: RuntimeState,
  isDirty: boolean | null,
): RuntimeState => {
  if (sync.inSync === false || baseline.matchesHead === false || isDirty === true) {
    return 'attention';
  }

  if (stageStatus === 'attention') {
    return 'attention';
  }

  if (sync.inSync === null || baseline.matchesHead === null || stageStatus === 'pending') {
    return 'pending';
  }

  return 'ready';
};

const resolveTrackingBranch = (originHead: string | null): string => {
  if (!originHead) {
    return defaultTrackingBranch;
  }

  const match = originHeadPattern.exec(originHead);
  return match?.[1] ?? defaultTrackingBranch;
};

const resolveDevStatus = (syncState: boolean | null, isDirty: boolean | null): RuntimeState => {
  if (syncState === null) {
    return 'pending';
  }

  if (syncState && isDirty !== true) {
    return 'ready';
  }

  return 'attention';
};

const resolveStageStatus = (
  stageCommit: string | null,
  remoteCommit: string | null,
): RuntimeState => {
  if (stageCommit === null) {
    return 'pending';
  }

  if (remoteCommit !== null && stageCommit === remoteCommit) {
    return 'ready';
  }

  return 'attention';
};

const resolveProdStatus = (mainCommit: string | null): RuntimeState =>
  mainCommit === null ? 'pending' : 'ready';

const buildDevNote = (status: RuntimeState, branch: string | null, remoteRef: string): string => {
  if (status === 'ready') {
    return `Local ${branch ?? 'branch'} is aligned with ${remoteRef}.`;
  }

  if (status === 'attention') {
    return `Local branch is not aligned with ${remoteRef} or working tree is dirty.`;
  }

  return `Sync state for ${remoteRef} is not fully available.`;
};

const buildStageNote = (status: RuntimeState, remoteRef: string): string => {
  if (status === 'ready') {
    return `${defaultRemoteName}/stage matches ${remoteRef}.`;
  }

  if (status === 'attention') {
    return `${defaultRemoteName}/stage differs from ${remoteRef}.`;
  }

  return `${defaultRemoteName}/stage reference is not available in this clone.`;
};

const buildProdNote = (status: RuntimeState): string => {
  if (status === 'ready') {
    return `${defaultRemoteName}/main candidate is available; AWS runtime checks are external.`;
  }

  return `${defaultRemoteName}/main reference is not available in this clone.`;
};

const buildPromotionSummary = (
  overall: RuntimeState,
  remoteRef: string,
  baselineTagName: string,
): string => {
  if (overall === 'ready') {
    return `Ready: ${remoteRef} is synchronized, baseline ${baselineTagName} matches HEAD, and stage is aligned.`;
  }

  if (overall === 'attention') {
    return `Attention required: resolve repo sync/baseline mismatches before promoting.`;
  }

  return `Pending: waiting for complete remote or baseline information to finalize promotion readiness.`;
};

/**
 * Creates the developer runtime service, which provides live git context (branch, commit,
 * dirty state, sync status) and environment promotion readiness for the Developer Dashboard.
 * Git results are cached for `gitContextTtlMs` milliseconds to avoid excessive subprocess
 * overhead on repeated requests.
 *
 * @param options Configuration including repo root, optional git executable path, and cache TTL.
 * @returns An object with `getLocalGitContext`, `getPromotionReadiness`, and request-counting methods.
 */
export const createDeveloperRuntimeService = ({
  repoRoot,
  gitExecutable = 'git',
  gitContextTtlMs = 15000,
}: CreateDeveloperRuntimeServiceOptions) => {
  let gitContextCache: { value: LocalGitContext; cachedAt: number } | null = null;
  let promotionReadinessCache: { value: PromotionReadiness; cachedAt: number } | null = null;

  const isDiagnosticsPath = (value: string): boolean => value.startsWith(diagnosticsPathPrefix);

  const readGitOutput = async (args: string[]): Promise<string | null> => {
    try {
      const result = await execFileAsync(gitExecutable, args, {
        cwd: repoRoot,
        timeout: 5000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
      });
      const value = result.stdout?.toString().trim() ?? '';
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  };

  const getGitContext = async (): Promise<LocalGitContext> => {
    const now = Date.now();
    if (gitContextCache && now - gitContextCache.cachedAt < gitContextTtlMs) {
      return gitContextCache.value;
    }

    const [branch, commit, latestMessage, statusOutput] = await Promise.all([
      readGitOutput(['branch', '--show-current']),
      readGitOutput(['rev-parse', '--short', 'HEAD']),
      readGitOutput(['log', '-1', '--pretty=%s']),
      readGitOutput(['status', '--porcelain']),
    ]);

    const value: LocalGitContext = {
      branch,
      commit,
      latestMessage,
      isDirty:
        process.env.DEVELOPER_SKIP_DIRTY_CHECK === 'true'
          ? null
          : statusOutput === null
            ? null
            : statusOutput.length > 0,
    };

    gitContextCache = { value, cachedAt: now };
    return value;
  };

  const getPromotionReadiness = async (
    gitContext: LocalGitContext,
  ): Promise<PromotionReadiness> => {
    const now = Date.now();
    if (promotionReadinessCache && now - promotionReadinessCache.cachedAt < gitContextTtlMs) {
      return promotionReadinessCache.value;
    }

    const originHead = await readGitOutput(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const trackingBranch = resolveTrackingBranch(originHead);
    const remoteRef = `${defaultRemoteName}/${trackingBranch}`;

    const [remoteCommit, aheadBehindOutput, baselineCommit, stageCommit, mainCommit] =
      await Promise.all([
        readGitOutput(['rev-parse', '--short', remoteRef]),
        readGitOutput(['rev-list', '--left-right', '--count', `${remoteRef}...HEAD`]),
        readGitOutput(['rev-parse', '--short', `${defaultBaselineTagName}^{}`]),
        readGitOutput(['rev-parse', '--short', `${defaultRemoteName}/stage`]),
        readGitOutput(['rev-parse', '--short', `${defaultRemoteName}/main`]),
      ]);

    const counts = parseAheadBehindCounts(aheadBehindOutput);
    const sync: PromotionSyncStatus = {
      remote: defaultRemoteName,
      trackingBranch,
      remoteRef,
      localCommit: gitContext.commit,
      remoteCommit,
      aheadCount: counts.aheadCount,
      behindCount: counts.behindCount,
      inSync: resolveSyncState(
        gitContext.commit,
        remoteCommit,
        counts.aheadCount,
        counts.behindCount,
      ),
    };

    const baseline: BaselineAnchorStatus = {
      tagName: defaultBaselineTagName,
      exists: baselineCommit !== null,
      commit: baselineCommit,
      matchesHead:
        baselineCommit && gitContext.commit ? baselineCommit === gitContext.commit : null,
    };

    const devStatus = resolveDevStatus(sync.inSync, gitContext.isDirty);
    const stageStatus = resolveStageStatus(stageCommit, remoteCommit);
    const prodStatus = resolveProdStatus(mainCommit);

    const environments: PromotionEnvironmentStatus[] = [
      {
        name: 'dev',
        runtime: 'Docker Compose',
        sourceBranch: gitContext.branch,
        targetRevision: gitContext.commit,
        status: devStatus,
        note: buildDevNote(devStatus, gitContext.branch, remoteRef),
      },
      {
        name: 'stage',
        runtime: 'Docker Compose',
        sourceBranch: trackingBranch,
        targetRevision: stageCommit,
        status: stageStatus,
        note: buildStageNote(stageStatus, remoteRef),
      },
      {
        name: 'prod',
        runtime: 'AWS',
        sourceBranch: 'main',
        targetRevision: mainCommit,
        status: prodStatus,
        note: buildProdNote(prodStatus),
      },
    ];

    const overall = resolveOverallReadiness(sync, baseline, stageStatus, gitContext.isDirty);
    const summary = buildPromotionSummary(overall, remoteRef, baseline.tagName);

    const value: PromotionReadiness = {
      sync,
      baseline,
      overall,
      summary,
      environments,
      checkedAt: new Date().toISOString(),
    };

    promotionReadinessCache = { value, cachedAt: now };
    return value;
  };

  const noteRequestSeenForPath = (path: string): void => {
    if (!isDiagnosticsPath(path)) {
      noteRequestSeen();
    }
  };

  const recordFailedRequest = (entry: RuntimeFailedRequest): void => {
    if (isDiagnosticsPath(entry.path)) {
      return;
    }

    recordRuntimeFailedRequest(entry);
  };

  const recordException = (entry: RuntimeException): void => {
    if (isDiagnosticsPath(entry.path)) {
      return;
    }

    recordRuntimeException(entry);
  };

  const getRuntimeOverview = async () => {
    const gitContext = await getGitContext();

    return {
      ...getRuntimeSummary(),
      gitContext,
      promotionReadiness: await getPromotionReadiness(gitContext),
      recentFailedRequests: listFailedRequests(5),
      recentExceptions: listExceptions(5),
      recentReconciliationRuns: listReconciliationRuns(5),
    };
  };

  return {
    isDiagnosticsPath,
    noteRequestSeenForPath,
    recordFailedRequest,
    recordException,
    getRuntimeOverview,
    listFailedRequests,
    listExceptions,
    listReconciliationRuns,
  };
};
