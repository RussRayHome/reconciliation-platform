// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OpenItemsScheduleSection } from './OpenItemsScheduleSection';
import { useOpenItemsSchedule } from '../hooks/useOpenItemsSchedule';
import type { OpenItemScheduleRow } from '../lib/api';

vi.mock('../hooks/useOpenItemsSchedule', () => ({
  useOpenItemsSchedule: vi.fn(),
}));

const mockUseOpenItemsSchedule = vi.mocked(useOpenItemsSchedule);

const itemAtAge = (ageInDays: number): OpenItemScheduleRow => ({
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
  ageInDays,
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OpenItemsScheduleSection', () => {
  it('shows a loading message while the schedule is loading', () => {
    mockUseOpenItemsSchedule.mockReturnValue({ items: [], isLoading: true, error: null });

    render(<OpenItemsScheduleSection username="rray" />);

    expect(screen.getByText(/loading open items/i)).toBeInTheDocument();
  });

  it('shows the error message when the fetch fails', () => {
    mockUseOpenItemsSchedule.mockReturnValue({
      items: [],
      isLoading: false,
      error: 'Unable to load the open-items schedule.',
    });

    render(<OpenItemsScheduleSection username="rray" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the open-items schedule.');
  });

  it('shows an empty-state message when nothing matches the filter', () => {
    mockUseOpenItemsSchedule.mockReturnValue({ items: [], isLoading: false, error: null });

    render(<OpenItemsScheduleSection username="rray" />);

    expect(screen.getByText(/no open items match this filter/i)).toBeInTheDocument();
  });

  it('renders one row per item, with age, aging bucket reflecting the page threshold, and an "Unassigned" owner', () => {
    mockUseOpenItemsSchedule.mockReturnValue({
      items: [itemAtAge(45)],
      isLoading: false,
      error: null,
    });

    render(<OpenItemsScheduleSection accountIdentifier="OPERATING-001" username="rray" />);

    expect(screen.getByText('OPERATING-001')).toBeInTheDocument();
    expect(screen.getByText('1001')).toBeInTheDocument();
    expect(screen.getByText('45d')).toBeInTheDocument();
    // Default threshold is 45-day Monthly -- bands 0-5/6-30/31-44/45+, so age 45 is the final,
    // open-ended band, not the old fixed-bucket scheme's "31-60 days".
    expect(screen.getByText('45+ days')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('states the active threshold in the Aging Bucket column header', () => {
    mockUseOpenItemsSchedule.mockReturnValue({
      items: [itemAtAge(10)],
      isLoading: false,
      error: null,
    });

    render(<OpenItemsScheduleSection username="rray" />);

    expect(screen.getByRole('columnheader', { name: 'Aging Bucket (45d)' })).toBeInTheDocument();
  });

  it('re-bands the Aging Bucket column when the threshold changes, without mutating age or amount', async () => {
    const user = userEvent.setup();
    mockUseOpenItemsSchedule.mockReturnValue({
      items: [itemAtAge(45)],
      isLoading: false,
      error: null,
    });

    render(<OpenItemsScheduleSection username="rray" />);

    expect(screen.getByText('45+ days')).toBeInTheDocument();
    expect(screen.getByText('45d')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Aging threshold'), '90');

    expect(screen.getByRole('columnheader', { name: 'Aging Bucket (90d)' })).toBeInTheDocument();
    // Under a 90-day Monthly threshold, age 45 now falls inside a closed band, not the open one.
    expect(screen.queryByText('45+ days')).not.toBeInTheDocument();
    // The underlying age and amount are untouched -- only which band it's shown in changed.
    expect(screen.getByText('45d')).toBeInTheDocument();
    expect(screen.getByText('($250.00)')).toBeInTheDocument();
  });

  it('persists the threshold across mounts for the same user', async () => {
    const user = userEvent.setup();
    mockUseOpenItemsSchedule.mockReturnValue({
      items: [itemAtAge(10)],
      isLoading: false,
      error: null,
    });

    const { unmount } = render(<OpenItemsScheduleSection username="rray" />);
    await user.selectOptions(screen.getByLabelText('Aging threshold'), '60');
    expect(screen.getByRole('columnheader', { name: 'Aging Bucket (60d)' })).toBeInTheDocument();
    unmount();

    render(<OpenItemsScheduleSection username="rray" />);
    expect(screen.getByRole('columnheader', { name: 'Aging Bucket (60d)' })).toBeInTheDocument();
  });

  it('keeps Due Date as Not set for check items', () => {
    mockUseOpenItemsSchedule.mockReturnValue({
      items: [itemAtAge(10)],
      isLoading: false,
      error: null,
    });

    render(<OpenItemsScheduleSection username="rray" />);

    expect(screen.getByText('Not set')).toBeInTheDocument();
  });
});
