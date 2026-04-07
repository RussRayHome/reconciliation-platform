// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExceptionItem } from '@recon/domain';

import { ExceptionTable } from './ExceptionTable';

const exceptions: ExceptionItem[] = [
  {
    id: 'exception-1',
    runId: 'run-1',
    category: 'MissingFromQBO',
    severity: 'High',
    source: 'bank',
    spreadsheetFileName: 'bank.xlsx',
    lineNumber: 12,
    transactionDate: '2026-03-31',
    amount: 125.5,
    errorMessage: 'Missing from QBO',
    ruleTrace: {
      ruleId: 'missing-from-qbo',
      ruleName: 'Missing from QBO',
      reason: 'No QBO transaction remained after matching.',
      evidence: ['Transaction stayed unmatched.'],
    },
    recommendedNextActions: ['Confirm the entry exists in QBO.'],
    normalizedComparisonTokens: ['ACME', 'INVOICE'],
    relatedTransactionIds: [],
  },
  {
    id: 'exception-2',
    runId: 'run-1',
    category: 'TimingDifference',
    severity: 'Medium',
    source: 'qbo',
    spreadsheetFileName: 'qbo.xlsx',
    lineNumber: 4,
    transactionDate: '2026-04-02',
    amount: -88,
    errorMessage: 'Timing difference',
    ruleTrace: {
      ruleId: 'timing-difference',
      ruleName: 'Timing Difference',
      reason: 'Matching transaction exists in an extended timing window.',
      evidence: ['Same amount found in nearby period.'],
    },
    recommendedNextActions: ['Carry into the next period review.'],
    normalizedComparisonTokens: ['PAYROLL'],
    relatedTransactionIds: [],
  },
];

afterEach(() => {
  cleanup();
});

describe('ExceptionTable', () => {
  it('shows an explicit empty-filter state and can clear filters', async () => {
    const user = userEvent.setup();

    render(<ExceptionTable exceptions={[...exceptions]} />);

    await user.type(screen.getByLabelText('Search exceptions'), 'does-not-match');

    expect(screen.getByRole('status')).toHaveTextContent('No exceptions match the current filters');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(screen.getAllByText('Missing from QBO').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Timing Difference').length).toBeGreaterThan(0);
  });

  it('reports the current filtered count', async () => {
    const user = userEvent.setup();

    render(<ExceptionTable exceptions={[...exceptions]} />);

    expect(screen.getAllByText('Showing 2 of 2 exceptions.').length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText('Filter exceptions by category'), 'TimingDifference');

    expect(screen.getAllByText('Showing 1 of 2 exceptions.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Timing Difference').length).toBeGreaterThan(0);
  });
});