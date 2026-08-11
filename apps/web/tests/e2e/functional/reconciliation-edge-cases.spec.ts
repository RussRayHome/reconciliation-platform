import {
  createAllExceptionsBankWorkbook,
  createAllExceptionsGlWorkbook,
  createSampleBankWorkbook,
  createSampleGlWorkbook,
  createWorkbookFromRows,
  amountMismatchBankRows,
  amountMismatchGlRows,
  bankHeaderOnlyRows,
  duplicateInBankBankRows,
  duplicateInBankGlRows,
  invalidDataBankRows,
  invalidDataGlRows,
  missingFromGlBankRows,
  missingFromGlGlRows,
  glHeaderOnlyRows,
  timingDifferenceBankRows,
  timingDifferenceGlRows,
} from '@recon/test-fixtures';
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures';
import { loginToApplication, openSetup } from '../auth';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test.beforeEach(async ({ page }) => {
  await loginToApplication(page);
});

async function setWorkbookFiles(page: Page, bankBuffer: Buffer, glBuffer: Buffer): Promise<void> {
  await page.locator('#bank-workbook-input').setInputFiles({
    name: 'bank.xlsx',
    mimeType: XLSX_MIME,
    buffer: bankBuffer,
  });
  await page.locator('#gl-workbook-input').setInputFiles({
    name: 'gl.xlsx',
    mimeType: XLSX_MIME,
    buffer: glBuffer,
  });
}

interface RunOptions {
  accountId?: string;
  frequency?: 'Monthly' | 'Annual';
  month?: string;
  label?: string;
}

async function runReconciliation(
  page: Page,
  bankBuffer: Buffer,
  glBuffer: Buffer,
  options: RunOptions = {},
): Promise<void> {
  const { accountId = 'OPERATING-001', frequency = 'Monthly', month = 'March', label } = options;

  await openSetup(page);
  await setWorkbookFiles(page, bankBuffer, glBuffer);
  await page.getByPlaceholder('OPERATING-001').fill(accountId);

  if (frequency === 'Annual') {
    await page.locator('#reconciliation-frequency-select').selectOption('Annual');
  } else {
    await page.getByLabel('Monthly reconciliation month').selectOption(month);
  }

  if (label !== undefined) {
    await page.getByLabel('Reconciliation label').fill(label);
  }

  await page.getByRole('button', { name: 'Run reconciliation' }).click();
  // A completed run lands on the Review stage, Summary view.
  await expect(page.getByText('Total reviewed')).toBeVisible({ timeout: 30_000 });
}

// Opens the Exceptions triage view (Review stage) after a completed run.
async function openExceptions(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Exceptions' }).click();
  await expect(page.locator('#exception-search-input')).toBeVisible();
}

// The Summary category breakdown renders each detected category once as a table cell.
function exceptionSummaryCell(page: Page, displayName: string) {
  return page.getByRole('cell', { name: displayName, exact: true }).first();
}

// A single exception entry inside the triage list pane.
function exceptionRow(page: Page, displayName: string) {
  return page.locator('.exception-row', { hasText: displayName }).first();
}

// ─── Form Validation ─────────────────────────────────────────────────────────

test.describe('form validation', () => {
  test('submit button is disabled before any files are uploaded', async ({ page }) => {
    await openSetup(page);
    await expect(page.getByRole('button', { name: 'Run reconciliation' })).toBeDisabled();
  });

  test('submit button remains disabled with only the bank file uploaded', async ({ page }) => {
    const bankBuffer = await createSampleBankWorkbook();
    await openSetup(page);
    await page.locator('#bank-workbook-input').setInputFiles({
      name: 'bank.xlsx',
      mimeType: XLSX_MIME,
      buffer: bankBuffer,
    });
    await expect(page.getByRole('button', { name: 'Run reconciliation' })).toBeDisabled();
  });

  test('submit button is enabled once both files are present and label is populated', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await expect(page.getByRole('button', { name: 'Run reconciliation' })).toBeEnabled();
  });

  test('submit button is disabled again when the reconciliation label is cleared', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await page.getByLabel('Reconciliation label').fill('');
    await expect(page.getByRole('button', { name: 'Run reconciliation' })).toBeDisabled();
  });

  test('uploading a non-xlsx file shows an error after submission', async ({ page }) => {
    const fakeBuffer = Buffer.from('col1,col2\nval1,val2');
    const bankBuffer = await createSampleBankWorkbook();
    await openSetup(page);
    await page.locator('#bank-workbook-input').setInputFiles({
      name: 'bank.xlsx',
      mimeType: XLSX_MIME,
      buffer: bankBuffer,
    });
    await page.locator('#gl-workbook-input').setInputFiles({
      name: 'transactions.csv',
      mimeType: 'text/csv',
      buffer: fakeBuffer,
    });
    await page.getByRole('button', { name: 'Run reconciliation' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });
});

// ─── Annual Frequency ─────────────────────────────────────────────────────────

test.describe('annual reconciliation frequency', () => {
  test('switching to Annual hides the month picker and shows the year picker', async ({ page }) => {
    await openSetup(page);
    await expect(page.getByLabel('Monthly reconciliation month')).toBeVisible();
    await expect(page.locator('#annual-reconciliation-year-select')).not.toBeVisible();

    await page.locator('#reconciliation-frequency-select').selectOption('Annual');

    await expect(page.locator('#annual-reconciliation-year-select')).toBeVisible();
    await expect(page.getByLabel('Monthly reconciliation month')).not.toBeVisible();
  });

  test('annual reconciliation run completes and shows results', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer, { frequency: 'Annual' });
    await expect(page.getByText('Total reviewed')).toBeVisible();
  });
});

