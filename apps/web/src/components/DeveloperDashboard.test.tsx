// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

const baseRepoHealth = {
  overallStatus: 'attention-needed' as const,
  failedChecks: 2,
  lastCiRun: { status: 'attention-needed' as const, durationMs: 125000, at: '2026-07-30T12:00:00.000Z' },
  commitsThisWeek: 17,
  branchFreshness: { remoteRef: 'origin/stage vs origin/dev', aheadCount: 0, behindCount: 4 },
  openPrCount: 2,
};

const baseStatus = {
  generatedAt: '2026-07-30T12:00:00.000Z',
  overallStatus: 'attention-needed' as const,
  failedChecks: 2,
  passedChecks: 5,
  totalChecks: 7,
  totalDurationMs: 125000,
  checks: [
    {
      name: 'Unit tests',
      ok: true,
      durationMs: 5000,
      summary: 'Passed: 100, Failed: 0',
      areaLabel: 'Unit',
      passedCount: 100,
      failedCount: 0,
      totalCount: 100,
      testItems: [],
    },
    {
      name: 'Static analysis (lint)',
      ok: false,
      durationMs: 1000,
      summary: '2 lint problems',
      areaLabel: 'Static analysis',
      lintIssues: [
        { rule: 'no-unused-vars', severity: 'error', file: 'apps/web/src/App.tsx', line: 10, message: 'unused var' },
        { rule: 'react-hooks/exhaustive-deps', severity: 'warning', file: 'apps/web/src/App.tsx', line: 20, message: 'missing dep' },
      ],
    },
    {
      name: 'Static analysis (typecheck)',
      ok: true,
      durationMs: 1000,
      summary: 'No type errors',
      areaLabel: 'Static analysis',
    },
    {
      name: 'Postgres DB tests',
      ok: false,
      durationMs: 20000,
      summary: 'Passed: 12, Failed: 1',
      areaLabel: 'Postgres DB',
      passedCount: 12,
      failedCount: 1,
      totalCount: 13,
      dbTestItems: [
        { name: 'migration_apply_clean_db', category: 'migration', status: 'passed', durationMs: 3200 },
        {
          name: 'check_amount_precision',
          category: 'constraint',
          status: 'failed',
          durationMs: 700,
          failureMessage: 'expected NUMERIC(18,4)',
        },
      ],
    },
    {
      name: 'Coverage',
      ok: true,
      durationMs: 30000,
      summary: 'Coverage S/B/F/L: S 81% | B 80% | F 82% | L 81%',
      areaLabel: 'Coverage',
      coverageBenchmarks: [{ key: 'L', label: 'Lines', value: '81.4', meetsThreshold: true }],
      coverageFiles: [
        {
          filePath: 'apps/web/src/components/ExceptionTable.tsx',
          lines: 54.2,
          branches: 41,
          functions: 60,
          uncoveredLineCount: 118,
          meetsMinimum: false,
        },
        {
          filePath: 'apps/web/src/components/ReportsGrid.tsx',
          lines: 91.2,
          branches: 84.6,
          functions: 100,
          uncoveredLineCount: 7,
          meetsMinimum: true,
        },
      ],
    },
    {
      name: 'Security vulnerabilities',
      ok: false,
      durationMs: 40000,
      summary: 'Vulnerabilities across 4 components',
      areaLabel: 'Security',
      securityAggregateScore: { critical: 1, high: 2, moderate: 3, low: 4, info: 0 },
      securityComponentScores: [
        {
          component: 'API',
          scanner: 'npm audit',
          status: 'ok',
          critical: 1,
          high: 0,
          moderate: 0,
          low: 0,
          info: 0,
          cveFindings: [
            {
              id: 'CVE-2026-30154',
              description: 'Signature-bypass flaw in jsonwebtoken.',
              severity: 'CRITICAL',
              component: 'API',
              scanner: 'npm audit',
              packageName: 'jsonwebtoken',
              installedVersion: '9.0.1',
              fixedVersion: '9.0.4',
              path: 'direct',
              status: 'patch-available',
            },
          ],
        },
        {
          component: 'Web Server',
          scanner: 'npm audit',
          status: 'ok',
          critical: 0,
          high: 2,
          moderate: 0,
          low: 0,
          info: 0,
          cveFindings: [
            {
              id: 'CVE-2026-25990',
              description: 'SSRF via redirect handling.',
              severity: 'HIGH',
              component: 'Web Server',
              scanner: 'Trivy',
              packageName: 'axios',
              installedVersion: '1.6.0',
              fixedVersion: '1.7.2',
              path: 'transitive',
              status: 'open',
            },
          ],
        },
        {
          component: 'Container Component',
          scanner: 'Trivy',
          status: 'ok',
          critical: 0,
          high: 0,
          moderate: 2,
          low: 1,
          info: 0,
        },
        {
          component: 'Database',
          scanner: 'Trivy + pgAudit',
          status: 'ok',
          critical: 0,
          high: 0,
          moderate: 1,
          low: 3,
          info: 0,
        },
      ],
    },
    {
      name: 'E2E tests',
      ok: true,
      durationMs: 291000,
      summary: 'Passed: 27, Failed: 0',
      areaLabel: 'E2E',
      passedCount: 27,
      failedCount: 0,
      totalCount: 28,
      e2eSpecs: [
        { name: 'login.spec.ts › logs in', status: 'passed', durationMs: 8400, retries: 0 },
        {
          name: 'exceptions-triage.spec.ts › filters rows',
          status: 'flaky',
          durationMs: 41200,
          retries: 1,
          artifactPath: 'test-results/trace.zip',
        },
      ],
    },
  ],
  repoHealth: baseRepoHealth,
  cache: { ttlMs: 60000, ageMs: 5000, fromCache: true, stale: true },
};

