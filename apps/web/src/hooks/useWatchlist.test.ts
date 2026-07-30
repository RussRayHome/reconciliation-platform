// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useWatchlist } from './useWatchlist';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWatchlist', () => {
  it('starts empty when runId is undefined and toggleStar is a no-op', () => {
    const { result } = renderHook(() => useWatchlist(undefined));

    expect(result.current.starredIds).toEqual([]);

    act(() => {
      result.current.toggleStar('exception-1');
    });

    expect(result.current.starredIds).toEqual([]);
  });

  it('loads previously starred ids for a run from localStorage', () => {
    localStorage.setItem(
      'reconciliation-platform:watchlist:run-1',
      JSON.stringify(['exception-1', 'exception-2']),
    );

    const { result } = renderHook(() => useWatchlist('run-1'));

    expect(result.current.starredIds).toEqual(['exception-1', 'exception-2']);
  });

  it('treats missing, malformed, or non-array stored values as empty', () => {
    const { result: missing } = renderHook(() => useWatchlist('run-missing'));
    expect(missing.current.starredIds).toEqual([]);

    localStorage.setItem('reconciliation-platform:watchlist:run-malformed', '{not-json');
    const { result: malformed } = renderHook(() => useWatchlist('run-malformed'));
    expect(malformed.current.starredIds).toEqual([]);

    localStorage.setItem(
      'reconciliation-platform:watchlist:run-object',
      JSON.stringify({ not: 'an array' }),
    );
    const { result: notArray } = renderHook(() => useWatchlist('run-object'));
    expect(notArray.current.starredIds).toEqual([]);
  });

  it('filters non-string entries out of a stored array', () => {
    localStorage.setItem(
      'reconciliation-platform:watchlist:run-mixed',
      JSON.stringify(['exception-1', 42, null, 'exception-2']),
    );

    const { result } = renderHook(() => useWatchlist('run-mixed'));

    expect(result.current.starredIds).toEqual(['exception-1', 'exception-2']);
  });

  it('adds and removes ids, persisting to localStorage under a per-run key', () => {
    const { result } = renderHook(() => useWatchlist('run-2'));

    act(() => {
      result.current.toggleStar('exception-1');
    });
    expect(result.current.starredIds).toEqual(['exception-1']);
    expect(
      JSON.parse(localStorage.getItem('reconciliation-platform:watchlist:run-2') ?? '[]'),
    ).toEqual(['exception-1']);

    act(() => {
      result.current.toggleStar('exception-1');
    });
    expect(result.current.starredIds).toEqual([]);
  });

  it('reloads starred ids from storage when runId changes', () => {
    localStorage.setItem(
      'reconciliation-platform:watchlist:run-a',
      JSON.stringify(['exception-a']),
    );
    localStorage.setItem(
      'reconciliation-platform:watchlist:run-b',
      JSON.stringify(['exception-b']),
    );

    const { result, rerender } = renderHook(({ runId }) => useWatchlist(runId), {
      initialProps: { runId: 'run-a' as string | undefined },
    });

    expect(result.current.starredIds).toEqual(['exception-a']);

    rerender({ runId: 'run-b' });
    expect(result.current.starredIds).toEqual(['exception-b']);

    rerender({ runId: undefined });
    expect(result.current.starredIds).toEqual([]);
  });

  it('keeps in-memory state authoritative when persistence throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const { result } = renderHook(() => useWatchlist('run-3'));

    act(() => {
      result.current.toggleStar('exception-1');
    });

    expect(result.current.starredIds).toEqual(['exception-1']);
  });
});
