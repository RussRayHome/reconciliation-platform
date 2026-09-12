// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MatchResult, ReconciliationRunReport, ReviewerDecision } from '@recon/domain';
import { ReviewSection } from './AppWorkspacePanels';
import userEvent from '@testing-library/user-event';

const buildProbableMatches = (count: number): MatchResult[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `probable-${index + 1}`,
    disposition: 'ProbableMatch',
    confidence: 'Probable',
    ruleName: `Rule ${index + 1}`,
    score: 0.6,
    dateDifferenceDays: index % 3,
    amountDifference: index * 1.25,
    evidence: [`Evidence ${index + 1}`],
    appliedAmountTolerance: 0.05,
  }));

// UI-10 (#449) added a second decision surface for pairings. Inert here -- these tests cover
// rendering and the prior-period slot, not decision flow -- so one shared spread keeps four render
// calls from each growing five props.
const matchDecisionProps = {
  matchDecisionByTargetId: {},
  matchPendingTargetId: null,
  matchDecisionError: null,
  onDecideMatch: () => {},
  onClearMatchDecision: () => {},
} as const;

const buildRun = (probableMatchCount: number): ReconciliationRunReport => ({
  id: 'run-1',
  correlationId: 'corr-1',
  status: 'Completed',
  startedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  completedAt: new Date('2026-01-01T00:05:00.000Z').toISOString(),
  sourceFiles: [
    {
      id: 'bank-1',
      source: 'bank',
      fileName: 'bank.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1234,
      worksheetName: 'Bank',
      headerRow: 1,
      transactionStartRow: 2,
      excludedRowNumbers: [],
      uploadedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    },
    {
      id: 'gl-1',
      source: 'gl',
      fileName: 'gl.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1234,
      worksheetName: 'GL',
      headerRow: 1,
      transactionStartRow: 2,
      excludedRowNumbers: [],
      uploadedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    },
  ],
  groupedMatchResults: [],
  probableMatches: buildProbableMatches(probableMatchCount),
  exceptions: [],
  summary: {
    totalRecordsReviewed: probableMatchCount,
    bankRecords: probableMatchCount,
    glRecords: probableMatchCount,
    exactMatches: 0,
    probableMatches: probableMatchCount,
    unmatchedItems: 0,
    duplicates: 0,
    bankDuplicates: 0,
    glDuplicates: 0,
    dateVariances: 0,
    timingDifferences: 0,
    dataQualityIssues: 0,
    amountMismatches: 0,
    missingFromBank: 0,
    missingFromGL: 0,
    unmatchedBankNetAmount: 0,
    unmatchedGlNetAmount: 0,
    cleanMatchedAmount: 0,
    unresolvedExposure: 0,
    countsByCategory: {},
    amountByCategory: {},
    charts: [
      { id: 'countByCategory', title: 'Counts', data: [] },
      { id: 'exposureByCategory', title: 'Exposure', data: [] },
    ],
    rollForward: {
      openingCount: 0,
      openingAmount: 0,
      newCount: 0,
      newAmount: 0,
      clearedCount: 0,
      clearedAmount: 0,
      writtenOffCount: 0,
      writtenOffAmount: 0,
      closingCount: 0,
      closingAmount: 0,
    },
  },
  reviewerObservations: [],
  reviewerDecisions: [],
});

afterEach(() => {
  cleanup();
});

