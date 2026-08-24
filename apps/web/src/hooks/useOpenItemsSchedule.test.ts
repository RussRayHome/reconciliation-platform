// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useOpenItemsSchedule } from './useOpenItemsSchedule';
import { listOpenItemsScheduleRequest, type OpenItemScheduleRow } from '../lib/api';

vi.mock('../lib/api', () => ({
  listOpenItemsScheduleRequest: vi.fn(),
}));

const mockListItems = vi.mocked(listOpenItemsScheduleRequest);

const buildItem = (overrides: Partial<OpenItemScheduleRow> = {}): OpenItemScheduleRow => ({
  id: 'item-1',
  accountIdentifier: 'OPERATING-001',
  sourceSystem: 'gl',
  category: 'OutstandingCheck',
  status: 'OPEN',
  naturalKey: 'check:OPERATING-001:1001',
  naturalKeyTier: 1,
  originalTransactionDate: '2026-01-05',
  amount: -250,
  checkNumber: '1001',
  ageInDays: 45,
  ...overrides,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useOpenItemsSchedule', () => {
  it('loads items for the given filters', async () => {
    mockListItems.mockResolvedValue([buildItem()]);

    const { result } = renderHook(() =>
      useOpenItemsSchedule({ accountId: 'OPERATING-001', status: 'OPEN' }),
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockListItems).toHaveBeenCalledWith({ accountId: 'OPERATING-001', status: 'OPEN' });
    expect(result.current.items).toEqual([buildItem()]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a request failure as an error message', async () => {
    mockListItems.mockRejectedValue(new Error('server exploded'));

    const { result } = renderHook(() => useOpenItemsSchedule({}));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('server exploded');
    expect(result.current.items).toEqual([]);
  });

  it('refetches when the status filter changes', async () => {
    mockListItems.mockResolvedValueOnce([buildItem({ status: 'OPEN' })]);

    const { result, rerender } = renderHook(
      ({ status }) => useOpenItemsSchedule({ accountId: 'OPERATING-001', status }),
      { initialProps: { status: 'OPEN' as string | undefined } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([buildItem({ status: 'OPEN' })]);

    mockListItems.mockResolvedValueOnce([buildItem({ status: 'CLEARED' })]);
    rerender({ status: 'CLEARED' });

    await waitFor(() =>
      expect(result.current.items).toEqual([buildItem({ status: 'CLEARED' })]),
    );
    expect(mockListItems).toHaveBeenCalledTimes(2);
  });
});
