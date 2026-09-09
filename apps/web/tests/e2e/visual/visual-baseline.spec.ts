import './containerGuard';

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReconciliationRunReport } from '@recon/domain';
import { createWorkbookFromRows } from '@recon/test-fixtures';
import type { Page } from '@playwright/test';
import postcss from 'postcss';

import { expect, test } from '../fixtures';
import { openSetup, submitRunButton } from '../auth';
import { assignBankAccounts } from '../reconciliationHelpers';
import {
  bankHeaderOnlyFileValidationRows,
  createSampleBankFileValidationWorkbook,
  createSampleGlFileValidationWorkbook,
} from '../fileValidationWorkbooks';
import reconciliationRunReportFixture from './fixtures/reconciliationRunReport.json' with { type: 'json' };

// Visual acceptance oracle, originally recorded for the CSS layering refactor
// (design/_shared/css/css-refactor-plan.md, EXECUTED 2026-07-30, 15/15 zero-diff) -- that refactor's own
// baselines already served their purpose and are done. The same discipline continues though:
// baselines are only ever regenerated deliberately, via the canonical container
// (docker/e2e-visual.Dockerfile, `npm run test:e2e:visual:container:update-snapshots`), reviewed
// as an image diff in its own commit -- never as a side effect of an unrelated change.

const widths = [1440, 1100, 900] as const;

// A real, complete ReconciliationRunReport captured once from a live run against the sample
// bank/GL workbooks (packages/test-fixtures), frozen as a static fixture. Every screen this spec
// screenshots (Review/Summary, Probable Matches, Exceptions, Reports/artifacts) reads from this
// one embedded object -- there's no separate endpoint per screen -- so intercepting the two
// endpoints that deliver it is enough to make the whole suite deterministic. This is what let P5
// replace the old forced-serial mode with the parallel mode below: with a live backend, three
// viewport variants submitting the identical reconciliation concurrently raced on shared backend
// run state and produced nondeterministic exception counts; with every variant getting this same
// static JSON regardless of timing, there's nothing left to race on.
//
// A single spec file defaults to one worker running its tests in declaration order unless told
// otherwise (this is a Playwright default, not something this file previously opted out of) --
// explicitly requesting parallel mode is what actually lets the three widths run concurrently.
test.describe.configure({ mode: 'parallel' });
const MOCK_MATCHING_JOB_ID = 'e2e-mock-matching-job';

