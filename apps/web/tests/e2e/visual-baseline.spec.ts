import { createSampleBankWorkbook, createSampleQboWorkbook } from '@recon/test-fixtures';
import { expect, test, type Page } from '@playwright/test';

import { openSetup } from './auth';

// Visual acceptance oracle for the CSS layering refactor (docs/css-refactor-plan.md).
// Snapshots are recorded once on the pre-refactor tree; every later phase must
// produce ZERO diffs. Never regenerate after Phase 0.

const widths = [1440, 1100, 900] as const;

const screenshotOptions = {
  fullPage: true,
  animations: 'disabled',
} as const;

// loginToApplication waits for the Setup tab, which only superuser/admin roles see;
// this variant just submits credentials and lets each test wait for its own landmark.
const loginAs = async (page: Page, username: string, password: string): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { name: 'Login' })).toBeHidden({ timeout: 10_000 });
};

const runReconciliation = async (page: Page): Promise<void> => {
  const currentYear = new Date().getFullYear();
  const [bankBuffer, qboBuffer] = await Promise.all([
    createSampleBankWorkbook(),
    createSampleQboWorkbook(),
  ]);

  await openSetup(page);

  await page.locator('#bank-workbook-input').setInputFiles({
    name: 'bank.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bankBuffer,
  });
  await page.locator('#qbo-workbook-input').setInputFiles({
    name: 'qbo.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: qboBuffer,
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
      await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
      await expect(page).toHaveScreenshot(`login-${width}.png`, screenshotOptions);

      await page.getByLabel('Username').fill('nobody');
      await page.getByLabel('Password').fill('wrong');
      await page.getByRole('button', { name: 'Submit' }).click();
      await expect(page.locator('.login-error')).toBeVisible();
      await expect(page).toHaveScreenshot(`login-error-${width}.png`, screenshotOptions);
    });

    test(`superuser workspace @${width}`, async ({ page }) => {
      await loginAs(page, 'rray', 'rray');

      await openSetup(page);
      await expect(page).toHaveScreenshot(`setup-upload-${width}.png`, screenshotOptions);

      await page.goto('/?panel=rules');
      await expect(page.getByRole('tab', { name: 'Setup' })).toBeVisible();
      await expect(page).toHaveScreenshot(`rules-panel-${width}.png`, screenshotOptions);

      await runReconciliation(page);
      await expect(page.getByText('Total reviewed')).toBeVisible();
      await expect(page).toHaveScreenshot(`review-summary-${width}.png`, screenshotOptions);

      await page.locator('#tab-probable-matches').click();
      await expect(page).toHaveScreenshot(`probable-matches-${width}.png`, screenshotOptions);

      await page.locator('#tab-exceptions').click();
      await expect(page.getByPlaceholder('Search file, message, or tokens')).toBeVisible();
      await expect(page).toHaveScreenshot(`exceptions-triage-${width}.png`, screenshotOptions);

      await page.getByRole('tab', { name: 'Close' }).click();
      // Artifact filenames embed the run id; mask them so baselines stay deterministic.
      await expect(page).toHaveScreenshot(`close-${width}.png`, {
        ...screenshotOptions,
        mask: [page.locator('.artifacts-grid h3')],
      });
    });

    test(`docs hub and document @${width}`, async ({ page }) => {
      await loginAs(page, 'rray', 'rray');
      await page.goto('/docs');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`docs-hub-${width}.png`, screenshotOptions);

      const firstDocLink = page.locator('a[href^="/docs/"]').first();
      if (await firstDocLink.isVisible().catch(() => false)) {
        await firstDocLink.click();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot(`docs-document-${width}.png`, screenshotOptions);
      }
    });

    test(`developer access denied @${width}`, async ({ page }) => {
      await loginAs(page, 'rray2', 'rray2');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`developer-access-denied-${width}.png`, screenshotOptions);
    });

    test(`analyst workspace @${width}`, async ({ page }) => {
      await loginAs(page, 'bray', 'bray');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`analyst-workspace-${width}.png`, screenshotOptions);
    });
  });
}
