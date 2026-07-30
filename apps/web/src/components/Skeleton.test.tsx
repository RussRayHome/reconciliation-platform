// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import {
  KpiWellsSkeleton,
  SkeletonBar,
  SkeletonLines,
  SkeletonPanel,
  SummaryDashboardSkeleton,
  TableSkeleton,
  TriageSkeleton,
} from './Skeleton';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SkeletonBar', () => {
  it('applies the given width and height', () => {
    const { container } = render(<SkeletonBar width="40%" height="2rem" />);
    const bar = container.querySelector('.skeleton');

    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect((bar as HTMLElement).style.width).toBe('40%');
    expect((bar as HTMLElement).style.height).toBe('2rem');
  });

  it('defaults height to 0.85rem when not provided', () => {
    const { container } = render(<SkeletonBar />);
    const bar = container.querySelector('.skeleton');

    expect((bar as HTMLElement).style.height).toBe('0.85rem');
  });
});

describe('SkeletonPanel', () => {
  it('announces the label immediately but withholds children until the anti-flash delay elapses', () => {
    render(
      <SkeletonPanel label="Loading repository checks">
        <p>shimmer content</p>
      </SkeletonPanel>,
    );

    expect(screen.getByText('Loading repository checks')).toBeInTheDocument();
    expect(screen.queryByText('shimmer content')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getByText('shimmer content')).toBeInTheDocument();
  });
});

describe('SkeletonLines', () => {
  it('renders `count` bars with the final one narrower than the rest', () => {
    const { container } = render(<SkeletonLines count={3} />);
    const bars = container.querySelectorAll('.skeleton');

    expect(bars).toHaveLength(3);
    expect((bars[0] as HTMLElement).style.width).toBe('100%');
    expect((bars[1] as HTMLElement).style.width).toBe('100%');
    expect((bars[2] as HTMLElement).style.width).toBe('62%');
  });
});

describe('KpiWellsSkeleton', () => {
  it('uses the six-column layout class when six is true', () => {
    const { container } = render(<KpiWellsSkeleton count={6} six />);

    expect(container.querySelector('.kpi-wells.kpi-wells--six')).not.toBeNull();
    expect(container.querySelectorAll('.kpi-well')).toHaveLength(6);
  });

  it('uses the default layout class when six is omitted', () => {
    const { container } = render(<KpiWellsSkeleton count={2} />);

    expect(container.querySelector('.kpi-wells--six')).toBeNull();
    expect(container.querySelectorAll('.kpi-well')).toHaveLength(2);
  });
});

describe('TableSkeleton', () => {
  it('renders a header row plus the requested body rows and columns', () => {
    const { container } = render(<TableSkeleton rows={2} columns={4} />);

    const rows = container.querySelectorAll('.skeleton-table__row');
    expect(rows).toHaveLength(3); // 1 header + 2 body rows
    expect(rows[1]?.querySelectorAll('.skeleton')).toHaveLength(4);
  });
});

describe('TriageSkeleton', () => {
  it('defaults to 8 rows when not specified', () => {
    const { container } = render(<TriageSkeleton />);
    expect(container.querySelectorAll('.skeleton-triage__row')).toHaveLength(8);
  });

  it('honors an explicit row count', () => {
    const { container } = render(<TriageSkeleton rows={3} />);
    expect(container.querySelectorAll('.skeleton-triage__row')).toHaveLength(3);
  });
});

describe('SummaryDashboardSkeleton', () => {
  it('renders the bento module titles for the summary stand-in', () => {
    render(<SummaryDashboardSkeleton />);

    expect(screen.getByText('Verdict')).toBeInTheDocument();
    expect(screen.getByText('Match quality')).toBeInTheDocument();
    expect(screen.getByText('Materiality')).toBeInTheDocument();
    expect(screen.getByText('Exposure by category')).toBeInTheDocument();
    expect(screen.getByText('Watchlist')).toBeInTheDocument();
  });
});
