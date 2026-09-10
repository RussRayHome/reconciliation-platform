// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { MatchResult, ReconciliationRunReport } from '@recon/domain';
import { ReviewSection } from './AppWorkspacePanels';

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

describe('Verdict module Prior-period comparison (Unreconciled Item Roll-Forward PR F.3)', () => {
  const renderSummary = (priorPeriodRollforward: Parameters<typeof ReviewSection>[0]['priorPeriodRollforward']) => {
    const run = buildRun(0);
    return render(
      <ReviewSection
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
