// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import type { SummaryMetrics } from '@recon/domain';

import { ProbableMatchesEmptyState } from './ProbableMatchesEmptyState';
import { routePaths } from '../routes/routePaths';

afterEach(cleanup);

const summary = (overrides: Partial<SummaryMetrics> = {}): SummaryMetrics =>
  ({
    totalRecordsReviewed: 1190,
    exactMatches: 1178,
    timingDifferences: 12,
    probableMatches: 0,
    unresolvedExposure: 0,
    ...overrides,
  }) as SummaryMetrics;

const renderState = (metrics: SummaryMetrics = summary()) =>
  render(
    <MemoryRouter>
      <ProbableMatchesEmptyState summary={metrics} />
    </MemoryRouter>,
  );

describe('ProbableMatchesEmptyState (11b, #449)', () => {
  it('says what happened instead of leaving the queue blank', () => {
    renderState();

    expect(screen.getByRole('heading', { name: 'Nothing to confirm' })).toBeInTheDocument();
    expect(screen.getByText('1,178')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  /**
   * The whole reason this screen exists. An analyst about to close cannot distinguish an empty
   * queue from one that failed to populate, so each zero states what it means rather than standing
   * alone.
   */
  it('explains the zero rather than printing it bare', () => {
    renderState();

    const candidates = screen.getByRole('group', { name: 'Candidates' });

    expect(within(candidates).getByText('0')).toBeInTheDocument();
    expect(within(candidates).getByText('nothing scored into a band')).toBeInTheDocument();
  });

  /**
   * `lib/matchConfidenceBands.ts` records the 2026-09-12 finding: `MatchResult.score` tops out at
   * 0.87 for non-exact pairs, so the mock's "78–94% / 95% and over" bands are unbuildable — a ≥95%
   * band would be permanently empty. A number that looks like a probability and is not is worse
   * than no number, so no percentage may appear here.
   */
  it('never shows a percentage or a score threshold', () => {
    const { container } = renderState();

    expect(container.textContent).not.toMatch(/%/);
    expect(container.textContent).not.toMatch(/\b78\b|\b95\b|0\.\d/);
  });

  // "Value at stake" is the money a pending decision could still move. With no candidates it is
  // zero by construction, not by summing an empty list that might one day sum something else.
  it('states that no money is awaiting a decision', () => {
    renderState();

    const stake = screen.getByRole('group', { name: 'Value at stake' });

    expect(within(stake).getByText('$0')).toBeInTheDocument();
    expect(within(stake).getByText('nothing awaiting a decision')).toBeInTheDocument();
  });

  // Relaxing a rule changes the NEXT run. Implying it could rescue this one would send an analyst
  // to the rules screen expecting candidates to appear behind them.
  it('says that loosening the rules applies to the next run, not this one', () => {
    renderState();

    expect(screen.getByText(/does not find matches the engine missed/)).toBeInTheDocument();
    expect(screen.getByText(/applies to the/)).toHaveTextContent(/next/);
  });

  it('offers the rules screen as a real route rather than a dead end', () => {
    renderState();

    expect(screen.getByRole('link', { name: 'Review matching rules' })).toHaveAttribute(
      'href',
      routePaths.mappingRules,
    );
  });

  it('reflects the run it was given rather than fixed copy', () => {
    renderState(summary({ exactMatches: 402, timingDifferences: 0 }));

    expect(screen.getByText('402')).toBeInTheDocument();
    expect(screen.queryByText('1,178')).toBeNull();
  });
});
