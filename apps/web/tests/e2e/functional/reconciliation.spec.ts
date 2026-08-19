import { createWorkbookFromRows } from '@recon/test-fixtures';

import { expect, test } from '../fixtures';
import { loginToApplication, openSetup } from '../auth';
import {
  bankHeaderOnlyFileValidationRows,
  createSampleBankFileValidationWorkbook,
  createSampleGlFileValidationWorkbook,
} from '../fileValidationWorkbooks';

test('requires login and lands on the application after successful authentication', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await loginToApplication(page);
});

test('uploads workbooks and shows reconciliation results', async ({ page }) => {
  const currentYear = new Date().getFullYear();
  const [bankBuffer, glBuffer] = await Promise.all([
    createSampleBankFileValidationWorkbook(),
    createSampleGlFileValidationWorkbook(),
  ]);

  await loginToApplication(page);
  await openSetup(page);

  const bankAccountBBuffer = await createWorkbookFromRows(bankHeaderOnlyFileValidationRows);

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
  await page.getByPlaceholder('OPERATING-001').fill('OPERATING-001');
  await page.getByLabel('Monthly reconciliation month').selectOption('March');
  await page.getByLabel('Reconciliation label').fill(`Monthly Recon for March ${currentYear}`);
  await page.getByRole('button', { name: 'Submit run' }).click();

  // Completing a run lands on the Review stage, Summary view.
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Total reviewed')).toBeVisible();

  // The nav rail swaps between Summary and Exceptions. Probable matches was dropped from the
  // rail in the v3 nav restructure (commit 5f08130) -- its route stays reachable directly (see
  // reconciliation-edge-cases.spec.ts), but it's no longer part of this rail-driven flow.
  await page.getByRole('link', { name: 'Exceptions' }).click();
  await expect(page.getByPlaceholder('Search file, message, or tokens')).toBeVisible();
});
