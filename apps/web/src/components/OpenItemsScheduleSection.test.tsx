// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { OpenItemsScheduleSection } from './OpenItemsScheduleSection';
import { useOpenItemsSchedule } from '../hooks/useOpenItemsSchedule';
import type { OpenItemScheduleRow } from '../lib/api';

vi.mock('../hooks/useOpenItemsSchedule', () => ({
  useOpenItemsSchedule: vi.fn(),
}));

const mockUseOpenItemsSchedule = vi.mocked(useOpenItemsSchedule);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OpenItemsScheduleSection', () => {
  it('shows a loading message while the schedule is loading', () => {
    mockUseOpenItemsSchedule.mockReturnValue({ items: [], isLoading: true, error: null });

    render(<OpenItemsScheduleSection />);

    expect(screen.getByText(/loading open items/i)).toBeInTheDocument();
  });

  it('shows the error message when the fetch fails', () => {
    mockUseOpenItemsSchedule.mockReturnValue({
      items: [],
      isLoading: false,
      error: 'Unable to load the open-items schedule.',
    });

    render(<OpenItemsScheduleSection />);

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load the open-items schedule.');
  });

  it('shows an empty-state message when nothing matches the filter', () => {
    mockUseOpenItemsSchedule.mockReturnValue({ items: [], isLoading: false, error: null });

    render(<OpenItemsScheduleSection />);

    expect(screen.getByText(/no open items match this filter/i)).toBeInTheDocument();
  });

  it('renders one row per item, with age, aging bucket, and an "Unassigned" owner', () => {
    const items: OpenItemScheduleRow[] = [
      {
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
      },
    ];
    mockUseOpenItemsSchedule.mockReturnValue({ items, isLoading: false, error: null });

    render(<OpenItemsScheduleSection accountIdentifier="OPERATING-001" />);

    expect(screen.getByText('OPERATING-001')).toBeInTheDocument();
    expect(screen.getByText('1001')).toBeInTheDocument();
    expect(screen.getByText('45d')).toBeInTheDocument();
    expect(screen.getByText('31-60 days')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });
});
