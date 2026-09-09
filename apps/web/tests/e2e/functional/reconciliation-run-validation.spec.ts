import { createWorkbookFromRows } from '@recon/test-fixtures';

import { expect, test } from '../fixtures';
import {
  FORM_VALIDATION_CREDENTIAL,
  bankAccountSelect,
  loginToApplication,
  openSetup,
  submitRunButton,
} from '../auth';
import {
  bankHeaderOnlyFileValidationRows,
  createAllExceptionsBankFileValidationWorkbook,
  createAllExceptionsGlFileValidationWorkbook,
  createSampleBankFileValidationWorkbook,
  createSampleGlFileValidationWorkbook,
} from '../fileValidationWorkbooks';
import { TEST_BANK_ACCOUNTS, XLSX_MIME, assignBankAccounts, ensureBankAccountsRegistered, exceptionSummaryCell, openExceptions, runReconciliation, selectSourceTab, setWorkbookFiles, stageGlWorkbook } from '../reconciliationHelpers';
import { resetRunsForWorker } from '../runState';

test.describe('form validation', () => {
  // Logs in to the pristine 'E2E Form Validation' organization rather than this worker's own.
  //
  // Every assertion below describes the form's PRE-RUN state -- a disabled submit button reading
  // "Submit run". That only holds while the organization has never completed a run: durableRunPhase
  // is fetched from the server on each page load (App.tsx's mount-time getLatestImportRunRequest),
  // so one terminal run anywhere in the organization turns the button into "Retry run"/"Start new
  // run", which reports ENABLED and fails these tests. Per-worker organizations remove the
  // cross-worker version of that, but not this one -- a single worker runs several spec files in
  // sequence against its own organization, so an earlier spec's run would decide these outcomes by
  // file ordering. Nothing ever submits as this account (the structural-validation spec below,
  // which does submit, deliberately uses the worker account instead), so the phase stays pristine
  // by construction and these tests do not depend on execution order at all.
  test.beforeEach(async ({ page }) => {
    await loginToApplication(page, FORM_VALIDATION_CREDENTIAL);
  });

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
    await ensureBankAccountsRegistered(page);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await expect(submitRunButton(page)).toBeEnabled();
  });

  // A-D1 (Issue #338) added a precondition this suite had no coverage for: files alone are not
  // enough, every bank statement must also be assigned to a registered account.
  //
  // Reaching the unassigned state takes a filename that matches nothing. `suggestAccountIdForFilename`
  // pre-selects whenever EXACTLY ONE active account's last four matches the filename, so the usual
  // `1111_`/`2222_` fixtures assign themselves the moment they are staged -- the disabled state is
  // unreachable with them, which is why this uploads a 9999_ statement no registered account claims.
  // (An ambiguous filename -- two accounts sharing a last four -- is the other no-suggestion case,
  // and is deliberately A-D1's "never choose the first match automatically".)
  test('submit button stays disabled while a statement no account claims is unassigned', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer, bankAccountBBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
      createWorkbookFromRows(bankHeaderOnlyFileValidationRows),
    ]);
    await ensureBankAccountsRegistered(page);
    await openSetup(page);

    // 9999 matches no registered account, so this slot gets no suggestion and stays unassigned.
    await page.locator('#bank-workbook-input').setInputFiles({
      name: '9999_bank.xlsx',
      mimeType: XLSX_MIME,
      buffer: bankBuffer,
    });
    // 2222 does match, and is pre-selected on staging -- so slot A is the only thing missing.
    await page.locator('#bank-workbook-b-input').setInputFiles({
      name: '2222_bank.xlsx',
      mimeType: XLSX_MIME,
      buffer: bankAccountBBuffer,
    });
  await stageGlWorkbook(page, 'gl.xlsx', glBuffer);

    await expect(submitRunButton(page)).toBeDisabled();

    // Assigning it by hand is what releases the run. The filename still disagrees with the chosen
    // account, which surfaces its own confirmation notice -- that does not block submission, and
    // this test stops before submitting either way (see this describe's pristine-org note above).
    await bankAccountSelect(page, 0).selectOption({ label: TEST_BANK_ACCOUNTS[0].label });

    await expect(submitRunButton(page)).toBeEnabled();
  });

  test('submit button is disabled again when the reconciliation label is cleared', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createSampleBankFileValidationWorkbook(),
      createSampleGlFileValidationWorkbook(),
    ]);
    await ensureBankAccountsRegistered(page);
    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await page.getByLabel('Run label').fill('');
    await expect(submitRunButton(page)).toBeDisabled();
  });

});

// Separate from 'form validation' above on purpose: this spec SUBMITS, which leaves a terminal
// (failed) run on whichever organization it runs as. Kept out of the pristine E2E Form Validation
// organization so that organization never acquires a run phase, and the pre-run assertions above
// stay independent of execution order. It asserts an error message rather than the button's
// pre-run state, so this worker's own organization is fine regardless of what ran before it.
test.describe('structural validation', () => {
  test.beforeEach(async ({ page }) => {
    await resetRunsForWorker();
    await loginToApplication(page);
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
    await ensureBankAccountsRegistered(page);
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
  await stageGlWorkbook(page, 'transactions.csv', fakeBuffer);
    // The GL file is the one under test here; the bank statements still need their A-D1
    // assignments or submit never enables and the structural error never gets a chance to appear.
    // Back to the bank tab: the per-slot account pickers live with the statements they assign.
  await selectSourceTab(page, 'Bank statements');
  await assignBankAccounts(page);
    await submitRunButton(page).click();
    await expect(page.getByText('STRUCT_HEADER_MISSING')).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('annual reconciliation frequency', () => {
  test.beforeEach(async ({ page }) => {
    await resetRunsForWorker();
    await loginToApplication(page);
  });

  test('switching to Annual hides the month picker and shows the year picker', async ({ page }) => {
    await openSetup(page);
    await expect(page.getByLabel('Month')).toBeVisible();
    await expect(page.locator('#annual-reconciliation-year-select')).not.toBeVisible();

    await page.locator('#reconciliation-frequency-select').selectOption('Annual');

    await expect(page.locator('#annual-reconciliation-year-select')).toBeVisible();
    await expect(page.getByLabel('Month')).not.toBeVisible();
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
  test.beforeEach(async ({ page }) => {
    await resetRunsForWorker();
    await loginToApplication(page);
  });

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