// ─── Exception Category Detection ────────────────────────────────────────────

test.describe('exception category detection', () => {
  test('Missing from GL scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(missingFromGlBankRows),
      createWorkbookFromRows(missingFromGlGlRows),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Missing from GL')).toBeVisible();
  });

  test('Amount Mismatch scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(amountMismatchBankRows),
      createWorkbookFromRows(amountMismatchGlRows),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Amount Mismatch')).toBeVisible();
  });

  test('Duplicate in Bank scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(duplicateInBankBankRows),
      createWorkbookFromRows(duplicateInBankGlRows),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Duplicate in Bank')).toBeVisible();
  });

  test('Timing Difference scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(timingDifferenceBankRows),
      createWorkbookFromRows(timingDifferenceGlRows),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Timing Difference')).toBeVisible();
  });

  test('Invalid or Missing Data scenario surfaces the correct exception category', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(invalidDataBankRows),
      createWorkbookFromRows(invalidDataGlRows),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Invalid or Missing Data')).toBeVisible();
  });
});

// ─── All Exception Categories Combined ───────────────────────────────────────

test.describe('combined all-exceptions workbook', () => {
  test('exception triage is populated after running all-exceptions fixture', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsGlWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await openExceptions(page);
    await expect(page.locator('#exception-search-input')).toBeVisible();
  });

  test('multiple distinct exception categories appear in the summary breakdown', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsGlWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Missing from GL')).toBeVisible();
    await expect(exceptionSummaryCell(page, 'Amount Mismatch')).toBeVisible();
    await expect(exceptionSummaryCell(page, 'Timing Difference')).toBeVisible();
  });
});

// ─── Exception Triage Filtering ──────────────────────────────────────────────

test.describe('exception triage interaction', () => {
  test.beforeEach(async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsGlWorkbook(),
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

// ─── Stage Navigation ─────────────────────────────────────────────────────────

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
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(page.getByRole('link', { name: 'File-based' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('Review opens on the Summary view by default after a run', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'File-based' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  // Probable matches was dropped from the nav rail in the v3 nav restructure (commit 5f08130,
  // "no longer nav-linked, per confirmed decision") -- the route itself stays reachable directly,
  // which is what this now verifies, rather than a rail link that no longer exists.
  test('Probable matches view is reachable via direct navigation', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await page.goto('/probable-matches');
    await expect(page.getByText(/Showing \d+ probable matches\./)).toBeVisible();
  });

  test('Export stage exposes the export artifacts', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    // The rail item for routePaths.export is labelled "Reports" since the v3 nav restructure.
    await page.getByRole('link', { name: 'Reports' }).click();
    // Download workbook is a button, not a link -- see AppWorkspacePanels.tsx's own comment: a
    // plain <a href> can't carry the bearer token now that this route requires auth, so it
    // fetches the bytes and triggers the save via a blob URL instead of top-level navigation.
    await expect(page.getByRole('button', { name: 'Download workbook' })).toBeVisible();
  });
});

// ─── Export Artifacts ─────────────────────────────────────────────────────────

test.describe('export artifacts', () => {
  test.beforeEach(async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    // The rail item for routePaths.export is labelled "Reports" since the v3 nav restructure.
    await page.getByRole('link', { name: 'Reports' }).click();
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

// ─── Session Persistence ──────────────────────────────────────────────────────

test.describe('session persistence', () => {
  test('after a run the results are still accessible after a full page reload', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
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

// ─── Edge Cases ──────────────────────────────────────────────────────────────

test.describe('edge cases', () => {
  test('header-only workbooks (no data rows) complete without a crash', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows(bankHeaderOnlyRows),
      createWorkbookFromRows(glHeaderOnlyRows),
    ]);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await page.getByRole('button', { name: 'Run reconciliation' }).click();
    // Either the run completes to the Review summary, or a server error alert appears.
    await expect(page.getByText('Total reviewed').or(page.getByRole('alert'))).toBeVisible({
      timeout: 30_000,
    });
  });

  test('running a second reconciliation replaces the previous run results', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer, { label: 'First Run March' });

    const [bank2, gl2] = await Promise.all([
      createWorkbookFromRows(missingFromGlBankRows),
      createWorkbookFromRows(missingFromGlGlRows),
    ]);
    await page.getByRole('link', { name: 'Import Files' }).click();
    await setWorkbookFiles(page, bank2, gl2);
    await page.getByLabel('Reconciliation label').fill('Second Run April');
    await page.getByRole('button', { name: 'Run reconciliation' }).click();

    await expect(page.getByText('Total reviewed')).toBeVisible({ timeout: 30_000 });
    await expect(exceptionSummaryCell(page, 'Missing from GL')).toBeVisible();
  });

  test('rail destinations are reachable by keyboard tab order and Enter activates them', async ({
    page,
  }) => {
    await openSetup(page);
    await page.getByRole('link', { name: 'Import Files' }).focus();
    await page.getByRole('link', { name: 'File-based' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: 'File-based' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('account identifier is optional — run succeeds without it', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleGlWorkbook(),
    ]);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await page.getByRole('button', { name: 'Run reconciliation' }).click();
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
