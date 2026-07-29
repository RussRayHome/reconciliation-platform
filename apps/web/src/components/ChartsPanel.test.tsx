// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SummaryMetrics } from '@recon/domain';

import { ChartsPanel } from './ChartsPanel';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Bar: () => <div data-testid="bar" />,
}));

const createSummary = (charts: SummaryMetrics['charts']): SummaryMetrics => ({
  totalRecordsReviewed: 12,
  bankRecords: 6,
  qboRecords: 6,
  exactMatches: 4,
  probableMatches: 1,
  unmatchedItems: 2,
  duplicates: 1,
  bankDuplicates: 1,
  qboDuplicates: 0,
  dateVariances: 1,
  timingDifferences: 0,
  dataQualityIssues: 0,
  amountMismatches: 0,
  missingFromBank: 1,
  missingFromQBO: 1,
  unmatchedBankNetAmount: 125.5,
  unmatchedQboNetAmount: 88,
  cleanMatchedAmount: 600,
  unresolvedExposure: 213.5,
  countsByCategory: {},
  amountByCategory: {},
  charts,
});

describe('ChartsPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders chart data tables and formats exposure values to two decimals', () => {
    render(
      <ChartsPanel
        summary={createSummary([
          {
            id: 'countByCategory',
            title: 'Counts',
            data: [{ label: 'Missing from QBO', value: 2 }],
          },
          {
            id: 'exposureByCategory',
            title: 'Exposure',
            data: [{ label: 'Timing Difference', value: 125.5 }],
          },
        ])}
      />,
    );

    expect(screen.getByText('Counts by Category')).toBeInTheDocument();
    expect(screen.getByText('Dollar Exposure by Category')).toBeInTheDocument();
    expect(screen.getByText('Missing from QBO')).toBeInTheDocument();
    expect(screen.getByText('Timing Difference')).toBeInTheDocument();
    expect(screen.getByText('$125.50')).toBeInTheDocument();
  });

  it('renders empty chart tables safely when expected chart series are missing', () => {
    render(<ChartsPanel summary={createSummary([])} />);

    expect(screen.getByText('Counts by Category')).toBeInTheDocument();
    expect(screen.getByText('Dollar Exposure by Category')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Count' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Exposure' })).toBeInTheDocument();
    expect(screen.queryByText('Missing from QBO')).toBeNull();
  });
});
