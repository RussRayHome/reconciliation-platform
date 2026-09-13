// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type * as ApiModule from '../lib/api';

const mocked = vi.hoisted(() => ({
  listReplayPeriodsRequest: vi.fn<typeof ApiModule.listReplayPeriodsRequest>(),
  getReplayEstimateRequest: vi.fn<typeof ApiModule.getReplayEstimateRequest>(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../lib/api');
  return {
    ...actual,
    listReplayPeriodsRequest: mocked.listReplayPeriodsRequest,
    getReplayEstimateRequest: mocked.getReplayEstimateRequest,
  };
});

const { ReplayEstimatePanel } = await import('./ReplayEstimatePanel');
const { ReplayUnavailableError } = await import('../lib/api');

const period = (over: Partial<ApiModule.ReplayablePeriodItem> = {}) => ({
  runId: 'run-aug',
  matchingJobId: 'job-aug',
  label: 'August 2026',
  accountIdentifier: 'OPERATING-001',
  frequency: 'MONTHLY',
  periodYear: 2026,
  periodMonth: 8,
  closedAt: '2026-09-03T00:00:00.000Z',
  hasEstimate: false,
  ...over,
});

const estimate = (over: Partial<ApiModule.ReplayEstimateItem> = {}) => ({
  matchingConfigVersionId: 'v13',
  replayedRunId: 'run-aug',
  exceptionsDelta: -12,
  probableMatchesDelta: 3,
  unresolvedExposureDelta: '-4120.0000',
  engineBuild: 'abc123',
  computedAt: '2026-09-12T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  mocked.listReplayPeriodsRequest.mockReset();
  mocked.getReplayEstimateRequest.mockReset();
  mocked.listReplayPeriodsRequest.mockResolvedValue([period()]);
  mocked.getReplayEstimateRequest.mockResolvedValue(estimate());
});

afterEach(() => {
  cleanup();
});

describe('ReplayEstimatePanel (ADR-0018, #533)', () => {
  it('states the three deltas in the direction the approver reads them', async () => {
    render(<ReplayEstimatePanel versionId="v13" />);

    expect(await screen.findByText('12 fewer exceptions')).toBeInTheDocument();
    expect(screen.getByText('3 more probable matches')).toBeInTheDocument();
    expect(screen.getByText(/less exposure/)).toBeInTheDocument();
  });

  // The sign convention is draft-minus-active, and inverting it would read as an improvement when
  // the draft is worse. A negative exceptions delta must never render as "12 more".
  it('never inverts the sign', async () => {
    mocked.getReplayEstimateRequest.mockResolvedValue(
      estimate({ exceptionsDelta: 12, probableMatchesDelta: -3, unresolvedExposureDelta: '4120.0000' }),
    );
    render(<ReplayEstimatePanel versionId="v13" />);

    expect(await screen.findByText('12 more exceptions')).toBeInTheDocument();
    expect(screen.getByText('3 fewer probable matches')).toBeInTheDocument();
    expect(screen.getByText(/more exposure/)).toBeInTheDocument();
  });

  it('names the period it replayed, so the reader can see it is history', async () => {
    render(<ReplayEstimatePanel versionId="v13" />);

    expect(await screen.findByText(/Against/)).toBeInTheDocument();
    expect(screen.getByText('August 2026')).toBeInTheDocument();
  });

  // The two empty states are different statements and must not look alike.
  it('says there is nothing to replay against, rather than showing zeros', async () => {
    mocked.listReplayPeriodsRequest.mockResolvedValue([]);
    render(<ReplayEstimatePanel versionId="v13" />);

    expect(await screen.findByText(/No closed period yet/)).toBeInTheDocument();
    expect(screen.queryByText(/fewer|more/)).toBeNull();
    expect(mocked.getReplayEstimateRequest).not.toHaveBeenCalled();
  });

  it('distinguishes a replay that found no difference from one that could not run', async () => {
    mocked.getReplayEstimateRequest.mockResolvedValue(
      estimate({ exceptionsDelta: 0, probableMatchesDelta: 0, unresolvedExposureDelta: '0.0000' }),
    );
    render(<ReplayEstimatePanel versionId="v13" />);

    expect(await screen.findByText('No measurable difference against this period.')).toBeInTheDocument();
    expect(screen.queryByText(/No closed period yet/)).toBeNull();
  });

  // 422 is a real answer, not a transport failure: the version and the period both exist and the
  // replay cannot run. The reason is stated rather than rendered as zeros.
  it('states the reason when the period cannot be replayed', async () => {
    mocked.getReplayEstimateRequest.mockRejectedValue(
      new ReplayUnavailableError('That period has no retained transactions.', 'no-records'),
    );
    render(<ReplayEstimatePanel versionId="v13" />);

    expect(await screen.findByText('That period has no retained transactions.')).toBeInTheDocument();
    expect(screen.queryByText(/fewer|more/)).toBeNull();
  });

  it('replays the period the approver picks', async () => {
    const user = userEvent.setup();
    mocked.listReplayPeriodsRequest.mockResolvedValue([
      period(),
      period({ runId: 'run-jul', label: 'July 2026', matchingJobId: 'job-jul' }),
    ]);
    render(<ReplayEstimatePanel versionId="v13" />);

    await screen.findByText('12 fewer exceptions');
    await user.selectOptions(screen.getByLabelText('Period to replay against'), 'run-jul');

    await waitFor(() => {
      expect(mocked.getReplayEstimateRequest).toHaveBeenCalledWith('v13', 'run-jul');
    });
  });

  it('defaults to the most recently closed period the endpoint returned first', async () => {
    mocked.listReplayPeriodsRequest.mockResolvedValue([
      period({ runId: 'run-newest', label: 'August 2026' }),
      period({ runId: 'run-older', label: 'July 2026' }),
    ]);
    render(<ReplayEstimatePanel versionId="v13" />);

    await waitFor(() => {
      expect(mocked.getReplayEstimateRequest).toHaveBeenCalledWith('v13', 'run-newest');
    });
  });
});

/**
 * The copy guard. "Estimate" is load-bearing: this is a dry run against historical data, which
 * carries different transactions from the next run. A reader must not be able to take it as a
 * prediction, and a percentage would additionally imply a calibrated likelihood nothing computes --
 * the same rule `matchConfidenceBands.test.ts` enforces for the band copy.
 */
describe('the panel cannot read as a forecast', () => {
  const source = readFileSync(join(__dirname, 'ReplayEstimatePanel.tsx'), 'utf-8');
  const prose = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('shows no percentage anywhere', () => {
    expect(prose).not.toMatch(/\d\s*%|%\s*\{/);
  });

  it('makes no promise about the next run', () => {
    // "will produce", "expect", "predicted", "projected" -- each would convert a dry run against
    // last month into a claim about next month.
    expect(prose).not.toMatch(/\bwill produce\b|\bpredict\w*\b|\bproject(?:ed|ion)\b|\bforecast\w*\b/i);
  });

  it('says outright that it is not a statement about the next run', () => {
    expect(prose).toContain('not what the next run will');
  });
});
