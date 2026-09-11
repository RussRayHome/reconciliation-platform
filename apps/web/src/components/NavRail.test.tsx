// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApprovalCountsByGroup } from '@recon/domain';

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

const defaultProps: {
  unreviewedExceptionCount: number | null;
  exceptions: never[];
  onApplySavedView: typeof noop;
  docsHref: string;
  canAccessDocumentation: boolean;
  canApprove: boolean;
  approvalCounts: ApprovalCountsByGroup | null;
  matchingRuleTotalCount: number | undefined;
  username: string;
  profileLabel: string;
  roleLabel: string;
  onSignOut: typeof noop;
  isMobileOpen: boolean;
  onMobileClose: typeof noop;
} = {
  unreviewedExceptionCount: null,
  exceptions: [],
  onApplySavedView: noop,
  docsHref: '/docs',
  canAccessDocumentation: true,
  canApprove: false,
  approvalCounts: null,
  matchingRuleTotalCount: undefined,
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
  importFiles: 'New run',
  bankAccounts: 'Bank accounts',
  apEntities: 'AP entities',
  arEntities: 'AR entities',
  mappingCreate: 'Mapping',
  mappingRules: 'Rules & variances',
  mappingRulesVersions: 'Versions',
  approvals: 'Pending',
  reconSummary: 'Summary',
  probableMatches: 'Probable matches',
  exceptions: 'Exceptions',
  export: 'Reports & export',
  openItemsSchedule: 'Open items',
};

/** `routePaths` entries deliberately absent from the rail, with why -- so a future removal has to
 * edit this list (a visible decision) rather than just stop failing (a silent one). */
