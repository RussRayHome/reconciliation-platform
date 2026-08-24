// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { computePriorPeriod, usePriorPeriodRollforward } from './usePriorPeriodRollforward';
import {
  getReconciliationRunRollforwardRequest,
  listReconciliationRunsRequest,
  type ReconciliationRunListItem,
  type ReconciliationRunRollforwardSnapshot,
} from '../lib/api';

vi.mock('../lib/api', () => ({
  listReconciliationRunsRequest: vi.fn(),
  getReconciliationRunRollforwardRequest: vi.fn(),
}));

const mockListRuns = vi.mocked(listReconciliationRunsRequest);
const mockGetRollforward = vi.mocked(getReconciliationRunRollforwardRequest);

const buildRunListItem = (
  overrides: Partial<ReconciliationRunListItem> = {},
): ReconciliationRunListItem => ({
  id: 'run-feb',
  label: 'February 2026',
  accountIdentifier: 'OPERATING-001',
  frequency: 'MONTHLY',
  periodYear: 2026,
  periodMonth: 2,
  periodEnd: '2026-02-28',
  status: 'CLOSED',
  createdAt: '2026-03-01T00:00:00.000Z',
  ...overrides,
});

const buildSnapshot = (
  overrides: Partial<ReconciliationRunRollforwardSnapshot> = {},
): ReconciliationRunRollforwardSnapshot => ({
  accountId: 'account-1',
  accountIdentifier: 'OPERATING-001',
  openingCount: 0,
  openingAmount: 0,
  newCount: 1,
  newAmount: -125.5,
  clearedCount: 0,
  clearedAmount: 0,
  writtenOffCount: 0,
  writtenOffAmount: 0,
  closingCount: 1,
  closingAmount: -125.5,
  ...overrides,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('computePriorPeriod', () => {
  it('rolls back one month for MONTHLY', () => {
    expect(computePriorPeriod(2026, 3, 'MONTHLY')).toEqual({ periodYear: 2026, periodMonth: 2 });
  });

  it('rolls back into the prior year in January', () => {
    expect(computePriorPeriod(2026, 1, 'MONTHLY')).toEqual({ periodYear: 2025, periodMonth: 12 });
  });

  it('rolls back one year for ANNUAL, with no periodMonth', () => {
    expect(computePriorPeriod(2026, null, 'ANNUAL')).toEqual({
      periodYear: 2025,
      periodMonth: undefined,
    });
  });
});

describe('usePriorPeriodRollforward', () => {
  it('stays idle when the account/period inputs are not yet known', () => {
    const { result } = renderHook(() =>
      usePriorPeriodRollforward({
        accountIdentifier: undefined,
        periodYear: undefined,
        periodMonth: undefined,
        frequency: undefined,
      }),
    );

    expect(result.current).toEqual({ status: 'idle', data: null });
    expect(mockListRuns).not.toHaveBeenCalled();
  });

  it('loads the prior period\'s closed snapshot', async () => {
    mockListRuns.mockResolvedValue([buildRunListItem()]);
    mockGetRollforward.mockResolvedValue({ snapshots: [buildSnapshot()] });

    const { result } = renderHook(() =>
      usePriorPeriodRollforward({
        accountIdentifier: 'OPERATING-001',
        periodYear: 2026,
        periodMonth: 3,
        frequency: 'MONTHLY',
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('loaded'));

    expect(mockListRuns).toHaveBeenCalledWith({
      accountId: 'OPERATING-001',
      periodYear: 2026,
      periodMonth: 2,
    });
    expect(mockGetRollforward).toHaveBeenCalledWith('run-feb');
    expect(result.current.data).toEqual({
      periodLabel: 'February 2026',
      snapshots: [buildSnapshot()],
    });
  });

  it('resolves to none when no run exists for the prior period', async () => {
    mockListRuns.mockResolvedValue([]);

    const { result } = renderHook(() =>
      usePriorPeriodRollforward({
        accountIdentifier: 'OPERATING-001',
        periodYear: 2026,
        periodMonth: 3,
        frequency: 'MONTHLY',
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('none'));
    expect(mockGetRollforward).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('resolves to none when the prior run exists but was never closed (no snapshot)', async () => {
    mockListRuns.mockResolvedValue([buildRunListItem({ status: 'RECONCILED' })]);
    mockGetRollforward.mockResolvedValue({ snapshots: [] });

    const { result } = renderHook(() =>
      usePriorPeriodRollforward({
        accountIdentifier: 'OPERATING-001',
        periodYear: 2026,
        periodMonth: 3,
        frequency: 'MONTHLY',
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('none'));
    expect(result.current.data).toBeNull();
  });

  it('resolves to error when the lookup fails', async () => {
    mockListRuns.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() =>
      usePriorPeriodRollforward({
        accountIdentifier: 'OPERATING-001',
        periodYear: 2026,
        periodMonth: 3,
        frequency: 'MONTHLY',
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeNull();
  });
});