describe('ReviewSection probable matches performance rendering', () => {
  it('enables virtualization for large probable match result sets', () => {
    const run = buildRun(180);
    const { container } = render(
      <ReviewSection
        {...matchDecisionProps}
        run={run}
        priorPeriodRollforward={{ status: 'idle', data: null }}
        onChangeDensity={() => {}}
        activeView="probable-matches"
        isHydrating={false}
        loadError={null}
        onGoToSetup={() => {}}
        decisionByTargetId={{}}
        pendingTargetId={null}
        decisionError={null}
        lastChange={null}
        onDecide={() => {}}
        onClearDecision={() => {}}
        onUndoLastDecision={() => {}}
        pendingSavedViewId={null}
        onPendingSavedViewApplied={() => {}}
        onOpenExceptions={() => {}}
        starredIds={[]}
        onToggleStar={() => {}}
      />,
    );

    expect(
      screen.getByText('Virtualized view enabled for large probable-match result sets.'),
    ).toBeInTheDocument();
    // Asserting which rendering strategy (virtualized vs. standard table) is active is an
    // implementation detail with no accessible-role distinction to query for.
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    expect(container.querySelector('.probable-match-virtual-list')).not.toBeNull();
  });

  it('keeps standard table rendering for smaller probable match result sets', () => {
    const run = buildRun(16);
    const { container } = render(
      <ReviewSection
        {...matchDecisionProps}
        run={run}
        priorPeriodRollforward={{ status: 'idle', data: null }}
        onChangeDensity={() => {}}
        activeView="probable-matches"
        isHydrating={false}
        loadError={null}
        onGoToSetup={() => {}}
        decisionByTargetId={{}}
        pendingTargetId={null}
        decisionError={null}
        lastChange={null}
        onDecide={() => {}}
        onClearDecision={() => {}}
        onUndoLastDecision={() => {}}
        pendingSavedViewId={null}
        onPendingSavedViewApplied={() => {}}
        onOpenExceptions={() => {}}
        starredIds={[]}
        onToggleStar={() => {}}
      />,
    );

    expect(
      screen.queryByText('Virtualized view enabled for large probable-match result sets.'),
    ).toBeNull();
    // Same reasoning as the virtualized-list assertion above: which rendering strategy is active
    // has no accessible-role distinction to query for.
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    expect(container.querySelector('.probable-match-table-shell__table table')).not.toBeNull();
  });
});

