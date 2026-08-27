// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ComponentProps } from 'react';

import { ExceptionFacets } from './ExceptionFacets';
import { emptyFacetSelection, type TriageFacetKey } from '../lib/exceptionTriage';

const makeOptions = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    value: `v${index}`,
    label: `Option ${index}`,
    count: count - index,
  }));

const renderFacets = (overrides: Partial<ComponentProps<typeof ExceptionFacets>> = {}) => {
  const props: ComponentProps<typeof ExceptionFacets> = {
    query: '',
    onQueryChange: vi.fn(),
    facetGroups: [{ key: 'rule' as TriageFacetKey, label: 'Rule', options: makeOptions(8) }],
    selection: emptyFacetSelection(),
    onToggleFacet: vi.fn(),
    onClearFacets: vi.fn(),
    hasActiveFilters: false,
    totalShown: 10,
    totalAll: 20,
    savedViews: [],
    onSaveView: vi.fn(),
    onApplyView: vi.fn(),
    onDeleteView: vi.fn(),
    ...overrides,
  };

  render(<ExceptionFacets {...props} />);
  return props;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ExceptionFacets', () => {
  it('caps options at six and reveals the rest via Show all', async () => {
    const user = userEvent.setup();
    renderFacets();

    expect(screen.getAllByRole('checkbox')).toHaveLength(6);

    await user.click(screen.getByRole('button', { name: 'Show all (8)' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(8);

    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });

  it('always keeps selected options visible above the cap', () => {
    renderFacets({ selection: { ...emptyFacetSelection(), rule: ['v7'] } });

    expect(screen.getByRole('checkbox', { name: /Option 7/ })).toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });

  it('exposes a sticky Clear filters control only when filters are active', async () => {
    const user = userEvent.setup();
    // renderFacets (line 37) never captures render()'s own return value; it returns the props
    // bag (including the vi.fn() mocks) used to render, so `props` is the accurate name here,
    // not a RenderResult.
    // eslint-disable-next-line testing-library/render-result-naming-convention
    const props = renderFacets({ hasActiveFilters: true });

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(props.onClearFacets).toHaveBeenCalledTimes(1);
  });
});
