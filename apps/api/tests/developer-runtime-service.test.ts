import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDeveloperRuntimeService } from '../src/services/developerRuntimeService';

/**
 * `createDeveloperRuntimeService` shells out to git for every promotion-readiness signal, and it
 * accepts the executable to use — so the whole surface is reachable by pointing it at a stub that
 * answers from environment variables. That covers the sync/baseline/stage/prod state machine
 * without needing a real repository in a specific state, which is otherwise impossible to arrange
 * deterministically in CI.
 */

let workspace: string;
let gitExecutable: string;

const gitStub = `#!/bin/sh
case "$*" in
  "branch --show-current") printf '%s' "$FAKE_GIT_BRANCH" ;;
  "rev-parse --short HEAD") printf '%s' "$FAKE_GIT_HEAD" ;;
  "log -1 --pretty=%s") printf '%s' "$FAKE_GIT_MESSAGE" ;;
  "status --porcelain") printf '%s' "$FAKE_GIT_STATUS" ;;
  "symbolic-ref --short refs/remotes/origin/HEAD") printf '%s' "$FAKE_GIT_ORIGIN_HEAD" ;;
  "rev-list --left-right --count "*) printf '%s' "$FAKE_GIT_AHEAD_BEHIND" ;;
  "rev-parse --short origin/stage") printf '%s' "$FAKE_GIT_STAGE" ;;
  "rev-parse --short origin/main") printf '%s' "$FAKE_GIT_MAIN" ;;
  *"^{}") printf '%s' "$FAKE_GIT_BASELINE" ;;
  "rev-parse --short origin/"*) printf '%s' "$FAKE_GIT_REMOTE" ;;
  *) exit 1 ;;
esac
printf '\\n'
`;

const fakeGitKeys = [
  'FAKE_GIT_BRANCH',
  'FAKE_GIT_HEAD',
  'FAKE_GIT_MESSAGE',
  'FAKE_GIT_STATUS',
  'FAKE_GIT_ORIGIN_HEAD',
  'FAKE_GIT_AHEAD_BEHIND',
  'FAKE_GIT_STAGE',
  'FAKE_GIT_MAIN',
  'FAKE_GIT_BASELINE',
  'FAKE_GIT_REMOTE',
] as const;

