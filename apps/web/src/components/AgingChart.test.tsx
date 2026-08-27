// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { AgingChart } from './AgingChart';

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
  Bar: ({ fill }: { fill: string }) => <div data-testid="bar" data-fill={fill} />,
}));

afterEach(cleanup);

describe('AgingChart', () => {
  it('renders the title as a heading and every band in the table, including zero-count bands', () => {
    render(
      <AgingChart
        title="Outstanding Check Aging"
        data={[
          { label: '0-5 days', value: 5 },
          { label: '6-30 days', value: 0 },
          { label: '31-44 days', value: 3 },
          { label: '45+ days', value: 5 },
        ]}
        hue="bank"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Outstanding Check Aging' })).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    // header row + 4 data rows
    expect(rows).toHaveLength(5);
    expect(screen.getByText('6-30 days')).toBeInTheDocument();
  });

  it('renders the band table directly in the panel, not behind a <details> disclosure', () => {
    const { container } = render(
      <AgingChart title="Outstanding Check Aging" data={[{ label: '0-5 days', value: 1 }]} hue="bank" />,
    );

    // No accessible-query equivalent for "assert this tag is absent anywhere in the tree".
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders an empty-but-valid state when no items are aged', () => {
    render(<AgingChart title="Outstanding Check Aging" data={[]} hue="bank" />);

    expect(screen.getByRole('heading', { name: 'Outstanding Check Aging' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(1); // header row only
  });

  it('renders payable bands with the AP hue when given the AP domain', () => {
    render(<AgingChart title="Payable Aging" data={[{ label: '0-5 days', value: 2 }]} hue="ap" />);

    expect(screen.getByTestId('bar')).toHaveAttribute('data-fill', 'var(--ap)');
  });

  it('uses the bank hue when given the bank domain', () => {
    render(<AgingChart title="Outstanding Check Aging" data={[{ label: '0-5 days', value: 2 }]} hue="bank" />);

    expect(screen.getByTestId('bar')).toHaveAttribute('data-fill', 'var(--bank)');
  });

  it('states the active threshold when the caller composes it into the title', () => {
    // AgingChart itself is threshold-agnostic (bands are computed by the caller); this confirms
    // the title prop is rendered verbatim, which is how a caller states an active threshold.
    render(<AgingChart title="Open payable aging — stale at 45 days" data={[]} hue="ap" />);

    expect(
      screen.getByRole('heading', { name: 'Open payable aging — stale at 45 days' }),
    ).toBeInTheDocument();
  });
});