const baseRuntime = {
  gitContext: { branch: 'dev', commit: 'abcdef1234567890', isDirty: true },
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
  it('renders the header verdict, repo health band, and overview cards once data loads', async () => {
    mockFetch({});
    render(<DeveloperDashboard />);

    await waitFor(() => expect(screen.getByText('Failing')).toBeInTheDocument());

    // Header: branch @ short revision.
    expect(screen.getByText('dev @ abcdef1234')).toBeInTheDocument();

    // Repo Health KPI band.
    expect(screen.getByText('Attention')).toBeInTheDocument();
    const kpiBand = document.querySelector('.kpi-wells--six') as HTMLElement;
    expect(within(kpiBand).getAllByText('2')).toHaveLength(2); // openPrCount and failedChecks
    expect(within(kpiBand).getByText('−4')).toBeInTheDocument(); // branch freshness drift
    expect(within(kpiBand).getByText('17')).toBeInTheDocument(); // commits this week

    // Overview cards: one per check area, each linking to its detail panel.
    expect(screen.getByRole('heading', { name: 'Unit tests' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Static code analysis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Database tests' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Code coverage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'E2E tests' })).toBeInTheDocument();
  });

  it('renders the unit tests, lint, and database detail panels with per-item rows', async () => {
    mockFetch({});
    render(<DeveloperDashboard />);
    await waitFor(() => expect(screen.getByText('Failing')).toBeInTheDocument());

    // Unit tests: all passed, so the failed & skipped table shows the empty state.
    const unitPanel = document.querySelector('#unit-tests');
    expect(unitPanel).not.toBeNull();
    expect(within(unitPanel as HTMLElement).getByText('All unit tests passed.')).toBeInTheDocument();

    // Static analysis: both lint issues listed with correct severities.
    const staticPanel = document.querySelector('#static');
    expect(within(staticPanel as HTMLElement).getByText('no-unused-vars')).toBeInTheDocument();
    expect(within(staticPanel as HTMLElement).getByText('Error')).toBeInTheDocument();
    expect(within(staticPanel as HTMLElement).getByText('Warning')).toBeInTheDocument();

    // Database tests: both rows shown, including the failure message.
    const dbPanel = document.querySelector('#db-tests');
    expect(within(dbPanel as HTMLElement).getByText('migration_apply_clean_db')).toBeInTheDocument();
    expect(within(dbPanel as HTMLElement).getByText('check_amount_precision')).toBeInTheDocument();
    expect(within(dbPanel as HTMLElement).getByText('expected NUMERIC(18,4)')).toBeInTheDocument();
  });

  it('renders the coverage, security, and e2e detail panels with per-item rows', async () => {
    mockFetch({});
    render(<DeveloperDashboard />);
    await waitFor(() => expect(screen.getByText('Failing')).toBeInTheDocument());

    const coveragePanel = document.querySelector('#coverage');
    expect(
      within(coveragePanel as HTMLElement).getByText('apps/web/src/components/ExceptionTable.tsx'),
    ).toBeInTheDocument();
    expect(within(coveragePanel as HTMLElement).getByText(/1 files below minimum/)).toBeInTheDocument();

    // Security: four component sub-groups, each with its own header pill.
    const securityPanel = document.querySelector('#security');
    expect(within(securityPanel as HTMLElement).getByText('API')).toBeInTheDocument();
    expect(within(securityPanel as HTMLElement).getByText('Web Server')).toBeInTheDocument();
    expect(within(securityPanel as HTMLElement).getByText('Container Component')).toBeInTheDocument();
    expect(within(securityPanel as HTMLElement).getByText('Database')).toBeInTheDocument();
    expect(within(securityPanel as HTMLElement).getByText('CVE-2026-30154')).toBeInTheDocument();
    expect(within(securityPanel as HTMLElement).getByText('jsonwebtoken')).toBeInTheDocument();
    expect(within(securityPanel as HTMLElement).getByText('9.0.4')).toBeInTheDocument();

    // E2E: failures/flaky sort first — flaky spec should appear.
    const e2ePanel = document.querySelector('#e2e');
    expect(within(e2ePanel as HTMLElement).getByText(/filters rows/)).toBeInTheDocument();
    expect(within(e2ePanel as HTMLElement).getByText('Flaky')).toBeInTheDocument();
  });

  it('renders the healthy, all-clear branch set', async () => {
    mockFetch({
      status: () =>
        jsonResponse({
          ...baseStatus,
          overallStatus: 'healthy',
          failedChecks: 0,
          checks: baseStatus.checks.map((check) => ({ ...check, ok: true, lintIssues: [] })),
          repoHealth: {
            ...baseRepoHealth,
            overallStatus: 'healthy',
            failedChecks: 0,
            branchFreshness: { ...baseRepoHealth.branchFreshness, behindCount: 0 },
          },
          cache: { ttlMs: 60000, ageMs: 1000, fromCache: false },
        }),
    });

    render(<DeveloperDashboard />);

    await waitFor(() => expect(screen.getByText('Healthy')).toBeInTheDocument());
    expect(screen.getByText('Up to date')).toBeInTheDocument();
  });

  it('shows a fallback error message when the status request fails without an Error', async () => {
    mockFetch({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      status: () => Promise.reject('network down'),
    });

    render(<DeveloperDashboard />);

    await waitFor(() =>
      expect(screen.getByText('Unable to load repo status.')).toBeInTheDocument(),
    );
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
    await waitFor(() => expect(screen.getByText('Failing')).toBeInTheDocument());

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
    await waitFor(() => expect(screen.getByText('Failing')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Force refresh' }));
    await waitFor(() => expect(requestedUrls).toContain('/api/developer/status?force=true'));
  });

  it('shows a loading skeleton before the status request resolves', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<DeveloperDashboard />);

    const panel = await screen.findByRole('status');
    expect(panel).toBeInTheDocument();
    expect(screen.getByText('Loading application health')).toBeInTheDocument();
  });
});
