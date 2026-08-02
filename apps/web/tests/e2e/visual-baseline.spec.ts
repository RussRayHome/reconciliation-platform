import { createSampleBankWorkbook, createSampleGlWorkbook } from '@recon/test-fixtures';
import { expect, test, type Page } from '@playwright/test';

import { openSetup } from './auth';

// Visual acceptance oracle for the CSS layering refactor (docs/css-refactor-plan.md).
// Snapshots are recorded once on the pre-refactor tree; every later phase must
// produce ZERO diffs. Never regenerate after Phase 0.

// All three viewport variants submit the identical reconciliation (same account
// identifier and period label) as "superuser workspace". Running them concurrently
// races against shared backend run state and produces nondeterministic exception
// counts in the Review charts — confirmed by comparing a --workers=1 run against
// the default parallel run. Force this file to run serially to keep it deterministic.
test.describe.configure({ mode: 'serial' });

const widths = [1440, 1100, 900] as const;

const screenshotOptions = {
  fullPage: true,
  animations: 'disabled',
} as const;

// loginToApplication waits for the Import Files link, which only superuser/admin roles see;
// this variant just submits credentials and lets each test wait for its own landmark.
const loginAs = async (page: Page, username: string, password: string): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeHidden({ timeout: 10_000 });
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
    createSampleBankWorkbook(),
    createSampleGlWorkbook(),
  ]);

  await openSetup(page);

  await page.locator('#bank-workbook-input').setInputFiles({
    name: 'bank.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bankBuffer,
  });
  await page.locator('#gl-workbook-input').setInputFiles({
    name: 'gl.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: glBuffer,
  });
  await page.getByPlaceholder('OPERATING-001').fill('OPERATING-001');
  await page.getByLabel('Monthly reconciliation month').selectOption('March');
  await page.getByLabel('Reconciliation label').fill(`Monthly Recon for March ${currentYear}`);
  await page.getByRole('button', { name: 'Run reconciliation' }).click();
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 30_000 });
  // The Run Bar meter settles asynchronously after the run completes (3 of 4 steps —
  // the export step stays pending until Close). Wait for the settled value so every
  // post-run screenshot captures the same state.
  await expect(page.locator('.run-bar__meter-percent')).toHaveText('75%', { timeout: 30_000 });
};

for (const width of widths) {
  test.describe(`visual baseline @${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test(`login and error state @${width}`, async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
      await expect(page).toHaveScreenshot(`login-${width}.png`, screenshotOptions);

      await page.getByLabel('Username').fill('nobody');
      await page.getByLabel('Password').fill('wrong');
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page.locator('.login-error')).toBeVisible();
      await expect(page).toHaveScreenshot(`login-error-${width}.png`, screenshotOptions);
    });

    test(`superuser workspace @${width}`, async ({ page }) => {
      await loginAs(page, 'rray', 'P@ssw0rd');

      await openSetup(page);
      // Native <select> chrome (the dropdown arrow) renders with a few
      // non-deterministic pixels under headless Linux Chromium between
      // otherwise-identical runs — mask both selects on this screen rather
      // than loosen the pixel-diff tolerance suite-wide.
      await expect(page).toHaveScreenshot(`setup-upload-${width}.png`, {
        ...screenshotOptions,
        mask: [
          page.getByLabel('Reconciliation frequency'),
          page.getByLabel('Monthly reconciliation month'),
        ],
      });

      await page.locator('.run-bar__overflow-trigger').click();
      await page.getByRole('button', { name: 'Rules', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Rules Catalog' })).toBeVisible();
      await expect(page).toHaveScreenshot(`rules-panel-${width}.png`, screenshotOptions);

      await runReconciliation(page);
      await expect(page.getByText('Total reviewed')).toBeVisible();
      await expect(page).toHaveScreenshot(`review-summary-${width}.png`, screenshotOptions);

      await page.getByRole('link', { name: 'Probable matches' }).click();
      await expect(page).toHaveScreenshot(`probable-matches-${width}.png`, screenshotOptions);

      await page.getByRole('link', { name: 'Exceptions' }).click();
      await expect(page.getByPlaceholder('Search file, message, or tokens')).toBeVisible();
      await expect(page).toHaveScreenshot(`exceptions-triage-${width}.png`, screenshotOptions);

      await page.getByRole('link', { name: 'Export', exact: true }).click();
      // Artifact filenames embed the run id; mask them so baselines stay deterministic.
      await expect(page).toHaveScreenshot(`close-${width}.png`, {
        ...screenshotOptions,
        mask: [page.locator('.artifacts-grid h3')],
      });
    });

    test(`docs hub and document @${width}`, async ({ page }) => {
      await loginAs(page, 'rray', 'P@ssw0rd');
      await page.goto('/docs');
      await page.waitForLoadState('networkidle');
      await waitForStableLayout(page);
      await expect(page).toHaveScreenshot(`docs-hub-${width}.png`, screenshotOptions);

      const firstDocLink = page.locator('a[href^="/docs/"]').first();
      if (await firstDocLink.isVisible().catch(() => false)) {
        await firstDocLink.click();
        await page.waitForLoadState('networkidle');
        await waitForStableLayout(page);
        await expect(page).toHaveScreenshot(`docs-document-${width}.png`, screenshotOptions);
      }
    });

    test(`developer access denied @${width}`, async ({ page }) => {
      await loginAs(page, 'rray2', 'P@ssw0rd');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(
        `developer-access-denied-${width}.png`,
        screenshotOptions,
      );
    });

    test(`analyst workspace @${width}`, async ({ page }) => {
      await loginAs(page, 'bray', 'bray123');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`analyst-workspace-${width}.png`, screenshotOptions);
    });
  });
}
