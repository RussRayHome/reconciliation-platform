import type { Page } from '@playwright/test';

import { expect, expectedPathname, test } from '../fixtures';
import { loginToApplication, submitRunButton } from '../auth';
import { routePaths } from '../../../src/routes/routePaths';

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
  openItemsSchedule: { heading: 'Open Items Schedule' },
  // A-D1 (Issue #338): the bank account registry. Registered unconditionally -- unlike
  // documentationRunBook/approvalsPolicy, permission is a `canManage` prop on the screen, not a
  // guard on the <Route> -- so the generic loop's "renders and stays put" assumption holds.
  bankAccounts: { heading: 'Bank accounts' },
  // UI-9 (#448): both registries render the same screen, differing only in copy.
  apEntities: { heading: 'AP entities' },
  arEntities: { heading: 'AR entities' },
  mappingProfiles: { heading: 'Mapping Profiles' },
  // Branches on the logged-in account's verification state (App.tsx ~1279): CreateMappingScreen
  // once fully verified, otherwise MappingVerificationRequiredNotice. Both are a correct render
  // of this route -- the test account's verification state isn't what this sweep is checking.
  mappingCreate: { heading: ['Create Mapping', 'Verification required'] },
  mappingRules: { heading: 'Matching Rules' },
  mappingHistory: { heading: 'Mapping History' },
  mappingVersions: { heading: 'Mapping Profile Versions' },
  mappingRulesVersions: { heading: 'Matching Rule Versions' },
  // N1: the five approvalsXxx keys below are NOT here -- each one now redirects rather than
  // rendering its own heading, so the generic "stays put" assumption this loop makes (line ~196)
  // no longer holds for them. Handled explicitly, right after this loop, same reasoning as
  // documentationRunBook/approvalsPolicy being outside this map for their own conditional-render
  // reasons.
  approvals: { heading: 'Pending approvals' },
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

// approvalsPolicy's <Route> is likewise only registered when the logged-in account is admin or
// superuser (App.tsx: `{isAdmin ? <Route .../> : null}`) -- same conditional-existence situation
// and same fixed-credential-order caveat as documentationRunBook above.
const APPROVAL_POLICY_HEADING = 'Approval policy';

/** Pre-auth routes, reachable without logging in. */
const PUBLIC_ROUTES: Readonly<Record<string, RouteAssertion>> = {
  login: { heading: 'Log in' },
  forgotPassword: { heading: 'Forgot Password' },
  signup: { heading: 'Create an account' },
  support: { heading: 'Contact Support' },
};

// importFilesBank ('/') renders SourceUploadSection; importFilesBilling ('/imports/billing', R1
// WP2/WP3) was absorbed into it as a source tab in UI-2 and no longer renders anything of its
// own. The rendering route had no heading element at all when this sweep was written, so every
// other e2e spec targets the run-submission button instead (see auth.ts's submitRunButton/
// openSetup, and R1 WP3: Run Configuration -- and its Submit button -- is a sibling of the tab
// panels, always rendered regardless of which tab is active). UI-2 added an <h1> ("Start a
// reconciliation run"), so a heading landmark now exists; the button locator is kept because the
// step below races it against reconSummary's heading, and swapping in a second heading would make
// that race harder to read for no added coverage. R2 V4: that button's accessible name is now phase-dependent ("Submit run" / "Retry
// run" / "Start new run"), so this landmark uses submitRunButton(page) (a stable `form`-attribute
// locator), not a role+name pair.