const setGit = (values: Partial<Record<(typeof fakeGitKeys)[number], string>>): void => {
  for (const key of fakeGitKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

/** A repository that is clean, in sync with origin/dev, and sitting on the baseline tag. */
const healthyRepo = {
  FAKE_GIT_BRANCH: 'dev',
  FAKE_GIT_HEAD: 'abc1234',
  FAKE_GIT_MESSAGE: 'Add reconciliation export',
  FAKE_GIT_STATUS: '',
  FAKE_GIT_ORIGIN_HEAD: 'origin/dev',
  FAKE_GIT_AHEAD_BEHIND: '0\t0',
  FAKE_GIT_REMOTE: 'abc1234',
  FAKE_GIT_STAGE: 'abc1234',
  FAKE_GIT_MAIN: 'abc1234',
  FAKE_GIT_BASELINE: 'abc1234',
} as const;

// Each service instance caches for gitContextTtlMs, so tests build their own with the cache off
// unless they are specifically exercising caching.
const buildService = (gitContextTtlMs = 0) =>
  createDeveloperRuntimeService({ repoRoot: workspace, gitExecutable, gitContextTtlMs });

beforeAll(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'recon-runtime-'));
  gitExecutable = path.join(workspace, 'fake-git.sh');
  writeFileSync(gitExecutable, gitStub, 'utf8');
  chmodSync(gitExecutable, 0o755);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

afterEach(() => {
  setGit({});
  delete process.env.DEVELOPER_SKIP_DIRTY_CHECK;
});

describe('createDeveloperRuntimeService', () => {
  describe('diagnostics path filtering', () => {
    it.each([
      ['/api/developer/status', true],
      ['/api/developer/runtime/runs', true],
      ['/api/reconciliation/latest', false],
      ['/api/health', false],
    ])('classifies %s as a diagnostics path: %s', (routePath, expected) => {
      expect(buildService().isDiagnosticsPath(routePath)).toBe(expected);
    });

    it('does not record failed requests originating from the dashboard itself', () => {
      const service = buildService();

      service.recordFailedRequest({
        path: '/api/developer/runtime',
        method: 'GET',
        statusCode: 500,
        timestamp: new Date().toISOString(),
        durationMs: 12,
        correlationId: 'corr-dashboard',
      });

      expect(
        service.listFailedRequests(5).some((entry) => entry.path.startsWith('/api/developer')),
      ).toBe(false);
    });

    it('records failed requests from application routes', () => {
      const service = buildService();
      service.recordFailedRequest({
        path: '/api/reconciliation',
        method: 'POST',
        statusCode: 500,
        timestamp: new Date().toISOString(),
        durationMs: 12,
        correlationId: 'corr-app',
      });

      expect(service.listFailedRequests(5)[0]).toMatchObject({ path: '/api/reconciliation' });
    });

    it('does not record exceptions originating from the dashboard itself', () => {
      const service = buildService();

      service.recordException({
        path: '/api/developer/status',
        method: 'GET',
        message: 'boom',
        timestamp: new Date().toISOString(),
        statusCode: 500,
        correlationId: 'corr-dashboard',
        errorName: 'Error',
      });

      expect(
        service.listExceptions(5).some((entry) => entry.path.startsWith('/api/developer')),
      ).toBe(false);
    });

    it('records exceptions from application routes', () => {
      const service = buildService();

      service.recordException({
        path: '/api/reconciliation',
        method: 'POST',
        message: 'boom',
        timestamp: new Date().toISOString(),
        statusCode: 500,
        correlationId: 'corr-app',
        errorName: 'Error',
      });

      expect(service.listExceptions(5)[0]).toMatchObject({
        path: '/api/reconciliation',
        message: 'boom',
      });
    });
  });

  describe('git context', () => {
    it('reports branch, commit, and latest message from git', async () => {
      setGit(healthyRepo);

      const overview = await buildService().getRuntimeOverview();

      expect(overview.gitContext).toMatchObject({
        branch: 'dev',
        commit: 'abc1234',
        latestMessage: 'Add reconciliation export',
      });
    });

    // `readGitOutput` maps empty stdout to null, and `git status --porcelain` on a clean tree
    // prints nothing — so a clean repository is indistinguishable from a git failure and reports
    // isDirty: null ("unknown") rather than false ("clean"). Downstream this still resolves to a
    // ready dev environment, so it is a reporting imprecision rather than a functional bug.
    it('cannot distinguish a clean working tree from a failed status call', async () => {
      setGit(healthyRepo);

      const overview = await buildService().getRuntimeOverview();

      expect(overview.gitContext.isDirty).toBeNull();
    });

    it('reports a dirty tree when git status has entries', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_STATUS: ' M apps/api/src/app.ts' });

      const overview = await buildService().getRuntimeOverview();

      expect(overview.gitContext.isDirty).toBe(true);
    });

    it('suppresses the dirty flag when DEVELOPER_SKIP_DIRTY_CHECK is set', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_STATUS: ' M apps/api/src/app.ts' });
      process.env.DEVELOPER_SKIP_DIRTY_CHECK = 'true';

      const overview = await buildService().getRuntimeOverview();

      expect(overview.gitContext.isDirty).toBeNull();
    });

    it('reports null fields when git produces no output', async () => {
      setGit({});

      const overview = await buildService().getRuntimeOverview();

      expect(overview.gitContext).toMatchObject({
        branch: null,
        commit: null,
        latestMessage: null,
        isDirty: null,
      });
    });

    it('serves a second call from cache while the TTL is live', async () => {
      setGit(healthyRepo);
      const service = buildService(60000);

      const first = await service.getRuntimeOverview();
      setGit({ ...healthyRepo, FAKE_GIT_BRANCH: 'feature/other' });
      const second = await service.getRuntimeOverview();

      expect(second.gitContext.branch).toBe(first.gitContext.branch);
    });
  });

  describe('promotion sync', () => {
    it('reports in-sync when ahead and behind are both zero', async () => {
      setGit(healthyRepo);

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.sync).toMatchObject({
        remote: 'origin',
        trackingBranch: 'dev',
        remoteRef: 'origin/dev',
        aheadCount: 0,
        behindCount: 0,
        inSync: true,
      });
    });

    it('reports out of sync when the branch is ahead', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_AHEAD_BEHIND: '0\t3' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.sync).toMatchObject({
        aheadCount: 3,
        behindCount: 0,
        inSync: false,
      });
    });

    it('reports out of sync when the branch is behind', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_AHEAD_BEHIND: '2\t0' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.sync).toMatchObject({
        aheadCount: 0,
        behindCount: 2,
        inSync: false,
      });
    });

    it('falls back to commit comparison when the ahead/behind count is unavailable', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_AHEAD_BEHIND: '' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.sync).toMatchObject({
        aheadCount: null,
        behindCount: null,
        inSync: true,
      });
    });

    it('reports an unknown sync state when neither counts nor a remote commit are available', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_AHEAD_BEHIND: '', FAKE_GIT_REMOTE: '' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.sync.inSync).toBeNull();
    });

    it('treats unparseable ahead/behind output as unknown counts', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_AHEAD_BEHIND: 'not numbers' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.sync).toMatchObject({ aheadCount: null, behindCount: null });
    });

    it('derives the tracking branch from origin HEAD', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_ORIGIN_HEAD: 'origin/release' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.sync).toMatchObject({
        trackingBranch: 'release',
        remoteRef: 'origin/release',
      });
    });

    it('falls back to the default tracking branch when origin HEAD is unavailable', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_ORIGIN_HEAD: '' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.sync.trackingBranch).toBe('dev');
    });

    it('falls back to the default tracking branch when origin HEAD is not an origin ref', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_ORIGIN_HEAD: 'upstream/trunk' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.sync.trackingBranch).toBe('dev');
    });
  });

  describe('baseline anchor', () => {
    it('reports the baseline as present and matching HEAD', async () => {
      setGit(healthyRepo);

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.baseline).toMatchObject({
        exists: true,
        commit: 'abc1234',
        matchesHead: true,
      });
    });

    it('reports the baseline as present but diverged from HEAD', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_BASELINE: 'def5678' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.baseline).toMatchObject({ exists: true, matchesHead: false });
    });

    it('reports a missing baseline tag', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_BASELINE: '' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.baseline).toMatchObject({
        exists: false,
        commit: null,
        matchesHead: null,
      });
    });

    it('cannot compare the baseline against an unknown HEAD', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_HEAD: '' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.baseline.matchesHead).toBeNull();
    });
  });

  describe('environment readiness', () => {
    const environment = async (
      name: 'dev' | 'stage' | 'prod',
      overrides: Partial<Record<(typeof fakeGitKeys)[number], string>> = {},
    ) => {
      setGit({ ...healthyRepo, ...overrides });
      const { promotionReadiness } = await buildService().getRuntimeOverview();
      return promotionReadiness.environments.find((entry) => entry.name === name);
    };

    it('marks dev ready when in sync and clean', async () => {
      expect(await environment('dev')).toMatchObject({
        status: 'ready',
        runtime: 'Docker Compose',
      });
    });

    it('marks dev as needing attention when the tree is dirty', async () => {
      expect(await environment('dev', { FAKE_GIT_STATUS: ' M file.ts' })).toMatchObject({
        status: 'attention',
      });
    });

    it('marks dev pending when the sync state is unknown', async () => {
      expect(
        await environment('dev', { FAKE_GIT_AHEAD_BEHIND: '', FAKE_GIT_REMOTE: '' }),
      ).toMatchObject({ status: 'pending' });
    });

    it('marks stage ready when it matches the tracking remote', async () => {
      expect(await environment('stage')).toMatchObject({ status: 'ready', sourceBranch: 'dev' });
    });

    it('marks stage as needing attention when it lags the tracking remote', async () => {
      expect(await environment('stage', { FAKE_GIT_STAGE: 'old0000' })).toMatchObject({
        status: 'attention',
      });
    });

    it('marks stage pending when its commit is unknown', async () => {
      expect(await environment('stage', { FAKE_GIT_STAGE: '' })).toMatchObject({
        status: 'pending',
      });
    });

    it('reports prod against main on AWS', async () => {
      expect(await environment('prod')).toMatchObject({
        runtime: 'AWS',
        sourceBranch: 'main',
        targetRevision: 'abc1234',
      });
    });

    it('marks prod pending when main is unknown', async () => {
      expect(await environment('prod', { FAKE_GIT_MAIN: '' })).toMatchObject({ status: 'pending' });
    });

    it('attaches a human-readable note to every environment', async () => {
      setGit(healthyRepo);

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      for (const entry of promotionReadiness.environments) {
        expect(entry.note.length).toBeGreaterThan(0);
      }
    });
  });

  describe('overall readiness', () => {
    it('summarizes a healthy repository as ready', async () => {
      setGit(healthyRepo);

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.overall).toBe('ready');
      expect(promotionReadiness.summary).toContain('origin/dev');
    });

    it('downgrades overall readiness when the working tree is dirty', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_STATUS: ' M file.ts' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.overall).not.toBe('ready');
    });

    it('downgrades overall readiness when the baseline tag is missing', async () => {
      setGit({ ...healthyRepo, FAKE_GIT_BASELINE: '' });

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(promotionReadiness.overall).not.toBe('ready');
    });

    it('stamps the readiness snapshot with an ISO timestamp', async () => {
      setGit(healthyRepo);

      const { promotionReadiness } = await buildService().getRuntimeOverview();

      expect(new Date(promotionReadiness.checkedAt).toISOString()).toBe(
        promotionReadiness.checkedAt,
      );
    });
  });

  describe('runtime overview composition', () => {
    it('includes the recent activity lists alongside the git signals', async () => {
      setGit(healthyRepo);

      const overview = await buildService().getRuntimeOverview();

      expect(overview).toMatchObject({
        recentFailedRequests: expect.any(Array),
        recentExceptions: expect.any(Array),
        recentReconciliationRuns: expect.any(Array),
      });
    });
  });
});
