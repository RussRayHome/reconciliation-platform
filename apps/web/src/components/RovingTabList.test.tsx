// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RovingTabList, type RovingTabItem } from './RovingTabList';

type TabId = 'summary' | 'matches' | 'exceptions';

const items: ReadonlyArray<RovingTabItem<TabId>> = [
  { id: 'summary', label: 'Summary', icon: 'reports' },
  { id: 'matches', label: 'Matches', description: '12 pending' },
  { id: 'exceptions', label: 'Exceptions' },
];

const renderTabs = (
  overrides: Partial<Parameters<typeof RovingTabList<TabId>>[0]> = {},
): { onSelect: ReturnType<typeof vi.fn> } => {
  const onSelect = vi.fn();

  render(
    <RovingTabList<TabId>
      items={items}
      activeId="matches"
      onSelect={onSelect}
      ariaLabel="Review views"
      tabIdPrefix="review-tab"
      panelIdPrefix="review-panel"
      listClassName="tablist"
      tabClassName="tab"
      activeTabClassName="tab tab--active"
      {...overrides}
    />,
  );

  return { onSelect };
};

afterEach(cleanup);

describe('RovingTabList', () => {
  it('exposes tablist semantics with the supplied label', () => {
    renderTabs();

    expect(screen.getByRole('tablist', { name: 'Review views' })).toHaveAttribute(
      'aria-orientation',
      'horizontal',
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks only the active tab as selected and links it to its panel', () => {
    renderTabs();

    const active = screen.getByRole('tab', { name: /Matches/ });

    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(active).toHaveAttribute('id', 'review-tab-matches');
    expect(active).toHaveAttribute('aria-controls', 'review-panel-matches');
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'false');
  });

  it('gives only the active tab a tabindex of 0', () => {
    renderTabs();

    expect(screen.getByRole('tab', { name: /Matches/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Exceptions' })).toHaveAttribute('tabindex', '-1');
  });

  it('applies the active class only to the active tab', () => {
    renderTabs();

    expect(screen.getByRole('tab', { name: /Matches/ })).toHaveClass('tab--active');
    expect(screen.getByRole('tab', { name: 'Summary' })).not.toHaveClass('tab--active');
  });

  it('selects a tab on click', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTabs();

    await user.click(screen.getByRole('tab', { name: 'Exceptions' }));

    expect(onSelect).toHaveBeenCalledWith('exceptions');
  });

  it.each([
    ['{ArrowRight}', 'exceptions'],
    ['{ArrowDown}', 'exceptions'],
    ['{ArrowLeft}', 'summary'],
    ['{ArrowUp}', 'summary'],
    ['{Home}', 'summary'],
    ['{End}', 'exceptions'],
  ])('moves selection with %s', async (key, expected) => {
    const user = userEvent.setup();
    const { onSelect } = renderTabs();

    screen.getByRole('tab', { name: /Matches/ }).focus();
    await user.keyboard(key);

    expect(onSelect).toHaveBeenCalledWith(expected);
  });

  it('wraps from the last tab forward to the first', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTabs({ activeId: 'exceptions' });

    screen.getByRole('tab', { name: 'Exceptions' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(onSelect).toHaveBeenCalledWith('summary');
  });

  it('wraps from the first tab backward to the last', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTabs({ activeId: 'summary' });

    screen.getByRole('tab', { name: 'Summary' }).focus();
    await user.keyboard('{ArrowLeft}');

    expect(onSelect).toHaveBeenCalledWith('exceptions');
  });

  it('moves DOM focus along with the selection', async () => {
    const user = userEvent.setup();
    renderTabs();

    screen.getByRole('tab', { name: /Matches/ }).focus();
    await user.keyboard('{End}');

    expect(screen.getByRole('tab', { name: 'Exceptions' })).toHaveFocus();
  });

  it('ignores keys it does not handle', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTabs();

    screen.getByRole('tab', { name: /Matches/ }).focus();
    await user.keyboard('{Escape}');
    await user.keyboard('a');

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders an icon only for items that declare one', () => {
    const { container } = render(
      <RovingTabList<TabId>
        items={items}
        activeId="summary"
        onSelect={vi.fn()}
        ariaLabel="Review views"
        tabIdPrefix="t"
        panelIdPrefix="p"
        listClassName="tablist"
        tabClassName="tab"
        activeTabClassName="tab--active"
      />,
    );

    // .roving-tab__icon-shell is aria-hidden="true" (RovingTabList.tsx:108) -- no accessible
    // query can find it.
    // eslint-disable-next-line testing-library/no-container
    expect(container.querySelectorAll('.roving-tab__icon-shell')).toHaveLength(1);
  });

  it('renders a description only for items that declare one', () => {
    renderTabs();

    expect(screen.getByText('12 pending')).toBeInTheDocument();
    expect(screen.getAllByText(/pending/)).toHaveLength(1);
  });

  it('uses renderContent instead of the default label markup when provided', () => {
    renderTabs({ renderContent: (item) => <span>custom:{item.label}</span> });

    expect(screen.getByText('custom:Summary')).toBeInTheDocument();
    expect(document.querySelector('.roving-tab__label-row')).toBeNull();
  });

  it('renders nothing selectable for an empty item list', () => {
    renderTabs({ items: [], activeId: 'summary' });

    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
