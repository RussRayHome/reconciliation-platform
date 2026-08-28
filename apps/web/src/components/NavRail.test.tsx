// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
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
  importFilesBank: 'Bank Statements',
  importFilesBilling: 'AP / Billing',
  mappingCreate: 'Create Mapping',
  mappingRules: 'Matching Rules',
  mappingRulesVersions: 'Rule Versions',
  approvalsImports: 'Imported files',
  approvalsMappingProfiles: 'Mapping Profiles approvals',
  approvalsMatchingRules: 'Matching Rule & Variances',
  approvalsExceptionResolutions: 'Exception Resolutions',
  approvalsReportDistribution: 'Report Distribution',
  reconSummary: 'File-based',
  probableMatches: 'Rules-based',
  exceptions: 'Exceptions',
  export: 'Reports',
  openItemsSchedule: 'Open Items Schedule',
};

/** `routePaths` entries deliberately absent from the rail, with why -- so a future removal has to
 * edit this list (a visible decision) rather than just stop failing (a silent one). */
const EXPECTED_ABSENT_FROM_RAIL: Record<string, string> = {
  importFiles: 'alias for importFilesBank (same string, R1 WP2) -- not a distinct rendered link',
  login: 'pre-auth screen; the rail only renders once authenticated',
  forgotPassword: 'pre-auth screen',
  signup: 'pre-auth screen',
  support: 'pre-auth screen',
  approvalsPolicy: 'Reached via the Approvals page header\'s "Approval policy" button, not the rail',
  // N2: these four routes all render ComingSoonPage -- the rail entry is removed, the route stays.
  mappingProfiles: 'N2: renders ComingSoonPage; rail entry removed, route stays',
  mappingVersions: 'N2: renders ComingSoonPage; rail entry removed, route stays',
  mappingHistory: 'N2: renders ComingSoonPage; rail entry removed, route stays',
  documentationRunBook: 'N2: renders ComingSoonPage; rail entry removed, route stays',
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

  it('shows each source type\'s schema value as a caption without it polluting the link\'s accessible name', () => {
    renderRail();

    const link = screen.getByRole('link', { name: 'Bank Statements' });
    expect(link.querySelector('.nav-rail__item-caption')).toHaveTextContent('BANK · GL');
    expect(link.querySelector('.nav-rail__item-caption')).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not render a rail link for routes deliberately absent from the rail', () => {
    renderRail();

    const renderedHrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    const renderedPaths = new Set(
      Object.keys(EXPECTED_RAIL_LINKS).map((key) => routePaths[key as keyof typeof routePaths]),
    );

    for (const routeKey of Object.keys(EXPECTED_ABSENT_FROM_RAIL)) {
      const path = routePaths[routeKey as keyof typeof routePaths];
      // An "absent" route can still share its string with an EXPECTED_RAIL_LINKS entry (e.g.
      // importFiles === importFilesBank, both '/') -- that's a rendered alias, not a real gap, so
      // skip the non-containment check for it rather than asserting something that's true by
      // design.
      if (renderedPaths.has(path)) continue;
      expect(renderedHrefs).not.toContain(path);
    }
  });
});

// N3: the rail's template-download menu duplicated the Import Files screen's own menu verbatim
// (same hrefs, same labels) -- removed here, not rebuilt; Import Files still offers every format.
describe('NavRail template downloads (N3: removed, not duplicated)', () => {
  it('renders no download links', () => {
    renderRail();

    const downloadLinks = screen
      .getAllByRole('link')
      .filter((link) => link.hasAttribute('download'));
    expect(downloadLinks).toEqual([]);
  });
});

// N4: "Work" is renamed "Close" and holds the whole close journey in one place, in journey order
// -- Import Files, Reconcile (renamed from Reconciliation), Exceptions, Reports (moved in from
// Analyze).
describe('NavRail Close category (N4: journey order)', () => {
  it('renders Close children in journey order', () => {
    renderRail();

    const closeCategory = screen.getByLabelText('Close');
    const text = closeCategory.textContent ?? '';
    const importFilesIndex = text.indexOf('Import Files');
    const reconcileIndex = text.indexOf('Reconcile');
    const exceptionsIndex = text.indexOf('Exceptions');
    const reportsIndex = text.indexOf('Reports');

    expect(importFilesIndex).toBeGreaterThanOrEqual(0);
    expect(reconcileIndex).toBeGreaterThan(importFilesIndex);
    expect(exceptionsIndex).toBeGreaterThan(reconcileIndex);
    expect(reportsIndex).toBeGreaterThan(exceptionsIndex);
  });

  it('does not render a stray "Reconciliation" label -- the section is renamed, not duplicated', () => {
    renderRail();

    expect(screen.queryByText('Reconciliation')).not.toBeInTheDocument();
    expect(screen.getByText('Reconcile')).toBeInTheDocument();
  });

  it('leaves Reports out of the Analyze category now that it lives in Close', () => {
    renderRail();

    const analyzeCategory = screen.getByLabelText('Analyze');
    expect(within(analyzeCategory).queryByText('Reports')).not.toBeInTheDocument();
    expect(within(analyzeCategory).getByText('Open Items Schedule')).toBeInTheDocument();
  });

  // The rename is a label-only change -- touching the sectionId itself would silently reset
  // every existing user's collapse state, since useNavSectionCollapse bakes the id into the
  // storage key. Asserting the literal key string means an accidental id rename fails here.
  it('persists collapse state under the unchanged sectionId key', async () => {
    const user = userEvent.setup();
    const username = 'collapse-key-test-user';
    const storageKey = `reconciliation-platform:nav.section.reconciliation:${username}`;
    globalThis.localStorage.removeItem(storageKey);

    renderRail({ username });
    await user.click(screen.getByRole('button', { name: 'Reconcile' }));

    expect(globalThis.localStorage.getItem(storageKey)).toBe('false');
  });
});
