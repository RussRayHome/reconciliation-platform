// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import * as api from '../lib/api';
import { useSubledgerEntityCounts } from './useSubledgerEntityCounts';

afterEach(() => {
  vi.restoreAllMocks();
});

const entities = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `e${index}` })) as never;

describe('useSubledgerEntityCounts', () => {
  it('reads both registries once, active-only', async () => {
    const list = vi.spyOn(api, 'listSubledgerEntitiesRequest').mockResolvedValue(entities(2));

    const { result, rerender } = renderHook(() => useSubledgerEntityCounts());
    await waitFor(() => expect(result.current.ap).toBe(2));

    // #400's whole reason for existing as a hook: the rail renders on every in-app screen, so a
    // fetch that re-ran on each render would put two requests behind every click. Re-rendering
    // must not refetch.
    rerender();
    rerender();

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledWith('ap', { activeOnly: true });
    expect(list).toHaveBeenCalledWith('ar', { activeOnly: true });
  });

  it('keeps one registry\'s count when the other fails', async () => {
    vi.spyOn(api, 'listSubledgerEntitiesRequest').mockImplementation((kind) =>
      kind === 'ap' ? Promise.resolve(entities(3)) : Promise.reject(new Error('boom')),
    );

    const { result } = renderHook(() => useSubledgerEntityCounts());

    // allSettled, not all -- AR being unreadable is not a reason to stop telling the user about AP.
    await waitFor(() => expect(result.current.ap).toBe(3));
    expect(result.current.ar).toBeNull();
  });

  it('reports an unreadable registry as null, never as zero', async () => {
    vi.spyOn(api, 'listSubledgerEntitiesRequest').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useSubledgerEntityCounts());

    // Both render no badge, but only one of them is a fact about the organization: 0 says "none
    // registered", null says "we could not ask". Collapsing them would let a failed fetch look
    // like an empty registry.
    await waitFor(() => expect(result.current).toEqual({ ap: null, ar: null }));
  });
});