describe('probable match verdicts (UI-10, #449)', () => {
  const verdict = (targetId: string, outcome: ReviewerDecision['outcome']): ReviewerDecision => ({
    id: `decision-${targetId}`,
    runId: 'run-1',
    targetType: 'ProbableMatch',
    targetId,
    outcome,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const renderMatches = (over: Partial<Parameters<typeof ReviewSection>[0]> = {}) => {
    const onDecideMatch = vi.fn();
    const onClearMatchDecision = vi.fn();
    render(
      <ReviewSection
        {...matchDecisionProps}
        onDecideMatch={onDecideMatch}
        onClearMatchDecision={onClearMatchDecision}
        {...over}
        run={buildRun(2)}
        priorPeriodRollforward={{ status: 'idle', data: null }}
        onChangeDensity={() => {}}
        activeView="probable-matches"
        isHydrating={false}
        loadError={null}
        onGoToSetup={() => {}}
        decisionByTargetId={{}}
        pendingTargetId={null}
        decisionError={null}
        lastChange={null}
        onDecide={() => {}}
        onClearDecision={() => {}}
        onUndoLastDecision={() => {}}
        pendingSavedViewId={null}
        onPendingSavedViewApplied={() => {}}
        onOpenExceptions={() => {}}
        starredIds={[]}
        onToggleStar={() => {}}
      />,
    );
    return { onDecideMatch, onClearMatchDecision };
  };

  it('records a confirm against the pairing', async () => {
    const user = userEvent.setup();
    const { onDecideMatch } = renderMatches();

    await user.click(screen.getAllByRole('button', { name: 'Confirm' })[0]!);

    expect(onDecideMatch).toHaveBeenCalledWith('probable-1', 'accept');
  });

  it('records a reject against the pairing', async () => {
    const user = userEvent.setup();
    const { onDecideMatch } = renderMatches();

    await user.click(screen.getAllByRole('button', { name: 'Reject' })[0]!);

    expect(onDecideMatch).toHaveBeenCalledWith('probable-1', 'reject');
  });

  // Clicking the verdict you already gave clears it, so a mis-click is undone in place rather
  // than needing a separate control the design does not have.
  it('clears the verdict when the active one is pressed again', async () => {
    const user = userEvent.setup();
    const { onDecideMatch, onClearMatchDecision } = renderMatches({
      matchDecisionByTargetId: { 'probable-1': verdict('probable-1', 'ApprovedMatch') },
    });

    await user.click(screen.getAllByRole('button', { name: 'Confirm' })[0]!);

    expect(onClearMatchDecision).toHaveBeenCalledWith('probable-1');
    expect(onDecideMatch).not.toHaveBeenCalled();
  });

  it('shows the active verdict as pressed', () => {
    renderMatches({
      matchDecisionByTargetId: { 'probable-1': verdict('probable-1', 'RejectedMatch') },
    });

    expect(screen.getAllByRole('button', { name: 'Reject' })[0]!).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByRole('button', { name: 'Confirm' })[0]!).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  // A save that fails silently would leave the reviewer believing a verdict was recorded.
  it('surfaces a save failure rather than swallowing it', () => {
    renderMatches({ matchDecisionError: 'Unable to save the reviewer decision.' });

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to save the reviewer decision.');
  });

  it('disables the controls for the row being saved', () => {
    renderMatches({ matchPendingTargetId: 'probable-1' });

    expect(screen.getAllByRole('button', { name: 'Confirm' })[0]!).toBeDisabled();
  });
});

describe('Verdict module Prior-period comparison (Unreconciled Item Roll-Forward PR F.3)', () => {
  const renderSummary = (priorPeriodRollforward: Parameters<typeof ReviewSection>[0]['priorPeriodRollforward']) => {
    const run = buildRun(0);
    return render(
      <ReviewSection
        {...matchDecisionProps}
        run={run}
        priorPeriodRollforward={priorPeriodRollforward}
        onChangeDensity={() => {}}
        activeView="summary"
        isHydrating={false}
        loadError={null}
        onGoToSetup={() => {}}
        decisionByTargetId={{}}
        pendingTargetId={null}
        decisionError={null}
        lastChange={null}
        onDecide={() => {}}
        onClearDecision={() => {}}
        onUndoLastDecision={() => {}}
        pendingSavedViewId={null}
        onPendingSavedViewApplied={() => {}}
        onOpenExceptions={() => {}}
        starredIds={[]}
        onToggleStar={() => {}}
      />,
    );
  };

  // UI-10 (#449), screen 7d. A clean run used to say nothing about being clean -- it showed four
  // figures reading zero and left the reader to infer the verdict from them. State it.
  it('states the verdict in words when nothing is unexplained', () => {
    renderSummary({ status: 'idle', data: null });

    expect(screen.getByText(/Fully reconciled/)).toBeInTheDocument();
  });

  // The load-bearing half: claiming "fully reconciled" over a real residual would be the worst
  // possible thing this screen could say, so the absence is asserted as deliberately as the
  // presence. The fixture's residual is 0, hence the explicit override here.
  it('never claims fully reconciled while a residual is unexplained', () => {
    const run = buildRun(0);
    render(
      <ReviewSection
        {...matchDecisionProps}
        run={{ ...run, summary: { ...run.summary, unresolvedExposure: 1250 } }}
        priorPeriodRollforward={{ status: 'idle', data: null }}
        onChangeDensity={() => {}}
        activeView="summary"
        isHydrating={false}
        loadError={null}
        onGoToSetup={() => {}}
        decisionByTargetId={{}}
        pendingTargetId={null}
        decisionError={null}
        lastChange={null}
        onDecide={() => {}}
        onClearDecision={() => {}}
        onUndoLastDecision={() => {}}
        pendingSavedViewId={null}
        onPendingSavedViewApplied={() => {}}
        onOpenExceptions={() => {}}
        starredIds={[]}
        onToggleStar={() => {}}
      />,
    );

    expect(screen.queryByText(/Fully reconciled/)).toBeNull();
  });

  it('shows a loading message while the lookup is in flight', () => {
    renderSummary({ status: 'loading', data: null });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error message when the lookup fails', () => {
    renderSummary({ status: 'error', data: null });
    expect(screen.getByText(/couldn.t load the prior period/i)).toBeInTheDocument();
  });

  it('shows a "no prior period" message when nothing was found', () => {
    renderSummary({ status: 'none', data: null });
    expect(screen.getByText(/no closed prior period found/i)).toBeInTheDocument();
  });

  it('shows the prior period\'s closing figures when loaded', () => {
    renderSummary({
      status: 'loaded',
      data: {
        periodLabel: 'February 2026',
        snapshots: [
          {
            accountId: 'account-1',
            accountIdentifier: 'OPERATING-001',
            openingCount: 0,
            openingAmount: 0,
            newCount: 1,
            newAmount: -125.5,
            clearedCount: 2,
            clearedAmount: -40,
            writtenOffCount: 0,
            writtenOffAmount: 0,
            closingCount: 1,
            closingAmount: -125.5,
          },
        ],
      },
    });

    expect(screen.getByText('February 2026', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/1 item still open/i)).toBeInTheDocument();
    expect(screen.getByText(/2 items cleared/i)).toBeInTheDocument();
  });
});
