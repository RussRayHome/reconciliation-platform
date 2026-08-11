// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { NavRail } from './NavRail';
import { routePaths } from '../routes/routePaths';

afterEach(() => {
  cleanup();
});

const noop = () => {};

/** Account items (Profile/Security/Billing/Notification/Preferences) render inside the footer's
 * account menu popover, closed by default -- open it before asserting on those links. */
const ACCOUNT_ROUTE_KEYS = new Set([
  'accountProfile',
  'accountSecurity',
  'accountBilling',
  'accountNotification',
  'accountPreferences',
]);

async function openAccountMenu(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Open account menu' }));
}

const defaultProps = {
  unreviewedExceptionCount: null,
  exceptions: [],
  onApplySavedView: noop,
  docsHref: '/docs',
  canAccessDocumentation: true,
  canAccessRunBook: true,
  canApprove: false,
  approvalCounts: null,
  username: 'test.user',
  profileLabel: 'Test User',
  roleLabel: 'Superuser',
  onSignOut: noop,
  isMobileOpen: false,
  onMobileClose: noop,
};

function renderRail(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <MemoryRouter>
      <NavRail {...defaultProps} {...overrides} />
    </MemoryRouter>,
  );
}

/**
 * Every `routePaths` entry the rail is expected to link to, keyed by the entry's `routePaths`
 * key, with the exact accessible name `NavRail` gives it. Paired with `EXPECTED_ABSENT_FROM_RAIL`
 * below, this is the rail's inventory (ISSUE-027/ISSUE-028): a route silently dropped from the
 * rail, or a new route nobody decided about, fails the completeness test instead of passing
 * unnoticed the way ISSUE-015's removal did.
 */
const EXPECTED_RAIL_LINKS: Record<string, string> = {
  accountProfile: 'Profile',
  accountSecurity: 'Security',
  accountBilling: 'Billing',
  accountNotification: 'Notification',
  accountPreferences: 'Preferences',
  importFiles: 'Import Files',
  mappingProfiles: 'Mapping Profiles',
  mappingCreate: 'Create Mapping',
  mappingVersions: 'Mapping Versions',
  mappingRules: 'Matching Rules',
  mappingRulesVersions: 'Rule Versions',
  mappingHistory: 'Mapping History',
  approvalsImports: 'Imported files',
  approvalsMappingProfiles: 'Mapping Profiles approvals',
  approvalsMatchingRules: 'Matching Rule & Variances',
  approvalsExceptionResolutions: 'Exception Resolutions',
  approvalsReportDistribution: 'Report Distribution',
  reconSummary: 'File-based',
  probableMatches: 'Rules-based',
  exceptions: 'Exceptions',
  export: 'Reports',
  documentationRunBook: 'Run Book',
};

/** `routePaths` entries deliberately absent from the rail, with why -- so a future removal has to
 * edit this list (a visible decision) rather than just stop failing (a silent one). */
const EXPECTED_ABSENT_FROM_RAIL: Record<string, string> = {
  login: 'pre-auth screen; the rail only renders once authenticated',
  forgotPassword: 'pre-auth screen',
  signup: 'pre-auth screen',
  support: 'pre-auth screen',
  approvalsPolicy: 'Reached via the Approvals page header\'s "Approval policy" button, not the rail',
};

describe('NavRail route inventory', () => {
  it('accounts for every routePaths entry as either rail-linked or deliberately absent', () => {
    const allRouteKeys = Object.keys(routePaths).sort();
    const accountedForKeys = [
      ...Object.keys(EXPECTED_RAIL_LINKS),
      ...Object.keys(EXPECTED_ABSENT_FROM_RAIL),
    ].sort();

    expect(accountedForKeys).toEqual(allRouteKeys);
  });

  it.each(Object.entries(EXPECTED_RAIL_LINKS))(
    'renders a link to %s ("%s") with the correct href',
    async (routeKey, accessibleName) => {
      renderRail();

      if (ACCOUNT_ROUTE_KEYS.has(routeKey)) {
        await openAccountMenu();
      }

      const link = screen.getByRole('link', { name: accessibleName });
      expect(link).toHaveAttribute('href', routePaths[routeKey as keyof typeof routePaths]);
    },
  );

  it('does not render a rail link for routes deliberately absent from the rail', () => {
    renderRail();

    const renderedHrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));

    for (const routeKey of Object.keys(EXPECTED_ABSENT_FROM_RAIL)) {
      const path = routePaths[routeKey as keyof typeof routePaths];
      expect(renderedHrefs).not.toContain(path);
    }
  });
});
