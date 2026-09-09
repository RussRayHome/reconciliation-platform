import { createWorkbookFromRows } from '@recon/test-fixtures';

import { expect, test } from '../fixtures';
import { loginToApplication, openSetup, submitRunButton } from '../auth';
import { assignBankAccounts, ensureBankAccountsRegistered, selectSourceTab } from '../reconciliationHelpers';
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

  // A-D1 (Issue #338): a statement can only be reconciled once it is assigned to a REGISTERED
  // account, and a fresh database has none. The account numbers deliberately end in the same four
  // digits as the filenames uploaded below -- a mismatch is a real, separate product behaviour
  // (it demands an explicit confirmation before the merge), and this test is not about that path.
  await ensureBankAccountsRegistered(page);

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
  // UI-2 moved the GL slot to its own tab; it is not in the DOM until the tab is active.
  await selectSourceTab(page, 'General ledger');
  await page.locator('#gl-workbook-input').setInputFiles({
    name: 'gl.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: glBuffer,
  });
  // Assign each uploaded statement to its account. Until both are assigned the submit button stays
  // disabled ("Assign every bank statement to a registered account"), which is what makes this
  // step load-bearing rather than decorative.
  // Back to the bank tab: the per-slot account pickers live with the statements they assign.
  await selectSourceTab(page, 'Bank statements');
  await assignBankAccounts(page);

  await page.getByPlaceholder('OPERATING-001').fill('OPERATING-001');
  await page.getByLabel('Month').selectOption('March');
  await page.getByLabel('Run label').fill(`Monthly Recon for March ${currentYear}`);
  await submitRunButton(page).click();

  // Completing a run lands on the Review stage, Summary view.
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Total reviewed')).toBeVisible();

  // The nav rail swaps between Summary and Exceptions. Probable matches was dropped from the
  // rail in the v3 nav restructure (commit 5f08130) -- its route stays reachable directly (see
  // reconciliation-navigation-and-session.spec.ts), but it's no longer part of this rail-driven
  // flow.
  await page.getByRole('link', { name: 'Exceptions' }).click();
  await expect(page.getByPlaceholder('Search file, message, or tokens')).toBeVisible();
});
