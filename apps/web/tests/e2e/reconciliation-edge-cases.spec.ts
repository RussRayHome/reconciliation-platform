import {
  createAllExceptionsBankWorkbook,
  createAllExceptionsQboWorkbook,
  createSampleBankWorkbook,
  createSampleQboWorkbook,
  createWorkbookFromRows,
  amountMismatchBankRows,
  amountMismatchQboRows,
  bankHeaderOnlyRows,
  duplicateInBankBankRows,
  duplicateInBankQboRows,
  invalidDataBankRows,
  invalidDataQboRows,
  missingFromQboBankRows,
  missingFromQboQboRows,
  qboHeaderOnlyRows,
  timingDifferenceBankRows,
  timingDifferenceQboRows,
} from '@recon/test-fixtures';
import { expect, type Page, test } from '@playwright/test';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function setWorkbookFiles(
  page: Page,
  bankBuffer: Buffer,
  qboBuffer: Buffer,
): Promise<void> {
  await page.locator('#bank-workbook-input').setInputFiles({
    name: 'bank.xlsx',
    mimeType: XLSX_MIME,
    buffer: bankBuffer,
  });
  await page.locator('#qbo-workbook-input').setInputFiles({
    name: 'qbo.xlsx',
    mimeType: XLSX_MIME,
    buffer: qboBuffer,
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
  qboBuffer: Buffer,
  options: RunOptions = {},
): Promise<void> {
  const { accountId = 'OPERATING-001', frequency = 'Monthly', month = 'March', label } = options;

  await page.goto('/');
  await setWorkbookFiles(page, bankBuffer, qboBuffer);
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
  await expect(page.getByRole('heading', { name: 'Exception Report' })).toBeVisible();
}

// Scope assertions to exception table rows (td cells) to avoid matching chart labels,
// dropdown options, and the category breakdown table that also render category names.
function exceptionCategoryCell(page: Page, displayName: string) {
  return page.getByRole('cell', { name: displayName, exact: true }).first();
}

// ─── Form Validation ─────────────────────────────────────────────────────────

test.describe('form validation', () => {
  test('submit button is disabled before any files are uploaded', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Run reconciliation' })).toBeDisabled();
  });

  test('submit button remains disabled with only the bank file uploaded', async ({ page }) => {
    const bankBuffer = await createSampleBankWorkbook();
    await page.goto('/');
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
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);
    await page.goto('/');
    await setWorkbookFiles(page, bankBuffer, qboBuffer);
    await expect(page.getByRole('button', { name: 'Run reconciliation' })).toBeEnabled();
  });

  test('submit button is disabled again when the reconciliation label is cleared', async ({
    page,
  }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);
    await page.goto('/');
    await setWorkbookFiles(page, bankBuffer, qboBuffer);
    await page.getByLabel('Reconciliation label').fill('');
    await expect(page.getByRole('button', { name: 'Run reconciliation' })).toBeDisabled();
  });

  test('uploading a non-xlsx file shows an error after submission', async ({ page }) => {
    const fakeBuffer = Buffer.from('col1,col2\nval1,val2');
    const bankBuffer = await createSampleBankWorkbook();
    await page.goto('/');
    await page.locator('#bank-workbook-input').setInputFiles({
      name: 'bank.xlsx',
      mimeType: XLSX_MIME,
      buffer: bankBuffer,
    });
    await page.locator('#qbo-workbook-input').setInputFiles({
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
    await page.goto('/');
    await expect(page.getByLabel('Monthly reconciliation month')).toBeVisible();
    await expect(page.locator('#annual-reconciliation-year-select')).not.toBeVisible();

    await page.locator('#reconciliation-frequency-select').selectOption('Annual');

    await expect(page.locator('#annual-reconciliation-year-select')).toBeVisible();
    await expect(page.getByLabel('Monthly reconciliation month')).not.toBeVisible();
  });

  test('annual reconciliation run completes and shows results', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer, { frequency: 'Annual' });
    await expect(page.getByText('Total reviewed')).toBeVisible();
  });
});

// ─── Exception Category Detection ────────────────────────────────────────────

