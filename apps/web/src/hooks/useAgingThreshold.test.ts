// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useAgingThreshold } from './useAgingThreshold';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAgingThreshold', () => {
  it('defaults to a 45-day Monthly threshold when nothing is stored', () => {
    const { result } = renderHook(() => useAgingThreshold('rray'));

    expect(result.current.setting).toEqual({ thresholdDays: 45, frequency: 'Monthly' });
  });

  it('loads a previously persisted threshold for that user', () => {
    localStorage.setItem(
      'reconciliation-platform:aging-threshold:rray',
      JSON.stringify({ thresholdDays: 90, frequency: 'Annual' }),
    );

    const { result } = renderHook(() => useAgingThreshold('rray'));

    expect(result.current.setting).toEqual({ thresholdDays: 90, frequency: 'Annual' });
  });

  it('treats missing, malformed, or invalid stored values as the default', () => {
    localStorage.setItem('reconciliation-platform:aging-threshold:rray', 'not json');
    expect(renderHook(() => useAgingThreshold('rray')).result.current.setting).toEqual({
      thresholdDays: 45,
      frequency: 'Monthly',
    });

    localStorage.setItem(
      'reconciliation-platform:aging-threshold:rray',
      JSON.stringify({ thresholdDays: 'ninety', frequency: 'Annual' }),
    );
    expect(renderHook(() => useAgingThreshold('rray')).result.current.setting).toEqual({
      thresholdDays: 45,
      frequency: 'Monthly',
    });

    localStorage.setItem(
      'reconciliation-platform:aging-threshold:rray',
      JSON.stringify({ thresholdDays: 90, frequency: 'Weekly' }),
    );
    expect(renderHook(() => useAgingThreshold('rray')).result.current.setting).toEqual({
      thresholdDays: 45,
      frequency: 'Monthly',
    });
  });

  it('persists a new setting and keeps it across a re-render', () => {
    const { result, rerender } = renderHook(() => useAgingThreshold('rray'));

    act(() => {
      result.current.setSetting({ thresholdDays: 60, frequency: 'Annual' });
    });

    expect(result.current.setting).toEqual({ thresholdDays: 60, frequency: 'Annual' });
    expect(localStorage.getItem('reconciliation-platform:aging-threshold:rray')).toBe(
      JSON.stringify({ thresholdDays: 60, frequency: 'Annual' }),
    );

    rerender();
    expect(result.current.setting).toEqual({ thresholdDays: 60, frequency: 'Annual' });
  });

  it('keeps settings scoped per username', () => {
    localStorage.setItem(
      'reconciliation-platform:aging-threshold:bray',
      JSON.stringify({ thresholdDays: 30, frequency: 'Monthly' }),
    );

    const { result } = renderHook(() => useAgingThreshold('rray'));
    expect(result.current.setting).toEqual({ thresholdDays: 45, frequency: 'Monthly' });
  });
});
