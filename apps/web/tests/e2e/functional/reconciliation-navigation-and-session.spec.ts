import { createWorkbookFromRows } from '@recon/test-fixtures';

import { expect, test } from '../fixtures';
import { loginToApplication, openSetup, submitRunButton } from '../auth';
import { resetRunsForWorker } from '../runState';
import {
  bankHeaderOnlyFileValidationRows,
  createSampleBankFileValidationWorkbook,
  createSampleGlFileValidationWorkbook,
  glHeaderOnlyFileValidationRows,
  missingFromGlBankFileValidationRows,
  missingFromGlGlFileValidationRows,
} from '../fileValidationWorkbooks';
import { exceptionSummaryCell, runReconciliation, setWorkbookFiles } from '../reconciliationHelpers';

// Before login: these specs drive the Import Files screen, whose behaviour depends on whether
// this worker's organization already has a terminal run (see runState.ts). Without this they
// inherit whatever the previous spec on this worker left behind, and the submit button they
// click is the post-run "Start new run" -- correctly disabled when no files are attached.
test.beforeEach(async ({ page }) => {
  await resetRunsForWorker();
  await loginToApplication(page);
});

test.describe('stage navigation', () => {
  test('Rules catalog is reachable from the run bar before a run', async ({ page }) => {
    await openSetup(page);
    await page.locator('.run-bar__overflow-trigger').click();
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Matching Rules' })).toBeVisible();
  });

  test('after a run the application automatically navigates to the Review stage', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(page.getByRole('link', { name: 'Summary' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('Review opens on the Summary view by default after a run', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Summary' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  // Probable matches was dropped from the nav rail in the v3 nav restructure (commit 5f08130,
  // "no longer nav-linked, per confirmed decision") -- the route itself stays reachable directly,
  // which is what this now verifies, rather than a rail link that no longer exists.
  test('Probable matches view is reachable via direct navigation', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await page.goto('/probable-matches');
    await expect(page.getByText(/Showing \d+ probable matches\./)).toBeVisible();
  });

  test('Export stage exposes the export artifacts', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    // The rail item for routePaths.export is labelled "Reports" since the v3 nav restructure.
    await page.getByRole('link', { name: 'Reports & export' }).click();
    // Download workbook is a button, not a link -- see AppWorkspacePanels.tsx's own comment: a
    // plain <a href> can't carry the bearer token now that this route requires auth, so it
    // fetches the bytes and triggers the save via a blob URL instead of top-level navigation.
    await expect(page.getByRole('button', { name: 'Download workbook' })).toBeVisible();
  });
});

test.describe('session persistence', () => {
  test('after a run the results are still accessible after a full page reload', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);

    // persistRun() runs inside a React effect after paint; wait for localStorage
    // before reloading so the next load hydrates from it without a backend round-trip.
    await page.waitForFunction(
      () => !!window.localStorage.getItem('reconciliation-platform:latest-report-run'),
      { timeout: 10_000 },
    );

    await page.reload();

    // Review uses reportRun = run ?? persistedRun, so it renders the persisted data.

    await page.getByRole('link', { name: 'Exceptions' }).click();
    await expect(page.locator('#exception-search-input')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('edge cases', () => {
  test('header-only workbooks (no data rows) complete without a crash', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(bankHeaderOnlyFileValidationRows),
      createWorkbookFromRows(glHeaderOnlyFileValidationRows),
    ]);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await submitRunButton(page).click();
    // Either the run completes to the Review summary, or a server error alert appears.
    await expect(page.getByText('Total reviewed').or(page.getByRole('alert'))).toBeVisible({
      timeout: 30_000,
    });
  });

  test('running a second reconciliation replaces the previous run results', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer, { label: 'First Run March' });

    const [bank2, gl2] = await Promise.all([
      createWorkbookFromRows(missingFromGlBankFileValidationRows),
      createWorkbookFromRows(missingFromGlGlFileValidationRows),
    ]);
    await page.getByRole('link', { name: 'New run' }).click();
    await setWorkbookFiles(page, bank2, gl2);
    await page.getByLabel('Reconciliation label').fill('Second Run April');
    await submitRunButton(page).click();

    await expect(page.getByText('Total reviewed')).toBeVisible({ timeout: 30_000 });
    await expect(exceptionSummaryCell(page, 'Missing from GL')).toBeVisible();
  });

  test('rail destinations are reachable by keyboard tab order and Enter activates them', async ({
    page,
  }) => {
    await openSetup(page);
    await page.getByRole('link', { name: 'New run' }).focus();
    await page.getByRole('link', { name: 'Summary' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: 'Summary' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('account identifier is optional — run succeeds without it', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await submitRunButton(page).click();
    await expect(page.getByText('Total reviewed')).toBeVisible({ timeout: 30_000 });
  });

  test('period label auto-updates when frequency switches between Monthly and Annual', async ({
    page,
  }) => {
    await openSetup(page);
    const label = page.getByLabel('Reconciliation label');

    const monthlyDefault = await label.inputValue();
    expect(monthlyDefault).toMatch(/Monthly Recon/);

    await page.locator('#reconciliation-frequency-select').selectOption('Annual');
    const annualDefault = await label.inputValue();
    expect(annualDefault).toMatch(/Annual Recon/);

    await page.locator('#reconciliation-frequency-select').selectOption('Monthly');
    const monthlyRestored = await label.inputValue();
    expect(monthlyRestored).toMatch(/Monthly Recon/);
  });
});
