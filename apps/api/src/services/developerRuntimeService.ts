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

type LocalGitContext = {
  branch: string | null;
  commit: string | null;
  latestMessage: string | null;
  isDirty: boolean | null;
};

type RuntimeFailedRequest = Parameters<typeof recordRuntimeFailedRequest>[0];
type RuntimeException = Parameters<typeof recordRuntimeException>[0];

type CreateDeveloperRuntimeServiceOptions = {
  repoRoot: string;
  gitExecutable?: string;
  gitContextTtlMs?: number;
};

const diagnosticsPathPrefix = '/api/developer';

export const createDeveloperRuntimeService = ({
  repoRoot,
  gitExecutable = 'git',
  gitContextTtlMs = 15000,
}: CreateDeveloperRuntimeServiceOptions) => {
  let gitContextCache: { value: LocalGitContext; cachedAt: number } | null = null;

  const isDiagnosticsPath = (value: string): boolean => value.startsWith(diagnosticsPathPrefix);

  const readGitOutput = async (args: string[]): Promise<string | null> => {
    try {
      const result = await execFileAsync(gitExecutable, args, {
        cwd: repoRoot,
        timeout: 5000,
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
      isDirty: statusOutput === null ? null : statusOutput.length > 0,
    };

    gitContextCache = { value, cachedAt: now };
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

  const getRuntimeOverview = async () => ({
    ...getRuntimeSummary(),
    gitContext: await getGitContext(),
    recentFailedRequests: listFailedRequests(5),
    recentExceptions: listExceptions(5),
    recentReconciliationRuns: listReconciliationRuns(5),
  });

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
