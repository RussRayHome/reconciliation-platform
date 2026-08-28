import { createWorkbookFromRows } from '@recon/test-fixtures';

import { expect, test } from '../fixtures';
import { loginToApplication, openSetup, submitRunButton } from '../auth';
import {
  bankHeaderOnlyFileValidationRows,
  createAllExceptionsBankFileValidationWorkbook,
  createAllExceptionsGlFileValidationWorkbook,
  createSampleBankFileValidationWorkbook,
  createSampleGlFileValidationWorkbook,
} from '../fileValidationWorkbooks';
import { XLSX_MIME, exceptionSummaryCell, openExceptions, runReconciliation, setWorkbookFiles } from '../reconciliationHelpers';

test.beforeEach(async ({ page }) => {
  await loginToApplication(page);
});

test.describe('form validation', () => {
  test('submit button is disabled before any files are uploaded', async ({ page }) => {
    await openSetup(page);
    await expect(submitRunButton(page)).toBeDisabled();
  });

  test('submit button remains disabled with only the Account A bank file uploaded', async ({
    page,
  }) => {
    const bankBuffer = await createSampleBankFileValidationWorkbook();
    await openSetup(page);
    await page.locator('#bank-workbook-input').setInputFiles({
      name: '1111_bank.xlsx',
      mimeType: XLSX_MIME,
      buffer: bankBuffer,
    });
    await expect(submitRunButton(page)).toBeDisabled();
  });

  test('submit button is enabled once both files are present and label is populated', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await expect(submitRunButton(page)).toBeEnabled();
  });

  test('submit button is disabled again when the reconciliation label is cleared', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await page.getByLabel('Reconciliation label').fill('');
    await expect(submitRunButton(page)).toBeDisabled();
  });

  // Since Phase 10, .csv is a valid extension -- this junk content now passes client-side
  // gating and hits the File Validation Engine's Step 1 (STRUCT_HEADER_MISSING) instead of a
  // generic upload-time alert.
  test('uploading a file with unrecognized content shows a structural validation error', async ({
    page,
  }) => {
    const fakeBuffer = Buffer.from('col1,col2\nval1,val2');
    const [bankBuffer, bankAccountBBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createWorkbookFromRows(bankHeaderOnlyFileValidationRows),
    ]);
    await openSetup(page);
    await page.locator('#bank-workbook-input').setInputFiles({
      name: '1111_bank.xlsx',
      mimeType: XLSX_MIME,
      buffer: bankBuffer,
    });
    await page.locator('#bank-workbook-b-input').setInputFiles({
      name: '2222_bank.xlsx',
      mimeType: XLSX_MIME,
      buffer: bankAccountBBuffer,
    });
    await page.locator('#gl-workbook-input').setInputFiles({
      name: 'transactions.csv',
      mimeType: 'text/csv',
      buffer: fakeBuffer,
    });
    await submitRunButton(page).click();
    await expect(page.getByText('STRUCT_HEADER_MISSING')).toBeVisible({ timeout: 30_000 });
  });
});

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
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer, { frequency: 'Annual' });
    await expect(page.getByText('Total reviewed')).toBeVisible();
  });
});

test.describe('combined all-exceptions workbook', () => {
  test('exception triage is populated after running all-exceptions fixture', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createAllExceptionsBankFileValidationWorkbook(),
      createAllExceptionsGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await openExceptions(page);
    await expect(page.locator('#exception-search-input')).toBeVisible();
  });

  test('multiple distinct exception categories appear in the summary breakdown', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createAllExceptionsBankFileValidationWorkbook(),
      createAllExceptionsGlFileValidationWorkbook(),
    ]);
    await runReconciliation(page, bankBuffer, glBuffer);
    await expect(exceptionSummaryCell(page, 'Missing from GL')).toBeVisible();
    await expect(exceptionSummaryCell(page, 'Amount Mismatch')).toBeVisible();
    await expect(exceptionSummaryCell(page, 'Timing Difference')).toBeVisible();
  });
});
