import { createWorkbookFromRows } from '@recon/test-fixtures';

import { expect, test } from '../fixtures';
import { loginToApplication, openSetup, submitRunButton } from '../auth';
import {
  amountMismatchBankFileValidationRows,
  amountMismatchGlFileValidationRows,
  createAllExceptionsBankFileValidationWorkbook,
  createAllExceptionsGlFileValidationWorkbook,
  createSampleBankFileValidationWorkbook,
  createSampleGlFileValidationWorkbook,
  duplicateInBankBankFileValidationRows,
  duplicateInBankGlFileValidationRows,
  missingFromGlBankFileValidationRows,
  missingFromGlGlFileValidationRows,
  timingDifferenceBankFileValidationRows,
  timingDifferenceGlFileValidationRows,
} from '../fileValidationWorkbooks';
import { exceptionRow, exceptionSummaryCell, openExceptions, runReconciliation, setWorkbookFiles } from '../reconciliationHelpers';
import { resetRunsForWorker } from '../runState';

// Before login, not after: every test here drives a reconciliation from the Import Files screen,
// and that screen's behaviour depends on whether this worker's organization already has a terminal
// run (see runState.ts). Clearing first means each test starts from the pre-run state it was
// written against instead of inheriting whatever the previous spec on this worker left behind.
test.beforeEach(async ({ page }) => {
  await resetRunsForWorker();
  await loginToApplication(page);
});

test.describe('exception category detection', () => {
  test('Missing from GL scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(missingFromGlBankFileValidationRows),
      createWorkbookFromRows(missingFromGlGlFileValidationRows),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Missing from GL')).toBeVisible();
  });

  test('Amount Mismatch scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(amountMismatchBankFileValidationRows),
      createWorkbookFromRows(amountMismatchGlFileValidationRows),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Amount Mismatch')).toBeVisible();
  });

  test('Duplicate in Bank scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(duplicateInBankBankFileValidationRows),
      createWorkbookFromRows(duplicateInBankGlFileValidationRows),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Duplicate in Bank')).toBeVisible();
  });

  test('Timing Difference scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(timingDifferenceBankFileValidationRows),
      createWorkbookFromRows(timingDifferenceGlFileValidationRows),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Timing Difference')).toBeVisible();
  });

  // Pre-File-Validation, a row with a blank required field (e.g. no posted_date) still reached
  // the old matching engine, which flagged it as a downstream "Invalid or Missing Data"
  // exception. The File Validation Engine now rejects that row before matching ever runs
  // (BANK_DATE_REQUIRED, Step 3) -- with only one row in the file, zero rows survive
  // validation, so the run never reaches the Review stage at all. This asserts the new,
  // upstream behavior instead of the old downstream category.
  test('a row with missing required data fails validation before matching runs', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows([
        ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['', 'WIRE WITHOUT DATE', '1', '', '250.00', '', '9750.00'],
      ]),
      createSampleGlFileValidationWorkbook(),
    ]);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await submitRunButton(page).click();
    await expect(page.getByText('BANK_DATE_REQUIRED').first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('exception triage interaction', () => {
  test.beforeEach(async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createAllExceptionsBankFileValidationWorkbook(),
      createAllExceptionsGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await openExceptions(page);
  });

  test('search activates the clear-filters button and retains matching rows', async ({ page }) => {
    // "UNBOOKED" is a token from the MissingFromGL bank row ("UNBOOKED BANK FEE").
    await page.locator('#exception-search-input').fill('UNBOOKED');
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    await expect(exceptionRow(page, 'Missing from GL')).toBeVisible();
  });

  test('category facet shows only the selected category in the triage rows', async ({ page }) => {
    // The Category facet is a closed <details> accordion by default, and low-count
    // options (like Amount Mismatch in this fixture) are hidden behind "Show all"
    // until the option cap is lifted.
    const categoryGroup = page
      .getByRole('complementary', { name: 'Exception filters' })
      .getByRole('group')
      .filter({ hasText: 'Category' });
    await categoryGroup.getByText('Category', { exact: true }).click();
    const showAllButton = categoryGroup.getByRole('button', { name: /^Show all/ });
    if (await showAllButton.isVisible().catch(() => false)) {
      await showAllButton.click();
    }
    await categoryGroup.getByRole('checkbox', { name: /^Amount Mismatch/ }).check();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    await expect(exceptionRow(page, 'Amount Mismatch')).toBeVisible();
  });

  test('clearing filters restores all exception categories', async ({ page }) => {
    await page.locator('#exception-search-input').fill('UNBOOKED');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(exceptionRow(page, 'Missing from GL')).toBeVisible();
    await expect(exceptionRow(page, 'Amount Mismatch')).toBeVisible();
  });

  test('search with no matches shows the empty-state message', async ({ page }) => {
    await page.locator('#exception-search-input').fill('xyzzy-no-such-entry-12345');
    await expect(page.getByText('No exceptions match the current filters')).toBeVisible();
  });
});

test.describe('export artifacts', () => {
  test.beforeEach(async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    // The rail item for routePaths.export is labelled "Reports" since the v3 nav restructure.
    await page.getByRole('link', { name: 'Reports & export' }).click();
  });

  test('Download workbook button is present in Export', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Download workbook' })).toBeVisible();
  });

  test('Export JSON button is present in Export', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
  });

  test('Download workbook button requests the correct API export URL', async ({ page }) => {
    // No href to read -- it's a button, not a link (see the beforeEach above). Verify the
    // underlying fetch request instead.
    const responsePromise = page.waitForResponse((response) =>
      /\/api\/reconciliation\/.+\/export\/workbook/.test(response.url()),
    );
    await page.getByRole('button', { name: 'Download workbook' }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
  });
});
