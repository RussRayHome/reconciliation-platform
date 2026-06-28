// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { MatchResult, ReconciliationRunReport } from '@recon/domain';
import { RunResultsSection } from './AppWorkspacePanels';

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
      id: 'qbo-1',
      source: 'qbo',
      fileName: 'qbo.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1234,
      worksheetName: 'QBO',
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
    qboRecords: probableMatchCount,
    exactMatches: 0,
    probableMatches: probableMatchCount,
    unmatchedItems: 0,
    duplicates: 0,
    bankDuplicates: 0,
    qboDuplicates: 0,
    dateVariances: 0,
    timingDifferences: 0,
    dataQualityIssues: 0,
    amountMismatches: 0,
    missingFromBank: 0,
    missingFromQBO: 0,
    unmatchedBankNetAmount: 0,
    unmatchedQboNetAmount: 0,
    cleanMatchedAmount: 0,
    unresolvedExposure: 0,
    countsByCategory: {},
    amountByCategory: {},
    charts: [
      { id: 'countByCategory', title: 'Counts', data: [] },
      { id: 'exposureByCategory', title: 'Exposure', data: [] },
    ],
  },
  reviewerObservations: [],
  reviewerDecisions: [],
});

afterEach(() => {
  cleanup();
});

describe('RunResultsSection probable matches performance rendering', () => {
  it('enables virtualization for large probable match result sets', () => {
    const run = buildRun(180);
    const { container } = render(
      <RunResultsSection run={run} onDownloadWorkbook={() => {}} onExportJson={() => {}} />,
    );

    expect(
      screen.getByText('Virtualized view enabled for large probable-match result sets.'),
    ).toBeInTheDocument();
    expect(container.querySelector('.probable-match-virtual-list')).not.toBeNull();
  });

  it('keeps standard table rendering for smaller probable match result sets', () => {
    const run = buildRun(16);
    const { container } = render(
      <RunResultsSection run={run} onDownloadWorkbook={() => {}} onExportJson={() => {}} />,
    );

    expect(
      screen.queryByText('Virtualized view enabled for large probable-match result sets.'),
    ).toBeNull();
    expect(container.querySelector('.probable-match-table-shell__table table')).not.toBeNull();
  });
});