const accountedForKeys = [
  // importFiles is a plain alias for importFilesBank (same string, '/', R1 WP2) -- not a
  // separate rendered route, so no dedicated test.step for it; importFilesBank's own step below
  // covers the path both keys resolve to.
  'importFiles',
  'importFilesBank',
  'importFilesBilling',
  'documentationRunBook',
  'approvalsPolicy',
  // N1: one-release redirects to the object each used to shadow -- verified in their own
  // test.step blocks below, not the generic AUTHENTICATED_ROUTES loop (see the comment there).
  'approvalsImports',
  'approvalsMappingProfiles',
  'approvalsMatchingRules',
  'approvalsExceptionResolutions',
  'approvalsReportDistribution',
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
      expect(new URL(page.url()).pathname).toBe(
        expectedPathname(routePaths[routeKey as keyof typeof routePaths]),
      );
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
      // Raised from the global 60s (playwright.config.ts): a real CI run (docker-validate.yml's
      // e2e-functional, first live trigger of that job) failed here 3 times in a row --
      // identically, not flakily -- with the importFiles/reconSummary race below timing out at
      // its default ~30s. The uploaded page snapshot at failure time showed the "Run
      // reconciliation" button HAD rendered, just after that wait gave up -- this route is the
      // first thing any test in this file's shard renders post-login, and it's a heavier page
      // than most (nav rail rules-count and exceptions-count badges, a run-status summary bar for
      // an existing completed run, the full upload form), so a cold Vite dev-server transform on
      // a slower/contended runner can genuinely take longer than 30s to finish here even though
      // it's near-instant warm/local. A first fix at 45s/120s still failed once locally under
      // this machine's own full-functional-suite parallel run (all 47 tests contending for CPU
      // at once -- a harsher scenario than CI's actual one-shard-per-VM model, but real evidence
      // 45s can still be marginal), so this has real margin built in, not just enough to clear
      // the first failure. Raising the whole test's budget, not the global default, so this
      // doesn't mask genuine slowness in some other, unrelated test.
      test.setTimeout(150_000);

      await loginToApplication(page);

      await test.step(`importFilesBank (${routePaths.importFilesBank})`, async () => {
        await page.goto(routePaths.importFilesBank);

        // App.tsx intentionally redirects '/' -> reconSummary when the logged-in account
        // already has a completed reconciliation run (same behavior reconciliation-edge-
        // cases.spec.ts exercises directly after running one) -- not a broken route. Whether
        // that's true here depends on whatever earlier tests already did with this shared
        // login in this run, so accept either the fresh setup form or that redirect; only a
        // route that resolves to neither is the "fell through to something wrong" failure this
        // sweep is meant to catch. Race two real waits (not .isVisible(), which doesn't
        // auto-wait) rather than assume one is already settled. Explicit 60s timeout on each
        // wait (was the implicit ~30s default) -- see the cold-CI-render comment above.
        const result = await Promise.race([
          submitRunButton(page)
            .waitFor({ state: 'visible', timeout: 60_000 })
            .then(() => 'importFilesBank' as const),
          page
            .getByRole('heading', { name: 'Review' })
            .waitFor({ state: 'visible', timeout: 60_000 })
            .then(() => 'reconSummary' as const),
        ]).catch(() => null);
        expect.soft(result).not.toBeNull();
      });

      await test.step(`importFilesBilling (${routePaths.importFilesBilling})`, async () => {
        await page.goto(routePaths.importFilesBilling);

        // UI-2 absorbed AP/Billing into New run as a source tab, so this path no longer renders a
        // screen -- it redirects to the tab that replaced it. Kept in the sweep rather than
        // dropped: it shipped, so the thing worth guarding is now that an old bookmark still lands
        // somewhere real instead of the unmatched-route fallback. Soft, like every other step, so
        // one route's failure does not abort the sweep.
        await expect.soft(submitRunButton(page)).toBeVisible({ timeout: 60_000 });

        const landed = new URL(page.url());
        expect.soft(landed.pathname).toBe(expectedPathname(routePaths.importFilesBank));
        expect.soft(landed.searchParams.get('source')).toBe('ap');
      });

      for (const [routeKey, { heading }] of Object.entries(AUTHENTICATED_ROUTES)) {
        const path = routePaths[routeKey as keyof typeof routePaths];

        await test.step(`${routeKey} (${path})`, async () => {
          await page.goto(path);

          await expectHeadingSoft(page, heading);

          // The unmatched-route fallback silently redirects to importFiles -- confirming the URL
          // stayed on this route is what actually catches that failure mode, since a redirected
          // page can still happen to render *a* heading.
          expect.soft(new URL(page.url()).pathname).toBe(expectedPathname(path));
        });
      }

      // N1: "every old approval URL lands on the object it shadowed" -- each of these five is now
      // an unconditional <Navigate>, so (unlike importFilesBank/documentationRunBook above) there's
      // exactly one correct outcome per route, not a role/state-dependent branch to race.
      await test.step(`approvalsImports (${routePaths.approvalsImports})`, async () => {
        await page.goto(routePaths.approvalsImports);
        // Redirects to importFilesBank ('/'), which has no heading of its own -- same
        // race-two-real-waits pattern as that route's own step above, since landing on '/' can
        // itself further redirect to reconSummary depending on existing run state.
        const result = await Promise.race([
          submitRunButton(page)
            .waitFor({ state: 'visible', timeout: 60_000 })
            .then(() => 'importFilesBank' as const),
          page
            .getByRole('heading', { name: 'Review' })
            .waitFor({ state: 'visible', timeout: 60_000 })
            .then(() => 'reconSummary' as const),
        ]).catch(() => null);
        expect.soft(result).not.toBeNull();
      });

      await test.step(`approvalsMappingProfiles (${routePaths.approvalsMappingProfiles})`, async () => {
        await page.goto(routePaths.approvalsMappingProfiles);
        // No real object screen exists for this non-live type -- redirects to the inbox itself.
        await expectHeadingSoft(page, 'Pending approvals');
        expect.soft(new URL(page.url()).pathname).toBe(expectedPathname(routePaths.approvals));
      });

      await test.step(`approvalsMatchingRules (${routePaths.approvalsMatchingRules})`, async () => {
        await page.goto(routePaths.approvalsMatchingRules);
        await expectHeadingSoft(page, 'Matching Rules');
        expect.soft(new URL(page.url()).pathname).toBe(expectedPathname(routePaths.mappingRules));
      });

      await test.step(`approvalsExceptionResolutions (${routePaths.approvalsExceptionResolutions})`, async () => {
        await page.goto(routePaths.approvalsExceptionResolutions);
        await expectHeadingSoft(page, 'Review');
        expect.soft(new URL(page.url()).pathname).toBe(expectedPathname(routePaths.exceptions));
      });

      await test.step(`approvalsReportDistribution (${routePaths.approvalsReportDistribution})`, async () => {
        await page.goto(routePaths.approvalsReportDistribution);
        await expectHeadingSoft(page, 'Export');
        expect.soft(new URL(page.url()).pathname).toBe(expectedPathname(routePaths.export));
      });

      await test.step(`documentationRunBook (${routePaths.documentationRunBook})`, async () => {
        await page.goto(routePaths.documentationRunBook);

        // Whichever outcome -- the route existing (Run Book heading) or not (redirected to
        // importFiles) -- is correct depending on the role this sweep happened to log in as;
        // see the comment on RUN_BOOK_HEADING above. Same race-two-real-waits pattern as
        // importFiles, same explicit 60s timeout for the same cold-CI-render reason.
        const result = await Promise.race([
          page
            .getByRole('heading', { name: RUN_BOOK_HEADING })
            .waitFor({ state: 'visible', timeout: 60_000 })
            .then(() => 'runBook' as const),
          submitRunButton(page)
            .waitFor({ state: 'visible', timeout: 60_000 })
            .then(() => 'redirectedToImportFiles' as const),
        ]).catch(() => null);
        expect.soft(result).not.toBeNull();

        if (result === 'runBook') {
          expect.soft(new URL(page.url()).pathname).toBe(
            expectedPathname(routePaths.documentationRunBook),
          );
        }
      });

      await test.step(`approvalsPolicy (${routePaths.approvalsPolicy})`, async () => {
        await page.goto(routePaths.approvalsPolicy);

        // Same either-outcome-is-correct reasoning as documentationRunBook above.
        const result = await Promise.race([
          page
            .getByRole('heading', { name: APPROVAL_POLICY_HEADING })
            .waitFor({ state: 'visible', timeout: 60_000 })
            .then(() => 'approvalPolicy' as const),
          submitRunButton(page)
            .waitFor({ state: 'visible', timeout: 60_000 })
            .then(() => 'redirectedToImportFiles' as const),
        ]).catch(() => null);
        expect.soft(result).not.toBeNull();

        if (result === 'approvalPolicy') {
          expect.soft(new URL(page.url()).pathname).toBe(
            expectedPathname(routePaths.approvalsPolicy),
          );
        }
      });
    });
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
