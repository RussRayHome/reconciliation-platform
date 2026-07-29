// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import type { ComponentProps } from 'react';

import type { ExceptionItem, ReviewerDecision } from '@recon/domain';
import userEvent from '@testing-library/user-event';

import { ExceptionTriage } from './ExceptionTriage';

const makeException = (
  overrides: Partial<ExceptionItem> & Pick<ExceptionItem, 'id'>,
): ExceptionItem => ({
  runId: 'run-1',
  category: 'MissingFromQBO',
  severity: 'High',
  source: 'bank',
  spreadsheetFileName: 'bank.xlsx',
  lineNumber: 1,
  transactionDate: '2026-03-31',
  amount: 100,
  errorMessage: 'Error',
  ruleTrace: {
    ruleId: 'rule',
    ruleName: 'Rule',
    reason: 'Reason',
    evidence: ['Evidence line'],
  },
  recommendedNextActions: ['Do the thing'],
  normalizedComparisonTokens: ['TOKEN'],
  relatedTransactionIds: [],
  ...overrides,
});

const exceptions: ExceptionItem[] = [
  makeException({
    id: 'exception-1',
    category: 'AmountMismatch',
    severity: 'Critical',
    amount: 5000,
    lineNumber: 3,
    normalizedComparisonTokens: ['ALPHA'],
  }),
  makeException({
    id: 'exception-2',
    category: 'MissingFromQBO',
    severity: 'High',
    amount: 125.5,
    lineNumber: 8,
    normalizedComparisonTokens: ['BETA'],
  }),
  makeException({
    id: 'exception-3',
    category: 'TimingDifference',
    severity: 'Medium',
    amount: -88,
    lineNumber: 12,
    normalizedComparisonTokens: ['GAMMA'],
  }),
];

const mockDesktop = (): void => {
  vi.spyOn(globalThis, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(min-width: 961px)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const renderTriage = (
  props?: Partial<ComponentProps<typeof ExceptionTriage>>,
): { onDecide: ReturnType<typeof vi.fn> } => {
  const onDecide = vi.fn();

  render(
    <ExceptionTriage
      exceptions={exceptions}
      decisionByTargetId={{}}
      pendingTargetId={null}
      decisionError={null}
      onDecide={onDecide}
      {...props}
    />,
  );

  return { onDecide };
};

beforeEach(() => {
  mockDesktop();
  globalThis.localStorage?.clear?.();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ExceptionTriage', () => {
  it('selects the highest-severity exception by default and shows its detail', () => {
    renderTriage();

    expect(screen.getByLabelText(/Exception detail for/i)).toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 3 exceptions.')).toBeInTheDocument();
  });

  it('filters the list with the free-text search', async () => {
    const user = userEvent.setup();
    renderTriage();

    await user.type(screen.getByLabelText('Search exceptions'), 'BETA');

    expect(screen.getByText('Showing 1 of 3 exceptions.')).toBeInTheDocument();
  });

  it('filters the list with a severity facet', async () => {
    const user = userEvent.setup();
    renderTriage();

    await user.click(screen.getByRole('checkbox', { name: /Critical/i }));

    expect(screen.getByText('Showing 1 of 3 exceptions.')).toBeInTheDocument();
  });

  it('shows an empty state when no exceptions match', async () => {
    const user = userEvent.setup();
    renderTriage();

    await user.type(screen.getByLabelText('Search exceptions'), 'ZZZZZ');

    expect(screen.getByText('No exceptions match the current filters')).toBeInTheDocument();
  });

  it('supports keyboard navigation and records a decision with the keyboard', () => {
    const { onDecide } = renderTriage();

    const selectedRow = document.querySelector('.exception-row--selected') as HTMLElement | null;
    expect(selectedRow).not.toBeNull();
    selectedRow?.focus();

    fireEvent.keyDown(selectedRow as HTMLElement, { key: 'j' });

    const nextRow = document.querySelector('.exception-row--selected') as HTMLElement | null;
    fireEvent.keyDown(nextRow as HTMLElement, { key: 'a' });

    expect(onDecide).toHaveBeenCalledWith('exception-2', 'accept');
  });

  it('records a decision from the detail-pane buttons', async () => {
    const user = userEvent.setup();
    const { onDecide } = renderTriage();

    await user.click(screen.getByRole('button', { name: /Reject/i }));

    expect(onDecide).toHaveBeenCalledWith('exception-1', 'reject', '');
  });

  it('reflects a persisted decision and surfaces decision errors', () => {
    const decision: ReviewerDecision = {
      id: 'decision-1',
      runId: 'run-1',
      targetType: 'ExceptionItem',
      targetId: 'exception-1',
      outcome: 'ConfirmedException',
      createdAt: '2026-03-31T00:00:00.000Z',
      updatedAt: '2026-03-31T00:00:00.000Z',
    };

    renderTriage({
      decisionByTargetId: { 'exception-1': decision },
      decisionError: 'Save failed.',
    });

    const decisionGroup = screen.getByRole('group', { name: 'Decision outcome' });
    expect(within(decisionGroup).getByRole('button', { name: /Accept/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed.');
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });
});
