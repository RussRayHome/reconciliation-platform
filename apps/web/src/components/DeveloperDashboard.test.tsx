// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DeveloperDashboard } from './DeveloperDashboard';

const resolveUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const baseStatus = {
  generatedAt: '2026-07-30T12:00:00.000Z',
  overallStatus: 'attention-needed' as const,
  failedChecks: 2,
  passedChecks: 8,
  totalChecks: 10,
  totalDurationMs: 125000,
  checks: [
    { name: 'Lint', ok: false, durationMs: 1000, summary: 'failed', areaLabel: 'Static analysis' },
    {
      name: 'Typecheck',
      ok: false,
      durationMs: 1000,
      summary: 'failed',
      areaLabel: 'Static analysis',
    },
    { name: 'Unit tests', ok: true, durationMs: 500, summary: 'ok' },
  ],
  cache: { ttlMs: 60000, ageMs: 5000, fromCache: true, stale: true },
};

const baseRuntime = {
  apiStatus: 'reachable' as const,
  startedAt: '2026-07-30T10:00:00.000Z',
  uptimeMs: 65000,
  lastRequestAt: null,
  failedRequestsLastWindow: 3,
  exceptionsLastWindow: 1,
  gitContext: { branch: 'dev', commit: 'abcdef1234567890', isDirty: true },
  promotionReadiness: {
    overall: 'attention' as const,
    summary: 'Blocked on 3 issues',
    checkedAt: '2026-07-30T12:00:00.000Z',
    sync: { remote: 'origin', trackingBranch: 'dev', aheadCount: 2, behindCount: 1, inSync: false },
    baseline: { tagName: 'v1.2.3', exists: true, matchesHead: false },
    environments: [
      {
        name: 'dev',
        runtime: 'docker',
        sourceBranch: 'dev',
        targetRevision: 'abcdef1234567890',
        status: 'ready' as const,
        note: 'ok',
      },
      {
        name: 'stage',
        runtime: 'docker',
        sourceBranch: null,
        targetRevision: null,
        status: 'pending' as const,
        note: 'waiting',
      },
    ],
  },
  recentFailedRequests: [
    { timestamp: '2026-07-30T11:59:00.000Z', method: 'POST', path: '/api/x', statusCode: 500 },
  ],
  recentExceptions: [
    { timestamp: '2026-07-30T11:58:00.000Z', errorName: 'TypeError', message: 'boom', path: '/api/y' },
  ],
  recentReconciliationRuns: [
    {
      timestamp: '2026-07-30T11:57:00.000Z',
      status: 'Succeeded' as const,
      periodLabel: 'March 2026',
      durationMs: 3000,
      exceptionCount: 5,
    },
    {
      timestamp: '2026-07-30T11:56:00.000Z',
      status: 'Failed' as const,
      durationMs: 1000,
      failureReason: 'timeout',
    },
  ],
};

