// @vitest-environment jsdom

import type { ExceptionItem, ReviewerDecision } from '@recon/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import type { ComponentProps } from 'react';
import { ExceptionTriage } from './ExceptionTriage';
import userEvent from '@testing-library/user-event';

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
): {
  onDecide: ReturnType<typeof vi.fn>;
  onClearDecision: ReturnType<typeof vi.fn>;
  onUndoLastDecision: ReturnType<typeof vi.fn>;
} => {
  const onDecide = vi.fn();
  const onClearDecision = vi.fn();
  const onUndoLastDecision = vi.fn();

  render(
    <ExceptionTriage
      exceptions={exceptions}
      decisionByTargetId={{}}
      pendingTargetId={null}
      decisionError={null}
      lastChange={null}
      onDecide={onDecide}
      onClearDecision={onClearDecision}
      onUndoLastDecision={onUndoLastDecision}
      {...props}
    />,
  );

  return { onDecide, onClearDecision, onUndoLastDecision };
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

  it('preserves a note typed before a decision when navigating rows', async () => {
    const user = userEvent.setup();
    renderTriage();

    const noteField = screen.getByLabelText('Reviewer note');
    await user.type(noteField, 'Investigate wire ref');

    expect(screen.getByText(/Unsaved note/i)).toBeInTheDocument();

    const firstRow = document.querySelector('.exception-row--selected') as HTMLElement;
    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: 'j' });
    const secondRow = document.querySelector('.exception-row--selected') as HTMLElement;
    fireEvent.keyDown(secondRow, { key: 'k' });

    expect(screen.getByLabelText('Reviewer note')).toHaveValue('Investigate wire ref');
  });

  it('renders recommended actions as a checklist and copies one into the note', async () => {
    const user = userEvent.setup();
    renderTriage();

    await user.click(screen.getByRole('button', { name: 'Copy to note' }));

    expect(screen.getByLabelText('Reviewer note')).toHaveValue('Do the thing');
    expect(screen.getByText(/Unsaved note/i)).toBeInTheDocument();
  });

  it('shows the keyboard shortcut legend', () => {
    renderTriage();

    expect(screen.getByText(/Shortcuts:/i)).toBeInTheDocument();
  });

  it('does not trigger decision shortcuts while typing in the note field', async () => {
    const user = userEvent.setup();
    const { onDecide } = renderTriage();

    await user.type(screen.getByLabelText('Reviewer note'), 'review a and r and n later');

    expect(onDecide).not.toHaveBeenCalled();
  });

  it('clears an existing decision when the same key is pressed again (toggle off)', () => {
    const decision: ReviewerDecision = {
      id: 'decision-1',
      runId: 'run-1',
      targetType: 'ExceptionItem',
      targetId: 'exception-1',
      outcome: 'ConfirmedException',
      createdAt: '2026-03-31T00:00:00.000Z',
      updatedAt: '2026-03-31T00:00:00.000Z',
    };
    const { onClearDecision, onDecide } = renderTriage({
      decisionByTargetId: { 'exception-1': decision },
    });

    const selectedRow = document.querySelector('.exception-row--selected') as HTMLElement;
    selectedRow.focus();
    fireEvent.keyDown(selectedRow, { key: 'a' });

    expect(onClearDecision).toHaveBeenCalledWith('exception-1');
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('invokes undo when the U key is pressed', () => {
    const { onUndoLastDecision } = renderTriage();

    const selectedRow = document.querySelector('.exception-row--selected') as HTMLElement;
    selectedRow.focus();
    fireEvent.keyDown(selectedRow, { key: 'u' });

    expect(onUndoLastDecision).toHaveBeenCalledTimes(1);
  });

  it('shows an undo affordance for the last changed decision', () => {
    renderTriage({ lastChange: { targetId: 'exception-1', label: 'Accepted' } });

    expect(screen.getByRole('button', { name: /Undo/i })).toBeInTheDocument();
  });

  it('exposes listbox semantics with positioned options', () => {
    renderTriage();

    const listbox = screen.getByRole('listbox', { name: 'Exceptions' });
    const options = within(listbox).getAllByRole('option');

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-posinset', '1');
    expect(options[0]).toHaveAttribute('aria-setsize', '3');
  });

  it('does not render an "Undecided" label for undecided rows', () => {
    renderTriage();

    expect(screen.queryByText('Undecided')).not.toBeInTheDocument();
  });

  it('sorts by a column header and toggles direction with aria-sort', async () => {
    const user = userEvent.setup();
    renderTriage();

    const amountHeader = screen.getByRole('columnheader', { name: /Amount/i });
    const amountButton = within(amountHeader).getByRole('button');

    await user.click(amountButton);
    expect(amountHeader).toHaveAttribute('aria-sort', 'descending');

    await user.click(amountButton);
    expect(amountHeader).toHaveAttribute('aria-sort', 'ascending');
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
