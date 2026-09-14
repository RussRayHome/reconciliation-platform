// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import { MappingTabs } from './MappingTabs';
import { routePaths } from '../routes/routePaths';

afterEach(cleanup);

const LocationProbe = () => <span data-testid="path">{useLocation().pathname}</span>;

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <MappingTabs />
      <LocationProbe />
      <Routes>
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );

describe('MappingTabs (9a–9d, #450)', () => {
  it('offers the four mapping screens', () => {
    renderAt(routePaths.mappingProfiles);

    for (const label of ['Profiles', 'Canvas', 'Versions', 'History']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the tab for the route being viewed', () => {
    renderAt(routePaths.mappingVersions);

    expect(screen.getByRole('tab', { name: 'Versions' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Profiles' })).toHaveAttribute('aria-selected', 'false');
  });

  // Each tab is a real route, so back, bookmarking and deep links all work. A strip that only
  // swapped local state would silently break all three.
  it('navigates rather than swapping local state', async () => {
    const user = userEvent.setup();
    renderAt(routePaths.mappingProfiles);

    await user.click(screen.getByRole('tab', { name: 'History' }));

    expect(screen.getByTestId('path')).toHaveTextContent(routePaths.mappingHistory);
  });

  /**
   * `/mapping/rules` and `/mapping/rules/versions` are the MATCHING RULES family — a different
   * screen that happens to share the `/mapping` stem. A prefix match would light up a mapping tab
   * while the reader is somewhere else entirely, which is the bug NavRail hit when NavLink matched
   * by prefix and lit two entries at once.
   */
  it('does not appear on the matching-rules routes that share the /mapping stem', () => {
    renderAt(routePaths.mappingRules);
    expect(screen.queryByRole('tab')).toBeNull();

    cleanup();
    renderAt(routePaths.mappingRulesVersions);
    expect(screen.queryByRole('tab')).toBeNull();
  });
});
