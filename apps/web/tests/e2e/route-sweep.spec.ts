import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { loginToApplication } from './auth';
import { routePaths } from '../../src/routes/routePaths';

type RouteAssertion = {
  /** Text of an accessible heading (role="heading") this route is expected to render, or an
   * array of headings when the route legitimately branches (e.g. on account verification
   * state) and either outcome is a correct render, not a bug. */
  heading: string | readonly string[];
};

/**
 * Every routePaths entry reachable once authenticated, mapped to the heading it renders. Sourced
 * by reading each route's element in App.tsx, not guessed -- see the individual comments below
 * for the handful of routes with real branching or no heading at all.
 */
const AUTHENTICATED_ROUTES: Readonly<Record<string, RouteAssertion>> = {
  reconSummary: { heading: 'Review' },
  probableMatches: { heading: 'Review' },
  exceptions: { heading: 'Review' },
  export: { heading: 'Export' },
  mappingProfiles: { heading: 'Mapping Profiles' },
  // Branches on the logged-in account's verification state (App.tsx ~1279): CreateMappingScreen
  // once fully verified, otherwise MappingVerificationRequiredNotice. Both are a correct render
  // of this route -- the test account's verification state isn't what this sweep is checking.
  mappingCreate: { heading: ['Create Mapping', 'Verification required'] },
  mappingRules: { heading: 'Matching Rules' },
  mappingHistory: { heading: 'Mapping History' },
  approvalsPending: { heading: 'Pending Imports' },
  approvalsApproved: { heading: 'Approved Imports' },
  approvalsRejected: { heading: 'Rejected Imports' },
  accountProfile: { heading: 'Profile' },
  accountSecurity: { heading: 'Security' },
  accountBilling: { heading: 'Billing' },
  accountNotification: { heading: 'Notification' },
  accountPreferences: { heading: 'Preferences' },
};

// documentationRunBook's <Route> is only registered at all when the logged-in account has
// rolePermissions.canAccessRunBook (App.tsx: `{canAccessRunBook ? <Route .../> : null}`) --
// without it, the route doesn't exist and the unmatched-route fallback redirects to importFiles,
// same as any other unregistered path. auth.ts's loginToApplication tries its fallback
// credentials in a fixed order (bray before rray) and returns whichever succeeds first, so which
// role -- and therefore whether this route exists -- isn't something this sweep controls. Handled
// separately from AUTHENTICATED_ROUTES's generic loop for that reason, with the same
// redirect-tolerant pattern as importFiles below.
const RUN_BOOK_HEADING = 'Run Book';

/** Pre-auth routes, reachable without logging in. */
const PUBLIC_ROUTES: Readonly<Record<string, RouteAssertion>> = {
  login: { heading: 'Log in' },
  forgotPassword: { heading: 'Forgot Password' },
  signup: { heading: 'Create an account' },
  support: { heading: 'Contact Support' },
};

// importFiles ('/') renders SourceUploadSection, which has no heading element at all -- every
// other e2e spec already targets its "Run reconciliation" button instead (see auth.ts's
// openSetup), so this sweep does the same rather than inventing a heading that isn't there.
const IMPORT_FILES_LANDMARK_ROLE = 'button';
const IMPORT_FILES_LANDMARK_NAME = 'Run reconciliation';

const accountedForKeys = [
  'importFiles',
  'documentationRunBook',
  ...Object.keys(PUBLIC_ROUTES),
  ...Object.keys(AUTHENTICATED_ROUTES),
].sort();

/** Asserts one of `heading`'s candidates is visible as an exact-match accessible heading name --
 * anchored, so e.g. "Review" doesn't also match an unrelated "Reviewer decision" heading
 * elsewhere on the page. Soft: a miss on one route shouldn't abort the sweep before every other
 * route has had a chance to report its own result too (see the single shared-login test below). */
async function expectHeadingSoft(page: Page, heading: string | readonly string[]): Promise<void> {
  const candidates = Array.isArray(heading) ? heading : [heading];
  const pattern = new RegExp(`^(?:${candidates.map(escapeRegExp).join('|')})$`);
  await expect.soft(page.getByRole('heading', { name: pattern })).toBeVisible();
}