const EXPECTED_ABSENT_FROM_RAIL: Record<string, string> = {
  importFilesBank: 'UI-1: Import Files flattened -- importFiles renders the one "New run" link; same string (R1 WP2), not a second rendered link',
  importFilesBilling: 'UI-1: absorbed into New run as a source-type tab (UI-2 wires the tab); no rail entry of its own',
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
  // N1: the five per-type approval routes are superseded by the one consolidated "Pending
  // approvals" destination above -- each stays declared as a one-release redirect to the object
  // it used to shadow (App.tsx), never rail-linked again.
  approvalsImports: 'N1: superseded by approvals; redirects to importFilesBank',
  approvalsMappingProfiles: 'N1: superseded by approvals; redirects to approvals itself (no object screen exists)',
  approvalsMatchingRules: 'N1: superseded by approvals; redirects to mappingRules',
  approvalsExceptionResolutions: 'N1: superseded by approvals; redirects to exceptions',
  approvalsReportDistribution: 'N1: superseded by approvals; redirects to export',
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

  // N1: "every rail label is unique" -- the guard that keeps a future duplicate-label regression
  // (like N1 itself fixed, five different links all needing distinguishable names) from coming
  // back silently. Checked against the actual rendered DOM, not just the fixture above, so a
  // fixture typo can't hide a real collision.
  it('renders every rail link with a unique accessible name', async () => {
    renderRail();
    await openAccountMenu();

    const names = screen.getAllByRole('link').map((link) => link.textContent?.trim());
    expect(new Set(names).size).toBe(names.length);
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

    const link = screen.getByRole('link', { name: 'New run' });
    expect(link.querySelector('.nav-rail__item-caption')).toHaveTextContent('BANK · GL · SUBLEDGERS');
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

// N1: the five per-submenu approval badges collapse into one summed "Pending approvals" badge.
describe('NavRail Pending approvals badge (N1: summed count)', () => {
  const COUNTS: ApprovalCountsByGroup = {
    import: { pending: 2, approved: 1, rejected: 1, mySubmissions: 0 },
    mappingProfile: { pending: 0, approved: 0, rejected: 0, mySubmissions: 0 },
    matchingRule: { pending: 3, approved: 0, rejected: 2, mySubmissions: 0 },
    exceptionResolution: { pending: 0, approved: 0, rejected: 4, mySubmissions: 0 },
    reportDistribution: { pending: 1, approved: 0, rejected: 0, mySubmissions: 0 },
  };

  it('sums pending across all five groups for an approver', () => {
    renderRail({ canApprove: true, approvalCounts: COUNTS });

    // Not getByRole({name: ...}): once the badge renders (count > 0) its own aria-label
    // ("N Pending approvals") folds into the link's accessible name too, so an exact-name query
    // would need to know the count in advance. The label text itself is unambiguous.
    const link = screen.getByText('Pending').closest('a')!;
    // 2 (import) + 0 (mappingProfile) + 3 (matchingRule) + 0 (exceptionResolution) + 1 (reportDistribution)
    expect(link.querySelector('.nav-rail__badge')).toHaveTextContent('6');
  });

  it('sums rejected across all five groups for a non-approver (submitter)', () => {
    renderRail({ canApprove: false, approvalCounts: COUNTS });

    // Not getByRole({name: ...}): once the badge renders (count > 0) its own aria-label
    // ("N Pending approvals") folds into the link's accessible name too, so an exact-name query
    // would need to know the count in advance. The label text itself is unambiguous.
    const link = screen.getByText('Pending').closest('a')!;
    // 1 (import) + 0 (mappingProfile) + 2 (matchingRule) + 4 (exceptionResolution) + 0 (reportDistribution)
    expect(link.querySelector('.nav-rail__badge')).toHaveTextContent('7');
  });

  it('shows no badge while counts have not loaded yet', () => {
    renderRail({ canApprove: true, approvalCounts: null });

    // Not getByRole({name: ...}): once the badge renders (count > 0) its own aria-label
    // ("N Pending approvals") folds into the link's accessible name too, so an exact-name query
    // would need to know the count in advance. The label text itself is unambiguous.
    const link = screen.getByText('Pending').closest('a')!;
    expect(link.querySelector('.nav-rail__badge')).toBeNull();
  });
});

// UI-1 (#400), approved exception to DESIGN_DECISIONS rule 3: a rail badge means "needs your
// decision", so it is ABSENT when there is nothing to decide -- never a grey zero. A rail full of
// zeros reads as broken, and 6a (a brand-new org) is specified with no badges at all rather than
// a column of them. This is stricter than rule 3's literal "equal the destination screen's number".
describe('NavRail badges are absent, not zero', () => {
  const badgeFor = (label: string): Element | null =>
    screen.getByText(label).closest('a')!.querySelector('.nav-rail__badge');

  it('renders no badge when a count is zero', () => {
    renderRail({ unreviewedExceptionCount: 0, matchingRuleTotalCount: 0 });

    expect(badgeFor('Exceptions')).toBeNull();
    expect(badgeFor('Rules & variances')).toBeNull();
  });

  it('renders the badge once a count is above zero', () => {
    renderRail({ unreviewedExceptionCount: 14, matchingRuleTotalCount: 12 });

    expect(badgeFor('Exceptions')).toHaveTextContent('14');
    expect(badgeFor('Rules & variances')).toHaveTextContent('12');
  });

  // Rules & variances used a separate `count` prop that rendered its own pill whenever the value
  // was defined -- so a tenant with no rules yet got a literal "0" next to it. Asserting on the
  // rendered text rather than the retired class: "no grey zeros anywhere in the rail" is the rule
  // the design actually states, and it keeps holding if a future count is wired some other way.
  it('renders no zero anywhere in the rail when every count is zero', () => {
    renderRail({ unreviewedExceptionCount: 0, matchingRuleTotalCount: 0 });

    expect(screen.queryByText('0')).toBeNull();
  });
});

// N4: "Work" is renamed "Close" and holds the whole close journey in one place, in journey order
// -- Import Files, Reconcile (renamed from Reconciliation), Exceptions, Reports (moved in from
// Analyze).
describe('NavRail Runs category (UI-1: journey order)', () => {
  it('renders Runs children in journey order', () => {
    renderRail();

    const runsCategory = screen.getByLabelText('Runs');
    const text = runsCategory.textContent ?? '';
    const newRunIndex = text.indexOf('New run');
    const matchResultsIndex = text.indexOf('Match results');
    const exceptionsIndex = text.indexOf('Exceptions');
    const reportsIndex = text.indexOf('Reports & export');

    expect(newRunIndex).toBeGreaterThanOrEqual(0);
    expect(matchResultsIndex).toBeGreaterThan(newRunIndex);
    expect(exceptionsIndex).toBeGreaterThan(matchResultsIndex);
    expect(reportsIndex).toBeGreaterThan(exceptionsIndex);
  });

  it('does not render a stray "Reconciliation" or "Reconcile" label -- the section is renamed, not duplicated', () => {
    renderRail();

    expect(screen.queryByText('Reconciliation')).not.toBeInTheDocument();
    expect(screen.queryByText('Reconcile')).not.toBeInTheDocument();
    expect(screen.getByText('Match results')).toBeInTheDocument();
  });

  it('flattens Import Files to a single New run entry with no children of its own', () => {
    renderRail();

    // UI-1 / decision 1: Import Files is the only section that flattens, because its two children
    // became source-type tabs on New run. Neither child may survive as a rail link.
    expect(screen.queryByRole('link', { name: 'Bank Statements' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AP / Billing' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New run' })).toBeInTheDocument();
  });

  it('leaves Reports & export out of the Analyze category now that it lives in Runs', () => {
    renderRail();

    const analyzeCategory = screen.getByLabelText('Analyze');
    expect(within(analyzeCategory).queryByText('Reports & export')).not.toBeInTheDocument();
    expect(within(analyzeCategory).getByText('Open items')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Match results' }));

    expect(globalThis.localStorage.getItem(storageKey)).toBe('false');
  });
});