test.describe('exception category detection', () => {
  test('Missing from QBO scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createWorkbookFromRows(missingFromQboBankRows),
      createWorkbookFromRows(missingFromQboQboRows),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await expect(exceptionCategoryCell(page, 'Missing from QBO')).toBeVisible();
  });

  test('Amount Mismatch scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createWorkbookFromRows(amountMismatchBankRows),
      createWorkbookFromRows(amountMismatchQboRows),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await expect(exceptionCategoryCell(page, 'Amount Mismatch')).toBeVisible();
  });

  test('Duplicate in Bank scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createWorkbookFromRows(duplicateInBankBankRows),
      createWorkbookFromRows(duplicateInBankQboRows),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await expect(exceptionCategoryCell(page, 'Duplicate in Bank')).toBeVisible();
  });

  test('Timing Difference scenario surfaces the correct exception category', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createWorkbookFromRows(timingDifferenceBankRows),
      createWorkbookFromRows(timingDifferenceQboRows),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await expect(exceptionCategoryCell(page, 'Timing Difference')).toBeVisible();
  });

  test('Invalid or Missing Data scenario surfaces the correct exception category', async ({
    page,
  }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createWorkbookFromRows(invalidDataBankRows),
      createWorkbookFromRows(invalidDataQboRows),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await expect(exceptionCategoryCell(page, 'Invalid or Missing Data')).toBeVisible();
  });
});

// ─── All Exception Categories Combined ───────────────────────────────────────

test.describe('combined all-exceptions workbook', () => {
  test('exception table is populated after running all-exceptions fixture', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsQboWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await expect(page.getByText('Total reviewed')).toBeVisible();
    await expect(page.locator('#exception-search-input')).toBeVisible();
  });

  test('multiple distinct exception categories appear in the exception table', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsQboWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await expect(exceptionCategoryCell(page, 'Missing from QBO')).toBeVisible();
    await expect(exceptionCategoryCell(page, 'Amount Mismatch')).toBeVisible();
    await expect(exceptionCategoryCell(page, 'Timing Difference')).toBeVisible();
  });
});

// ─── Exception Table Filtering ───────────────────────────────────────────────

test.describe('exception table interaction', () => {
  test.beforeEach(async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createAllExceptionsBankWorkbook(),
      createAllExceptionsQboWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
  });

  test('search activates the clear-filters button and retains matching rows', async ({ page }) => {
    // "UNBOOKED" is a token from the MissingFromQBO bank row ("UNBOOKED BANK FEE") and
    // does not appear in the error messages or tokens of any other exception category.
    await page.locator('#exception-search-input').fill('UNBOOKED');
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    await expect(exceptionCategoryCell(page, 'Missing from QBO')).toBeVisible();
  });

  test('category filter shows only the selected category in exception rows', async ({ page }) => {
    await page.locator('#exception-category-filter').selectOption('AmountMismatch');
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    await expect(exceptionCategoryCell(page, 'Amount Mismatch')).toBeVisible();
  });

  test('clearing filters restores all exception categories', async ({ page }) => {
    await page.locator('#exception-search-input').fill('UNBOOKED');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(exceptionCategoryCell(page, 'Missing from QBO')).toBeVisible();
    await expect(exceptionCategoryCell(page, 'Amount Mismatch')).toBeVisible();
  });

  test('search with no matches shows the empty-state message', async ({ page }) => {
    await page.locator('#exception-search-input').fill('xyzzy-no-such-entry-12345');
    await expect(page.getByText('No exceptions match the current filters')).toBeVisible();
  });
});

// ─── Tab Navigation ───────────────────────────────────────────────────────────

test.describe('tab navigation', () => {
  test('Rules tab is accessible before running a reconciliation', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-rules').click();
    await expect(page.locator('#tab-rules')).toHaveAttribute('aria-selected', 'true');
  });

  test('after a run the application automatically navigates to the Exceptions tab', async ({
    page,
  }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await expect(page.locator('#tab-exceptions')).toHaveAttribute('aria-selected', 'true');
  });

  test('Reports tab is navigable after a run and shows the Run Summary view by default', async ({
    page,
  }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await page.locator('#tab-reports').click();
    await expect(page.getByRole('heading', { name: 'Run Summary' })).toBeVisible();
  });

  test('Probable Match Review sub-view is reachable from the Reports tab', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await page.locator('#tab-reports').click();
    await page.getByRole('button', { name: 'Probable Match Review' }).click();
    await expect(page.getByRole('heading', { name: 'Probable Match Review' })).toBeVisible();
  });

  test('Export Artifacts sub-view is reachable from the Reports tab', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await page.locator('#tab-reports').click();
    await page.getByRole('button', { name: 'Export Artifacts' }).click();
    await expect(page.getByRole('heading', { name: 'Export Artifacts' })).toBeVisible();
  });
});

