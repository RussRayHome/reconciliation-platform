import { createWorkbookFromRows } from '@recon/test-fixtures';
import type { Page } from '@playwright/test';

import { expect } from './fixtures';
import { bankAccountSelect, openSetup, registerBankAccount, submitRunButton } from './auth';
import { bankHeaderOnlyFileValidationRows } from './fileValidationWorkbooks';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The two bank accounts every reconciliation scenario uses (A-D1, Issue #338).
 *
 * Their numbers match the `1111_`/`2222_` filenames `setWorkbookFiles` uploads on purpose: a
 * statement whose filename disagrees with its assigned account is a real, separate product
 * behaviour -- it demands an explicit confirmation before the merge -- and no scenario here is
 * about that path.
 *
 * `label` is what the assignment control displays, per `formatAccountLabel`: `name — ending in
 * <last four>`, where the last four is derived server-side from the account number.
 */
export const TEST_BANK_ACCOUNTS = [
  { accountNumber: '1111', name: 'Operating A', label: 'Operating A — ending in 1111' },
  { accountNumber: '2222', name: 'Operating B', label: 'Operating B — ending in 2222' },
] as const;

/**
 * Registers the scenario accounts if they are not already there.
 *
 * Since A-D1 a statement can only be reconciled once it is assigned to a REGISTERED account, and
 * every E2E worker organization starts empty -- changeset 0059's backfill derives accounts from
 * pre-existing runs, so a fresh database seeds none. Without this the submit button is disabled
 * forever and every later assertion fails for reasons that look nothing like the real cause.
 *
 * Call it BEFORE `openSetup`: it navigates to `/accounts`, which would discard staged uploads.
 */
export async function ensureBankAccountsRegistered(page: Page): Promise<void> {
  for (const account of TEST_BANK_ACCOUNTS) {
    await registerBankAccount(page, account);
  }
}

/** Assigns each staged bank statement to its account, in slot order. */
/**
 * Switches the New run screen's source tab (UI-2, #401). Bank and GL are separate tabs now, so
 * anything staging a GL workbook has to be on the GL tab first -- the slot simply is not in the
 * DOM otherwise, which surfaces as a `setInputFiles` timeout on `#gl-workbook-input` rather than
 * anything that names the tab.
 *
 * Matched on the tab's accessible name rather than an id: `RovingTabList` derives tab ids from a
 * prefix the caller passes, so a name match is the stable half of that contract.
 */
export async function selectSourceTab(
  page: Page,
  tab: 'Bank statements' | 'General ledger' | 'AP / Payments' | 'AR / Invoices' | 'Payroll',
): Promise<void> {
  await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
}

export async function assignBankAccounts(page: Page): Promise<void> {
  for (const [slot, account] of TEST_BANK_ACCOUNTS.entries()) {
    await bankAccountSelect(page, slot).selectOption({ label: account.label });
  }
}

/** Account B's own bank workbook is a required upload slot (Issue #141); an empty (header-only)
 * file merges cleanly and contributes zero extra bank rows, so it never perturbs the row
 * counts/exception categories these scenarios assert on. Bank filenames must start with the
 * account number (or its last 4 digits) followed by "-"/"_" per ADR-0003's filename convention. */
export async function setWorkbookFiles(
  page: Page,
  bankBuffer: Buffer,
  glBuffer: Buffer,
  options: { assignAccounts?: boolean } = {},
): Promise<void> {
  const bankAccountBBuffer = await createWorkbookFromRows(bankHeaderOnlyFileValidationRows);

  await attachAndVerify(page, 'bank-workbook-input', '1111_bank.xlsx', bankBuffer);
  await attachAndVerify(page, 'bank-workbook-b-input', '2222_bank.xlsx', bankAccountBBuffer);
  // UI-2 gave GL its own tab; its slot is not in the DOM until that tab is active, and the bank
  // tab is where the per-slot account pickers live, so this returns before assigning.
  await selectSourceTab(page, 'General ledger');
  await attachAndVerify(page, 'gl-workbook-input', 'gl.xlsx', glBuffer);
  await selectSourceTab(page, 'Bank statements');

  // A-D1: staged files alone no longer make the form submittable -- each statement must also be
  // assigned to a registered account. Assigning here keeps "the form is filled in" a single step
  // for the scenarios that only care about the outcome. Pass `assignAccounts: false` to stop short
  // and assert the unassigned state itself.
  if (options.assignAccounts !== false) {
    await assignBankAccounts(page);
  }
}

/**
 * Attaches one workbook and confirms the slot actually took it, retrying once if not.
 *
 * Issue #291: under parallel load a `setInputFiles` call occasionally returns without the app
 * recording the file -- traced directly, the slot still showed its empty prompt immediately
 * afterwards, so it is never assigned rather than assigned and cleared. The submit button then
 * stays correctly disabled and every later assertion in the test fails for reasons that look
 * nothing like the real cause.
 *
 * Retrying mirrors what a user does when a slot comes up empty: pick the file again. It does not
 * paper over the defect -- the second attempt failing raises an error that names the issue, and
 * the underlying race is tracked in #291 rather than being silently absorbed here.
 */
async function attachAndVerify(
  page: Page,
  inputId: string,
  name: string,
  buffer: Buffer,
): Promise<void> {
  const slots = page.locator('.source-dropzone__slots');

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.locator(`#${inputId}`).setInputFiles({ name, mimeType: XLSX_MIME, buffer });

    try {
      await expect(slots.getByText(name, { exact: true })).toBeVisible({ timeout: 5_000 });
      return;
    } catch {
      if (attempt === 2) {
        throw new Error(
          `Upload slot #${inputId} did not accept "${name}" after two attempts. This is Issue #291 ` +
            '(a file assignment lost under parallel load), not an assertion failure in the spec ' +
            'that called this helper.',
        );
      }
    }
  }
}

export interface RunOptions {
  accountId?: string;
  frequency?: 'Monthly' | 'Annual';
  month?: string;
  label?: string;
}

export async function runReconciliation(
  page: Page,
  bankBuffer: Buffer,
  glBuffer: Buffer,
  options: RunOptions = {},
): Promise<void> {
  const { accountId = 'OPERATING-001', frequency = 'Monthly', month = 'March', label } = options;

  // Before openSetup, not after: registering navigates to /accounts, which would discard uploads.
  await ensureBankAccountsRegistered(page);
  await openSetup(page);
  await setWorkbookFiles(page, bankBuffer, glBuffer);
  await page.getByPlaceholder('OPERATING-001').fill(accountId);

  if (frequency === 'Annual') {
    await page.locator('#reconciliation-frequency-select').selectOption('Annual');
  } else {
    await page.getByLabel('Month').selectOption(month);
  }

  if (label !== undefined) {
    await page.getByLabel('Run label').fill(label);
  }

  await submitRunButton(page).click();
  // A completed run lands on the Review stage, Summary view.
  await expect(page.getByText('Total reviewed')).toBeVisible({ timeout: 30_000 });
}

// Opens the Exceptions triage view (Review stage) after a completed run.
export async function openExceptions(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Exceptions' }).click();
  await expect(page.locator('#exception-search-input')).toBeVisible();
}

// The Summary category breakdown renders each detected category once as a table cell.
export function exceptionSummaryCell(page: Page, displayName: string) {
  return page.getByRole('cell', { name: displayName, exact: true }).first();
}

// A single exception entry inside the triage list pane.
export function exceptionRow(page: Page, displayName: string) {
  return page.locator('.exception-row', { hasText: displayName }).first();
}
