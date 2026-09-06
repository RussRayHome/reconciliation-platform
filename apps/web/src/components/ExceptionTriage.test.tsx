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
  category: 'MissingFromGL',
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
    category: 'MissingFromGL',
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

    const selectedRow = screen.getByRole('option', { selected: true });
    selectedRow.focus();

    fireEvent.keyDown(selectedRow, { key: 'ArrowDown' });

    const nextRow = screen.getByRole('option', { selected: true });
    fireEvent.keyDown(nextRow, { key: 'a' });

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

    const firstRow = screen.getByRole('option', { selected: true });
    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: 'ArrowDown' });
    const secondRow = screen.getByRole('option', { selected: true });
    fireEvent.keyDown(secondRow, { key: 'ArrowUp' });

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
    // R3 X3: arrows replaced J/K, and U (long implemented) is finally documented.
    const legend = screen.getByText(/Shortcuts:/i);
    expect(legend).toHaveTextContent('↑');
    expect(legend).toHaveTextContent('↓');
    expect(legend).toHaveTextContent('undo');
    expect(legend.textContent).not.toMatch(/\bJ\b\/\bK\b/);
  });

  it('ignores the retired J and K shortcuts', () => {
    renderTriage();

    const selectedRow = screen.getByRole('option', { selected: true });
    selectedRow.focus();

    fireEvent.keyDown(selectedRow, { key: 'j' });
    expect(screen.getByRole('option', { selected: true })).toBe(selectedRow);

    fireEvent.keyDown(selectedRow, { key: 'k' });
    expect(screen.getByRole('option', { selected: true })).toBe(selectedRow);
  });

  it('reports the selected position and how many visible rows are decided', () => {
    const decision: ReviewerDecision = {
      id: 'decision-1',
      runId: 'run-1',
      targetType: 'ExceptionItem',
      targetId: 'exception-1',
      outcome: 'ConfirmedException',
      createdAt: '2026-03-31T00:00:00.000Z',
      updatedAt: '2026-03-31T00:00:00.000Z',
    };
    renderTriage({ decisionByTargetId: { 'exception-1': decision } });

    // Three fixture rows, one of them already decided.
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/1 decided/)).toBeInTheDocument();

    const selectedRow = screen.getByRole('option', { selected: true });
    selectedRow.focus();
    fireEvent.keyDown(selectedRow, { key: 'ArrowDown' });

    expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
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

    const selectedRow = screen.getByRole('option', { selected: true });
    selectedRow.focus();
    fireEvent.keyDown(selectedRow, { key: 'a' });

    expect(onClearDecision).toHaveBeenCalledWith('exception-1');
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('invokes undo when the U key is pressed', () => {
    const { onUndoLastDecision } = renderTriage();

    const selectedRow = screen.getByRole('option', { selected: true });
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

// R3 X4: resolveCounterpartLabel collapses four situations into one string. The row renders the
// discriminated cell instead, so a coloured BANK/GL tag can only appear where a source truly exists.
describe('counterpart cell (Issue #329, X4)', () => {
  const sourceTagsIn = (cell: Element | null | undefined): number =>
    cell?.querySelectorAll('.exception-row__source').length ?? 0;

  it('never paints a source tag in front of "No counterpart"', () => {
    renderTriage();

    const cells = Array.from(document.querySelectorAll('.exception-row__counterpart'));
    const noneCells = cells.filter((cell) => cell.textContent?.includes('No counterpart'));

    // The fixture must actually exercise this branch, or the assertion below proves nothing.
    expect(noneCells.length).toBeGreaterThan(0);
    for (const cell of noneCells) {
      expect(sourceTagsIn(cell)).toBe(0);
    }
  });

  it('tags a single counterpart with its source and keeps the full label as the title', () => {
    // The shared fixture has no single-counterpart-with-source row, so supply one rather than
    // weaken the assertion into something that would pass vacuously.
    renderTriage({
      exceptions: [
        makeException({
          id: 'exception-single',
          category: 'AmountMismatch',
          severity: 'High',
          amount: 42.5,
          lineNumber: 2,
          ruleTrace: {
            ruleId: 'amount-date-match',
            ruleName: 'Amount + Date Match',
            reason: 'Single counterpart',
            evidence: [],
            counterparts: [{ source: 'gl', spreadsheetFileName: 'gl.xlsx', lineNumber: 7 }],
          },
        }),
      ],
    });

    const cell = document.querySelector('.exception-row__counterpart');
    expect(sourceTagsIn(cell)).toBe(1);
    expect(cell?.querySelector('.exception-row__source')?.getAttribute('data-source')).toBe('gl');
    expect(cell).toHaveTextContent('gl.xlsx / 7');
    expect(cell?.getAttribute('title')).toContain('gl.xlsx');
  });
});

// R3 X2: the decision controls move into the sticky header so deciding never requires scrolling.
describe('decision controls live in the panel header (Issue #329, X2)', () => {
  it('renders the Decision outcome fieldset inside .exception-detail__header', () => {
    renderTriage();

    const group = screen.getByRole('group', { name: 'Decision outcome' });
    expect(group.closest('.exception-detail__header')).not.toBeNull();
    expect(group.closest('.exception-detail__body')).toBeNull();
  });
});
