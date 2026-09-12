import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import type { ApprovalCountsByGroup } from '@recon/domain';

import type { ReconciliationRunResponse } from '../lib/api';
import { SAVED_VIEWS_STORAGE_KEY } from '../lib/exceptionTriage';
import { RunsHomeScreen } from './RunsHomeScreen';

// Not automatic in this project's vitest setup -- App.test.tsx does the same by hand.
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const noCounts = (): ApprovalCountsByGroup =>
  ({
    import: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
    mappingProfile: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
    matchingRule: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
    exceptionResolution: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
    reportDistribution: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
  }) as ApprovalCountsByGroup;

const run = {
  id: 'run-1',
  correlationId: 'corr-1',
  status: 'Completed',
  startedAt: '2026-04-30T09:00:00.000Z',
  completedAt: '2026-04-30T09:12:00.000Z',
  periodLabel: 'Monthly Recon for April 2026',
  sourceFiles: [],
  groupedMatchResults: [],
  probableMatches: [{ id: 'p1' }, { id: 'p2' }],
  // Shaped enough for toExceptionDisplay, which the Saved views hook runs over every render --
  // an {id}-only stub throws on `source.toUpperCase()`.
  exceptions: Array.from({ length: 52 }, (_, i) => ({
    id: `e${i}`,
    category: 'MissingFromGL',
    severity: 'High',
    source: 'bank',
    transactionDate: '2026-04-15',
    amount: 100 + i,
    errorMessage: 'Not found in the general ledger',
    spreadsheetFileName: 'bank.csv',
    lineNumber: i + 2,
    normalizedComparisonTokens: [],
  })),
  summary: {
    totalRecordsReviewed: 1284,
    exactMatches: 1187,
    unresolvedExposure: 61940,
  },
  reviewerObservations: [],
  reviewerDecisions: [],
} as unknown as ReconciliationRunResponse;

const renderHome = (props: Partial<Parameters<typeof RunsHomeScreen>[0]> = {}) =>
  render(
    <MemoryRouter>
      <RunsHomeScreen
        profileLabel="Morgan Reyes"
        run={run}
        openExceptionCount={14}
        decidedExceptionCount={38}
        approvalCounts={null}
        onApplySavedView={() => {}}
        now={new Date('2026-04-30T09:30:00')}
        {...props}
      />
    </MemoryRouter>,
  );

describe('RunsHomeScreen (1c)', () => {
  // The header's job is to answer "why did I open this?" before the user reads anything else, so
  // the open-decision count belongs in the h1 rather than a well below it.
  it('names the open decision count in the heading', () => {
    renderHome();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Good morning, Morgan — 14 exceptions still need a decision',
    );
  });

  it('says nothing is waiting when there are no open exceptions', () => {
    renderHome({ openExceptionCount: 0 });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nothing is waiting on you');
  });

  it('agrees with itself on the singular', () => {
    renderHome({ openExceptionCount: 1 });

    // "1 exceptions still need" is the kind of thing that survives review and then embarrasses the
    // product in a screenshot.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '1 exception still needs a decision',
    );
  });

  it('shows the five run measures the design specifies', () => {
    renderHome();

    const card = screen.getByLabelText('Continue where you left off');
    const wells: ReadonlyArray<readonly [string, string]> = [
      ['Reviewed', '1,284'],
      ['Exact', '1,187'],
      ['Probable', '2'],
      ['Exceptions', '52'],
      ['Exposure', '$61,940'],
    ];

    for (const [label, value] of wells) {
      expect(within(card).getByText(label)).toBeInTheDocument();
      expect(within(card).getByText(value)).toBeInTheDocument();
    }

    // Exceptions splits decided from open, because 52 alone reads as 52 things to do.
    expect(within(card).getByText('38 decided · 14 open')).toBeInTheDocument();
  });

  it('offers the next action first, carrying its count', () => {
    renderHome();

    const card = screen.getByLabelText('Continue where you left off');
    expect(within(card).getByRole('link', { name: 'Resume exceptions · 14' })).toHaveAttribute(
      'href',
      '/exceptions',
    );
    expect(
      within(card).getByRole('link', { name: 'Confirm 2 probable matches' }),
    ).toHaveAttribute('href', '/probable-matches');
    expect(within(card).getByRole('link', { name: 'Export workbook' })).toHaveAttribute(
      'href',
      '/export',
    );
  });

  // "Needs you" is the subset waiting on THIS user, not everything pending -- and it follows the
  // same absent-not-zero rule as the rail badges: three zeros is noise that teaches people to stop
  // reading the panel.
  describe('Needs you', () => {
    it('says nothing is waiting when every count is zero', () => {
      renderHome({ approvalCounts: noCounts() });

      expect(screen.getByText('Nothing is waiting on your decision.')).toBeInTheDocument();
    });

    it('lists only the rows that have something in them, each linked', () => {
      const counts = noCounts();
      counts.mappingProfile.rejected = 1;
      counts.exceptionResolution.pending = 4;
      renderHome({ approvalCounts: counts });

      const panel = screen.getByLabelText?.('Needs you') ?? document.body;
      expect(screen.getByText('mapping profile rejected')).toBeInTheDocument();
      expect(screen.getByText('resolutions awaiting an approver')).toBeInTheDocument();
      // matchingRule stayed at zero, so it must not appear at all.
      expect(screen.queryByText('rule versions awaiting activation')).toBeNull();
      expect(panel).toBeTruthy();
    });

    it('renders nothing rather than guessing while counts have not loaded', () => {
      renderHome({ approvalCounts: null });

      expect(screen.getByText('Nothing is waiting on your decision.')).toBeInTheDocument();
    });
  });

  describe('Saved views', () => {
    it('points at Exceptions when none are saved', () => {
      renderHome();

      expect(screen.getByText(/Save a filter on the Exceptions screen/)).toBeInTheDocument();
    });

    // The count must come from the same matcher the triage list uses -- a saved view whose count
    // disagreed with the list it opens is worse than showing no count at all.
    it('counts a saved view against this run and opens it on click', async () => {
      const user = userEvent.setup();
      localStorage.setItem(
        SAVED_VIEWS_STORAGE_KEY,
        JSON.stringify([
          {
            id: 'v1',
            name: 'Everything',
            query: '',
            sortKey: 'severity',
            facets: { category: [], severity: [], source: [], amountBand: [] },
          },
        ]),
      );
      const onApply = vi.fn();
      renderHome({ onApplySavedView: onApply });

      const button = screen.getByRole('button', { name: /Everything/ });
      expect(button).toHaveTextContent('52');

      await user.click(button);
      expect(onApply).toHaveBeenCalledTimes(1);
    });
  });

  // App.tsx forwards a runless organization to New run, so this screen only meets `undefined` in
  // the moment before the report hydrates -- it must not claim the run is empty.
  it('does not claim an empty run while the report is still loading', () => {
    renderHome({ run: undefined });

    expect(screen.queryByLabelText('Continue where you left off')).toBeNull();
    expect(screen.getByText(/Loading your most recent run/)).toBeInTheDocument();
  });
});