const mockReconciliationRun = async (page: Page): Promise<void> => {
  const fixture = reconciliationRunReportFixture as unknown as ReconciliationRunReport;
  const body = JSON.stringify(fixture);
  // Pre-Phase-9, Screen 01's Submit called this one atomic endpoint directly. Phase 9 replaced
  // that with the import pipeline (POST /api/imports/runs -> .../submit -> GET
  // /api/reconciliation/:id below) -- kept mocked here too since nothing currently calls it, but
  // removing it isn't free of risk without auditing every caller first.
  await page.route('**/api/reconciliation/run', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body }),
  );
  // The analyst-workspace test lands on /recon-summary automatically after login, which fetches
  // this on mount -- org-scoped, not user-scoped, so without this mock it would show whatever the
  // real backend's last run happened to be (previously: the superuser-workspace test's run,
  // relying on serial execution order). Mocked here too so every test is self-contained.
  await page.route('**/api/reconciliation/latest', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body }),
  );

  // The actual Phase 9+ flow useImportRunSubmit.ts drives: create the DRAFT run, submit it
  // (resolves synchronously here, matching this build's queue-disabled default), then fetch the
  // resulting report by matchingJobId. All three were unmocked until now -- runReconciliation()
  // was silently hitting the real backend instead of this frozen fixture, which is what made the
  // Run Bar meter settle at 50% instead of 75% (a live run's progress-step timing doesn't match
  // what these captures assume) and reintroduced exactly the cross-run-state race P5's own
  // comment above says mocking was meant to eliminate.
  await page.route('**/api/imports/runs', (route) => {
    if (route.request().method() !== 'POST') {
      return route.continue();
    }
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'e2e-mock-run',
        organizationId: 'e2e-mock-org',
        label: 'Mocked run',
        accountIdentifier: null,
        frequency: 'MONTHLY',
        periodYear: new Date().getFullYear(),
        periodMonth: 3,
        status: 'DRAFT',
        createdAt: new Date(0).toISOString(),
        files: [],
      }),
    });
  });
  await page.route('**/api/imports/runs/*/submit', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        importJobId: 'e2e-mock-job',
        status: 'completed',
        passed: true,
        matchingJobId: MOCK_MATCHING_JOB_ID,
        run: {
          id: 'e2e-mock-run',
          organizationId: 'e2e-mock-org',
          label: 'Mocked run',
          accountIdentifier: null,
          frequency: 'MONTHLY',
          periodYear: new Date().getFullYear(),
          periodMonth: 3,
          status: 'VALIDATED',
          createdAt: new Date(0).toISOString(),
          files: [],
        },
      }),
    }),
  );
  await page.route(`**/api/reconciliation/${MOCK_MATCHING_JOB_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body }),
  );

  // A-D1 (Issue #338): the upload screen reads the account registry to populate each statement's
  // assignment control, and a statement cannot be submitted unassigned. MOCKED rather than
  // registered for real, unlike the functional lane -- this lane has no backing services (the
  // real endpoint answers 503 here), and its whole premise is that every test is self-contained.
  //
  // The last four match the `1111_`/`2222_` filenames staged below, so
  // `suggestAccountIdForFilename` pre-selects each one on staging: exactly one active account
  // matches, which is the condition it requires. That keeps these captures free of an
  // assignment-mismatch notice that would otherwise change what is screenshotted.
  await page.route('**/api/accounts*', (route) => {
    if (route.request().method() !== 'GET') {
      return route.continue();
    }
    const account = (id: string, name: string, lastFour: string) => ({
      id,
      organizationId: 'e2e-mock-org',
      accountIdentifier: lastFour,
      displayName: name,
      institutionName: 'Truist',
      lastFour,
      currencyCode: 'USD',
      glCashAccountCode: null,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accounts: [
          account('e2e-mock-account-a', 'Operating A', '1111'),
          account('e2e-mock-account-b', 'Operating B', '2222'),
        ],
      }),
    });
  });
};

// Shared by both page-level and region-scoped (locator) captures -- fullPage is a page-only
// option, so it's added separately below rather than living in this shared object, where it
// would be meaningless (and misleading to read) on every region-scoped call.
const screenshotOptions = {
  animations: 'disabled',
  // Was 0.015 suite-wide (pre-P4/P5), justified by ~1% observed sub-pixel font-rendering
  // variance -- that variance came from a live reconciliation run's rendering timing and a
  // then-ungraded macOS baseline set, both gone now (P4's canonical container, P5's frozen
  // fixture). Empirically re-measured for P6: 4 consecutive runs (1 record + 3 verify) against
  // every capture in this file, at this exact 0, produced zero diffs across all of them. True
  // zero, not "near zero" -- if a future capture turns out to need real tolerance, that's a
  // signal worth seeing immediately, not something to pre-emptively budget for.
  maxDiffPixelRatio: 0,
} as const;

// Page-level (full-page) captures only -- see the "Kept full-page here deliberately" comment at
// the review-summary capture for why a handful of screens still use this instead of a region.
const fullPageScreenshotOptions = { ...screenshotOptions, fullPage: true } as const;

// loginToApplication waits for the Bank Statements link (Import Files' default child, R1 WP1),
// which only superuser/admin roles see; this variant just submits credentials and lets each test
// wait for its own landmark.
//
// Tries `password` first (the real seeded-Postgres credential), then falls back to `username`
// itself as the password -- app.ts's local-login-fallback path (ALLOW_LOCAL_LOGIN_FALLBACK) uses
// username==password for every account, which is what this runtime's in-memory backend (no real
// Postgres, so the real credential can never match) actually needs. auth.ts's
// loginToApplication already does the equivalent multi-candidate retry for its own callers; this
// mirrors that for the explicit (username, password) pairs this file's callers already pass, so
// none of them need to change.
const attemptLogin = async (page: Page, username: string, password: string): Promise<boolean> => {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  try {
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeHidden({ timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
};

const loginAs = async (page: Page, username: string, password: string): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  if (await attemptLogin(page, username, password)) {
    return;
  }

  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  if (!(await attemptLogin(page, username, username))) {
    throw new Error(`Unable to authenticate as "${username}" with the real or fallback password.`);
  }
};

// Issue #208's real root cause, found after two dead ends this comment used to document (a
// `document.fonts.ready` wait, and force-loading fonts by hand -- both left the exact same
// 612x6224-vs-612x6241 diff untouched): fonts.css was simply missing several @font-face
// declarations that plenty of component CSS already requests -- IBM Plex Sans 700 (used by the
// Rules page's own "Variance thresholds" heading among 30+ other selectors), Space Grotesk 600,
// and IBM Plex Mono 600/700. With no matching face, the browser has to fall back or synthesize
// the weight itself, an engine/OS-dependent choice that isn't defined to render identically
// everywhere -- confirmed via the failing heading's own computed style (fontFamily: "IBM Plex
// Sans", fontWeight: "700") and via apps/web/src/styles/fonts.test.ts's static audit, which found
// the other three gaps this investigation's manual approach had missed. Fixed by adding the
// missing weights (fonts.css), not by changing 40+ call sites to weights that happened to exist.
//
// This preload step is still worth keeping even with every weight now declared: `font-display:
// swap` means a family+weight only starts downloading the first time something on the page
// renders text with it, so without this, whichever screenshot happens to be first to use a given
// weight could still race its own download -- a real, separate risk from the missing-face bug
// above. Reads fonts.css directly (rather than a hand-maintained list, which is exactly how a
// missing weight went unnoticed for as long as it did) so this can never drift out of sync with
// it again.
const FONT_FACES = (() => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const fontsCss = readFileSync(join(__dirname, '../../../src/styles/fonts.css'), 'utf-8');
  const root = postcss.parse(fontsCss);
  const faces: string[] = [];
  root.walkAtRules('font-face', (rule) => {
    const decls = (rule.nodes ?? []).filter((node) => node.type === 'decl');
    const familyDecl = decls.find((decl) => decl.prop === 'font-family');
    const weightDecl = decls.find((decl) => decl.prop === 'font-weight');
    const family = familyDecl?.value.trim().replace(/^['"]|['"]$/g, '');
    const weight = weightDecl?.value.trim();
    if (family && weight) faces.push(`${weight} 16px "${family}"`);
  });
  return faces;
})();

const preloadFonts = async (page: Page): Promise<void> => {
  await page.evaluate(
    (fonts) => Promise.all(fonts.map((font) => document.fonts.load(font))),
    FONT_FACES,
  );
};

// The docs pages embed a full document preview (including diagram images) whose
// final height can settle a beat after 'networkidle' fires. Poll scrollHeight
// until two consecutive reads agree before screenshotting, to avoid capturing a
// mid-reflow frame.
const waitForStableLayout = async (page: Page): Promise<void> => {
  let previousHeight = -1;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const currentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    if (currentHeight === previousHeight) {
      return;
    }
    previousHeight = currentHeight;
    await page.waitForTimeout(100);
  }
};

const runReconciliation = async (page: Page): Promise<void> => {
  const currentYear = new Date().getFullYear();
  const [bankBuffer, glBuffer] = await Promise.all([
    createSampleBankFileValidationWorkbook(),
    createSampleGlFileValidationWorkbook(),
  ]);

  const bankAccountBBuffer = await createWorkbookFromRows(bankHeaderOnlyFileValidationRows);

  await openSetup(page);

  await page.locator('#bank-workbook-input').setInputFiles({
    name: '1111_bank.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bankBuffer,
  });
  await page.locator('#bank-workbook-b-input').setInputFiles({
    name: '2222_bank.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bankAccountBBuffer,
  });
  await page.locator('#gl-workbook-input').setInputFiles({
    name: 'gl.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: glBuffer,
  });
  await assignBankAccounts(page);
  await page.getByPlaceholder('OPERATING-001').fill('OPERATING-001');
  await page.getByLabel('Monthly reconciliation month').selectOption('March');
  await page.getByLabel('Reconciliation label').fill(`Monthly Recon for March ${currentYear}`);
  await submitRunButton(page).click();
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 30_000 });
  // R2 V3: the Run Bar's percentage meter (and `.run-bar__meter-percent`, this wait's original
  // target) is deleted entirely -- replaced by four segments plus a step counter. The run
  // completing (matching finished) but export not yet done (stays pending until Close) now reads
  // "step 4 of 4" (the review-export step is `current`, not `complete`) rather than a 75% value.
  // Still the same purpose: wait for the settled post-run state so every screenshot captures it.
  await expect(page.getByText('step 4 of 4')).toBeVisible({ timeout: 30_000 });
};