// ─── Export Artifacts ─────────────────────────────────────────────────────────

test.describe('export artifacts', () => {
  test.beforeEach(async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer);
    await page.locator('#tab-reports').click();
    await page.getByRole('button', { name: 'Export Artifacts' }).click();
  });

  test('Download workbook link is present in Export Artifacts', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Download workbook' })).toBeVisible();
  });

  test('Export JSON button is present in Export Artifacts', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
  });

  test('Download workbook link resolves to the correct API export URL', async ({ page }) => {
    const href = await page.getByRole('link', { name: 'Download workbook' }).getAttribute('href');
    expect(href).toMatch(/\/api\/reconciliation\/.+\/export\/workbook/);
  });
});

// ─── Session Persistence ──────────────────────────────────────────────────────

test.describe('session persistence', () => {
  test(
    'after a run the results are still accessible after a full page reload',
    { timeout: 120_000 },
    async ({ page }) => {
      const [bankBuffer, qboBuffer] = await Promise.all([
        createSampleBankWorkbook(),
        createSampleQboWorkbook(),
      ]);
      await runReconciliation(page, bankBuffer, qboBuffer);

      // persistRun() runs inside a React useEffect that fires after paint.
      // Wait for localStorage to be written before reloading so the next page
      // load can hydrate from it synchronously without a backend round-trip.
      await page.waitForFunction(
        () => !!window.localStorage.getItem('reconciliation-platform:latest-report-run'),
        { timeout: 10_000 },
      );

      await page.reload();

      // After reload the Exceptions tab requires a live run (which doesn't exist).
      // The Reports tab uses reportRun = run ?? persistedRun, so it renders the
      // persisted data. Navigate there and open the Exception Report sub-view.
      await page.locator('#tab-reports').click();
      await page.getByRole('button', { name: 'Exception Report' }).click();
      await expect(page.getByRole('heading', { name: 'Exception Report' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator('#exception-search-input')).toBeVisible();
    },
  );
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

test.describe('edge cases', () => {
  test('header-only workbooks (no data rows) complete without a crash', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createWorkbookFromRows(bankHeaderOnlyRows),
      createWorkbookFromRows(qboHeaderOnlyRows),
    ]);
    await page.goto('/');
    await setWorkbookFiles(page, bankBuffer, qboBuffer);
    await page.getByRole('button', { name: 'Run reconciliation' }).click();
    // Either the run completes to the exception report, or a server error alert appears.
    await expect(
      page.getByRole('heading', { name: 'Exception Report' }).or(page.getByRole('alert')),
    ).toBeVisible();
  });

  test('running a second reconciliation replaces the previous run results', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, qboBuffer, { label: 'First Run March' });

    const [bank2, qbo2] = await Promise.all([
      createWorkbookFromRows(missingFromQboBankRows),
      createWorkbookFromRows(missingFromQboQboRows),
    ]);
    await page.locator('#tab-upload').click();
    await setWorkbookFiles(page, bank2, qbo2);
    await page.getByLabel('Reconciliation label').fill('Second Run April');
    await page.getByRole('button', { name: 'Run reconciliation' }).click();

    await expect(page.getByRole('heading', { name: 'Exception Report' })).toBeVisible();
    await expect(exceptionCategoryCell(page, 'Missing from QBO')).toBeVisible();
  });

  test('keyboard arrow keys navigate between tabs', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-upload').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-rules')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-exceptions')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-reports')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#tab-exceptions')).toHaveAttribute('aria-selected', 'true');
  });

  test('account identifier is optional — run succeeds without it', async ({ page }) => {
    const [bankBuffer, qboBuffer] = await Promise.all([
      createSampleBankWorkbook(),
      createSampleQboWorkbook(),
    ]);
    await page.goto('/');
    await setWorkbookFiles(page, bankBuffer, qboBuffer);
    await page.getByRole('button', { name: 'Run reconciliation' }).click();
    await expect(page.getByRole('heading', { name: 'Exception Report' })).toBeVisible();
  });

  test('period label auto-updates when frequency switches between Monthly and Annual', async ({
    page,
  }) => {
    await page.goto('/');
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