const mockFetch = (
  handlers: Partial<Record<'status' | 'runtime', () => Response | Promise<Response>>>,
) => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = resolveUrl(input);

    if (url.startsWith('/api/developer/status')) {
      return Promise.resolve(handlers.status ? handlers.status() : jsonResponse(baseStatus));
    }

    if (url === '/api/developer/runtime') {
      return Promise.resolve(handlers.runtime ? handlers.runtime() : jsonResponse(baseRuntime));
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DeveloperDashboard', () => {
  it('renders repository health, promotion, runtime, and events once data loads', async () => {
    mockFetch({});
    render(<DeveloperDashboard />);

    await waitFor(() => expect(screen.getByText('Attention')).toBeInTheDocument());

    // Repository health KPIs, including deduped failing areas.
    expect(screen.getByText('2')).toBeInTheDocument(); // failed checks
    expect(screen.getByText('8/10')).toBeInTheDocument(); // passed/total
    expect(screen.getByText('2m 5s')).toBeInTheDocument(); // totalDurationMs formatted
    expect(screen.getByText('Stale')).toBeInTheDocument(); // cache label
    expect(screen.getByText('Static analysis')).toBeInTheDocument(); // deduped failing area (once)

    // Environment promotion matrix.
    // shortRevision: shown for both the env matrix row and the runtime "Commit" field.
    expect(screen.getAllByText('abcdef1234').length).toBeGreaterThanOrEqual(2);
    // stage row's null source/revision plus the null lastRequestAt all collapse into dashes.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Blocked on 3 issues')).toBeInTheDocument();
    expect(
      screen.getByText(/Local dev is out of sync with origin \(2 ahead \/ 1 behind\)\./),
    ).toBeInTheDocument();
    expect(screen.getByText('HEAD does not match baseline tag v1.2.3.')).toBeInTheDocument();
    expect(screen.getByText('Working tree has uncommitted changes.')).toBeInTheDocument();

    // Runtime health summary.
    expect(screen.getByText('1m 5s')).toBeInTheDocument(); // uptime formatted
    expect(screen.getByText('dev (dirty)')).toBeInTheDocument();
    expect(screen.getByText('3 requests · 1 exceptions')).toBeInTheDocument();

    // Runtime events feed: reconciliation runs + failed request + exception + lifecycle,
    // sorted newest-first.
    const events = screen.getAllByText(/Reconciliation run |Failed request |TypeError|API server started/);
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText('Reconciliation run succeeded')).toBeInTheDocument();
    expect(screen.getByText('Reconciliation run failed')).toBeInTheDocument();
    expect(screen.getByText('Failed request 500')).toBeInTheDocument();
    expect(screen.getByText('TypeError')).toBeInTheDocument();
    expect(screen.getByText('API server started')).toBeInTheDocument();
  });

  it('renders the healthy, fully-synced, uncached branch set', async () => {
    mockFetch({
      status: () =>
        jsonResponse({
          ...baseStatus,
          overallStatus: 'healthy',
          failedChecks: 0,
          checks: [{ name: 'Unit tests', ok: true, durationMs: 500, summary: 'ok' }],
          cache: { ttlMs: 60000, ageMs: 1000, fromCache: false },
        }),
      runtime: () =>
        jsonResponse({
          ...baseRuntime,
          lastRequestAt: '2026-07-30T11:59:30.000Z',
          gitContext: { branch: null, commit: null, isDirty: false },
          promotionReadiness: {
            ...baseRuntime.promotionReadiness,
            overall: 'ready',
            sync: {
              remote: 'origin',
              trackingBranch: 'dev',
              aheadCount: 0,
              behindCount: 0,
              inSync: true,
            },
            baseline: { tagName: 'v1.2.3', exists: true, matchesHead: true },
            environments: [],
          },
        }),
    });

    render(<DeveloperDashboard />);

    await waitFor(() => expect(screen.getByText('Healthy')).toBeInTheDocument());

    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveAttribute('data-tone', 'ready');
    // No blockers: the promotion callout renders no <ul>.
    expect(screen.getByRole('note').querySelector('ul')).toBeNull();
  });

  it('shows a fallback error message when the status request fails without an Error', async () => {
    mockFetch({
      // Deliberately rejects with a non-Error to exercise the `error instanceof Error`
      // fallback branch in DeveloperDashboard's catch handler.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      status: () => Promise.reject('network down'),
    });

    render(<DeveloperDashboard />);

    await waitFor(() =>
      expect(screen.getByText('Unable to load repo status.')).toBeInTheDocument(),
    );
  });

  it('surfaces the real error message when the runtime request rejects with an Error', async () => {
    mockFetch({
      runtime: () => Promise.reject(new Error('runtime unreachable')),
    });

    render(<DeveloperDashboard />);

    await waitFor(() => expect(screen.getByText('runtime unreachable')).toBeInTheDocument());
  });

  it('disables both actions and swaps labels while a refresh is in flight, then restores them', async () => {
    const user = userEvent.setup();
    let resolveSecondStatus: (() => void) | undefined;

    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = resolveUrl(input);

      if (url.startsWith('/api/developer/status')) {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve(jsonResponse(baseStatus));
        }
        return new Promise((resolve) => {
          resolveSecondStatus = () => resolve(jsonResponse(baseStatus));
        });
      }

      if (url === '/api/developer/runtime') {
        return Promise.resolve(jsonResponse(baseRuntime));
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<DeveloperDashboard />);
    await waitFor(() => expect(screen.getByText('Attention')).toBeInTheDocument());

    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    const forceButton = screen.getByRole('button', { name: 'Force refresh' });

    await user.click(refreshButton);

    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    expect(forceButton).toBeDisabled();

    await act(async () => {
      resolveSecondStatus?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled(),
    );
  });

  it('requests a forced refresh with the force=true query parameter', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = resolveUrl(input);
      requestedUrls.push(url);

      if (url.startsWith('/api/developer/status')) {
        return Promise.resolve(jsonResponse(baseStatus));
      }
      if (url === '/api/developer/runtime') {
        return Promise.resolve(jsonResponse(baseRuntime));
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<DeveloperDashboard />);
    await waitFor(() => expect(screen.getByText('Attention')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Force refresh' }));
    await waitFor(() => expect(requestedUrls).toContain('/api/developer/status?force=true'));
  });

  it('shows loading skeletons before either request resolves', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<DeveloperDashboard />);

    const panels = await screen.findAllByRole('status');
    expect(panels.length).toBeGreaterThan(0);
    expect(screen.getByText('Loading repository checks')).toBeInTheDocument();
    expect(screen.getByText('Loading promotion readiness')).toBeInTheDocument();
    expect(screen.getByText('Loading runtime summary')).toBeInTheDocument();
    expect(screen.getByText('Loading runtime events')).toBeInTheDocument();
  });
});