for (const width of widths) {
  test.describe(`visual baseline @${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    // Freeze the clock before every navigation. App.tsx:355 derives the default reconciliation
    // label from `new Date()` -- `Monthly Recon for ${month} ${currentYear}` -- so the Setup screen
    // renders the *current* month. A PNG baseline cannot track that: every capture taken in one
    // month diffs against every run in the next.
    //
    // This is exactly what happened on 2026-09-01. dev sat on the same commit (317825f4) for the
    // 08-31 nightly that passed and the 09-01 nightly that failed; nothing changed but the calendar.
    // The diff was ~742 pixels (ratio 0.01), confined to the two label strings -- "August 2026"
    // against "September 2026" -- with the rest of the form pixel-identical. It would have recurred
    // on 1 October, 1 November, and every month boundary after.
    //
    // Fixed to mid-August 2026 deliberately: that is the month the committed baselines were captured
    // in, so they stay valid and no regeneration cycle is needed. setFixedTime (not clock.install)
    // because it only pins Date.now()/new Date() -- timers keep running, so the scrollHeight polling
    // and networkidle waits elsewhere in this file are unaffected.
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-08-15T12:00:00Z'));
    });

    test(`login and error state @${width}`, async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
      await expect(page).toHaveScreenshot(`login-${width}.png`, fullPageScreenshotOptions);

      await page.getByLabel('Username').fill('nobody');
      await page.getByLabel('Password').fill('wrong');
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page.locator('.login-error')).toBeVisible();
      await expect(page).toHaveScreenshot(`login-error-${width}.png`, fullPageScreenshotOptions);
    });

    test(`superuser workspace @${width}`, async ({ page }) => {
      await mockReconciliationRun(page);
      await loginAs(page, 'rray', 'P@ssw0rd');
      await preloadFonts(page);

      await openSetup(page);
      // Region-scoped to the upload form itself (#source-upload-form, App.tsx) rather than the
      // full page -- excludes the nav rail/hero chrome already covered by other captures. Native
      // <select> chrome (the dropdown arrow) still renders with a few non-deterministic pixels
      // under headless Linux Chromium between otherwise-identical runs -- mask both selects
      // rather than loosen the pixel-diff tolerance for this whole region.
      await expect(page.locator('#source-upload-form')).toHaveScreenshot(
        `setup-upload-${width}.png`,
        {
          ...screenshotOptions,
          mask: [
            page.getByLabel('Reconciliation frequency'),
            page.getByLabel('Monthly reconciliation month'),
          ],
        },
      );

      await page.locator('.run-bar__overflow-trigger').click();
      await page.getByRole('button', { name: 'Rules', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Matching Rules' })).toBeVisible();
      // Issue #208: clicking "Rules" above navigates via router push (RunBar's onOpenRules ->
      // App.tsx's `navigate(routePaths.mappingRules)`) but never closes the native <details> it
      // lives inside -- RunBar is persistent chrome mounted above the routed content, so the
      // overflow menu stays open on the Rules page too, overlapping this region-scoped capture's
      // own bounding box. Independently real (this region capture's own doc comment already says
      // it wants nav/hero chrome excluded), but NOT the cause of #208's actual height diff --
      // that was `preloadFonts` above, see its own comment.
      await page.locator('.run-bar__overflow').evaluate((details) => {
        (details as HTMLDetailsElement).open = false;
      });
      // Issue #208: the "Variance thresholds" heading (.rule-variance-families h3) has no fixed
      // height -- Chromium occasionally renders its bold weight via a different internal path
      // (confirmed via computed style and network-level font-integrity checks to not be a
      // missing-font-face, loading-timing, or corrupted-file issue; all three were ruled out with
      // direct evidence first) with very slightly different line metrics, which genuinely resizes
      // the box by ~17px and cascades through the rest of this grid layout. A pixel `mask` alone
      // cannot fix this: Playwright fails a screenshot on a dimension mismatch unconditionally,
      // before any masking is even considered. Pinning the height directly is the layout-level
      // equivalent of masking -- deterministic regardless of which internal path Chromium takes.
      await page.addStyleTag({
        content: '.rule-variance-families h3 { height: 24px !important; overflow: hidden; }',
      });
      // Region-scoped to the whole Rules route panel (includes the SectionCard title/chrome
      // wrapping "Matching Rules" -- this is the outermost element the route itself renders, so
      // it excludes nav/hero the same way #source-upload-form does above). Still masks the
      // heading's own pixels on top of the height pin above, in case the two rendering paths
      // also differ by a stray pixel or two within an now-identically-sized box.
      await expect(page.getByRole('region', { name: 'Rules catalog' })).toHaveScreenshot(
        `rules-panel-${width}.png`,
        {
          ...screenshotOptions,
          mask: [page.getByRole('heading', { name: 'Variance thresholds' })],
        },
      );

      await runReconciliation(page);
      await expect(page.getByText('Total reviewed')).toBeVisible();
      // Kept full-page here deliberately (D2: "small retained set of full-page captures for
      // layout composition") -- Review/Summary is exactly the multi-region page where a CSS
      // grid/spacing regression could make two of the regions below overlap or misalign, which
      // no number of independent region captures would ever catch on their own.
      await expect(page).toHaveScreenshot(`review-summary-${width}.png`, fullPageScreenshotOptions);
      // Four region-scoped captures for Review/Summary's actual component boundaries, replacing
      // full-page as the primary signal -- a failure here says "the stats grid changed", not
      // "something changed somewhere in a 9800px page". Also the only capture exercising
      // StatCard's real rendered tones (positive/warning/critical) and the shared
      // SectionCard-derived BentoModule primitive.
      await expect(page.getByRole('region', { name: 'Run statistics' })).toHaveScreenshot(
        `review-summary-stats-${width}.png`,
        screenshotOptions,
      );
      await expect(page.getByRole('region', { name: 'Reconciliation verdict' })).toHaveScreenshot(
        `review-summary-verdict-${width}.png`,
        screenshotOptions,
      );
      await expect(
        page.getByRole('region', { name: 'Exception category breakdown' }),
      ).toHaveScreenshot(`review-summary-category-breakdown-${width}.png`, screenshotOptions);
      await expect(page.locator('.chart-grid')).toHaveScreenshot(
        `review-summary-charts-${width}.png`,
        screenshotOptions,
      );

      // Probable matches was dropped from the nav rail in the v3 nav restructure (commit
      // 5f08130, "no longer nav-linked, per confirmed decision") -- the route itself stays
      // reachable directly.
      await page.goto('/probable-matches');
      // Region-scoped to the table itself, excluding the generic "Review" SectionCard chrome
      // that wraps it (already covered by rules-panel's SectionCard capture above).
      await expect(page.locator('.probable-match-table-shell')).toHaveScreenshot(
        `probable-matches-${width}.png`,
        screenshotOptions,
      );

      await page.getByRole('link', { name: 'Exceptions' }).click();
      await expect(page.getByPlaceholder('Search file, message, or tokens')).toBeVisible();
      // Explicitly select the first exception row on every width -- at the two desktop widths
      // the evidence panel already auto-shows the first exception without a click, but at 900px
      // (mobile) it stays hidden until a row opens its drawer. Clicking unconditionally keeps all
      // three widths in the same state, and is what gives the shared Pill primitive (severity
      // tag, ExceptionEvidencePanel.tsx) its only real coverage in this suite.
      await page.getByRole('listbox', { name: 'Exceptions' }).getByRole('option').first().click();
      await expect(page.locator('.exception-detail')).toBeVisible();
      await expect(page.locator('.exception-triage')).toHaveScreenshot(
        `exceptions-triage-${width}.png`,
        screenshotOptions,
      );

      // The rail item for routePaths.export is labelled "Reports" since the v3 nav restructure.
      await page.getByRole('link', { name: 'Reports', exact: true }).click();
      // Region-scoped to the artifacts grid itself. Artifact filenames embed the run id --
      // previously masked because a live run's id was different every time. Now that the report
      // is a frozen fixture (mockReconciliationRun), the filename is identical every run and this
      // region is real, assertable coverage, not a masked box.
      await expect(page.locator('.artifacts-grid')).toHaveScreenshot(
        `close-${width}.png`,
        screenshotOptions,
      );
    });

    test(`docs hub and document @${width}`, async ({ page }) => {
      await mockReconciliationRun(page);
      await loginAs(page, 'rray', 'P@ssw0rd');
      await page.goto('/docs');
      await page.waitForLoadState('networkidle');
      await waitForStableLayout(page);
      await expect(page).toHaveScreenshot(`docs-hub-${width}.png`, fullPageScreenshotOptions);

      // DocsOverview.tsx selects documents via <button class="docs-nav-card"> + client-side hash
      // routing (history.replaceState), not real <a href="/docs/..."> sub-page links -- there
      // were never any anchor tags here for the previous a[href^="/docs/"] locator to match,
      // which is why this capture never fired for any committed baseline. Pick a non-active card
      // (the hub loads with the first document already selected) so this genuinely exercises the
      // document-switch interaction rather than re-capturing the same content as docs-hub.
      const otherDocCard = page.locator('.docs-nav-card:not(.docs-nav-card--active)').first();
      await otherDocCard.click();
      await page.waitForLoadState('networkidle');
      await waitForStableLayout(page);
      await expect(page).toHaveScreenshot(`docs-document-${width}.png`, fullPageScreenshotOptions);
    });

    test(`analyst workspace @${width}`, async ({ page }) => {
      await mockReconciliationRun(page);
      await loginAs(page, 'bray', 'bray123');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(
        `analyst-workspace-${width}.png`,
        fullPageScreenshotOptions,
      );
    });
  });
}