test.describe('route sweep', () => {
  test('every routePaths entry is accounted for by this sweep', () => {
    expect(accountedForKeys).toEqual(Object.keys(routePaths).sort());
  });

  for (const [routeKey, { heading }] of Object.entries(PUBLIC_ROUTES)) {
    test(`${routeKey} (${routePaths[routeKey as keyof typeof routePaths]}) renders unauthenticated`, async ({
      page,
    }) => {
      await page.goto(routePaths[routeKey as keyof typeof routePaths]);

      await expectHeadingSoft(page, heading);
      expect(new URL(page.url()).pathname).toBe(routePaths[routeKey as keyof typeof routePaths]);
    });
  }

  test.describe('authenticated', () => {
    // One shared login for the whole sweep, not one per route: the backend rate-limits
    // /api/auth/me at 120 requests/minute, and 18 fresh logins in quick succession (one per
    // route, the way every other e2e spec's test.beforeEach does it) tripped that limit --
    // confirmed via the trace network log (a 429 on /api/auth/me right where the sweep started
    // failing). test.step + expect.soft keeps the same per-route reporting granularity as
    // separate tests would have given, without the extra login traffic that caused it.
    test('every in-app route renders its expected heading and does not fall through to the login redirect', async ({
      page,
    }) => {
      await loginToApplication(page);

      await test.step(`importFiles (${routePaths.importFiles})`, async () => {
        await page.goto(routePaths.importFiles);

        // App.tsx intentionally redirects '/' -> reconSummary when the logged-in account
        // already has a completed reconciliation run (same behavior reconciliation-edge-
        // cases.spec.ts exercises directly after running one) -- not a broken route. Whether
        // that's true here depends on whatever earlier tests already did with this shared
        // login in this run, so accept either the fresh setup form or that redirect; only a
        // route that resolves to neither is the "fell through to something wrong" failure this
        // sweep is meant to catch. Race two real waits (not .isVisible(), which doesn't
        // auto-wait) rather than assume one is already settled.
        const result = await Promise.race([
          page
            .getByRole(IMPORT_FILES_LANDMARK_ROLE, { name: IMPORT_FILES_LANDMARK_NAME })
            .waitFor({ state: 'visible' })
            .then(() => 'importFiles' as const),
          page
            .getByRole('heading', { name: 'Review' })
            .waitFor({ state: 'visible' })
            .then(() => 'reconSummary' as const),
        ]).catch(() => null);
        expect.soft(result).not.toBeNull();
      });

      for (const [routeKey, { heading }] of Object.entries(AUTHENTICATED_ROUTES)) {
        const path = routePaths[routeKey as keyof typeof routePaths];

        await test.step(`${routeKey} (${path})`, async () => {
          await page.goto(path);

          await expectHeadingSoft(page, heading);

          // The unmatched-route fallback silently redirects to importFiles -- confirming the URL
          // stayed on this route is what actually catches that failure mode, since a redirected
          // page can still happen to render *a* heading.
          expect.soft(new URL(page.url()).pathname).toBe(path);
        });
      }

      await test.step(`documentationRunBook (${routePaths.documentationRunBook})`, async () => {
        await page.goto(routePaths.documentationRunBook);

        // Whichever outcome -- the route existing (Run Book heading) or not (redirected to
        // importFiles) -- is correct depending on the role this sweep happened to log in as;
        // see the comment on RUN_BOOK_HEADING above. Same race-two-real-waits pattern as
        // importFiles.
        const result = await Promise.race([
          page
            .getByRole('heading', { name: RUN_BOOK_HEADING })
            .waitFor({ state: 'visible' })
            .then(() => 'runBook' as const),
          page
            .getByRole(IMPORT_FILES_LANDMARK_ROLE, { name: IMPORT_FILES_LANDMARK_NAME })
            .waitFor({ state: 'visible' })
            .then(() => 'redirectedToImportFiles' as const),
        ]).catch(() => null);
        expect.soft(result).not.toBeNull();

        if (result === 'runBook') {
          expect.soft(new URL(page.url()).pathname).toBe(routePaths.documentationRunBook);
        }
      });
    });
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
