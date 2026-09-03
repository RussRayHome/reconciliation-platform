import { createWorkbookFromRows } from '@recon/test-fixtures';
import type { Page } from '@playwright/test';

import { expect } from './fixtures';
import { openSetup, submitRunButton } from './auth';
import { bankHeaderOnlyFileValidationRows } from './fileValidationWorkbooks';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Account B's own bank workbook is a required upload slot (Issue #141); an empty (header-only)
 * file merges cleanly and contributes zero extra bank rows, so it never perturbs the row
 * counts/exception categories these scenarios assert on. Bank filenames must start with the
 * account number (or its last 4 digits) followed by "-"/"_" per ADR-0003's filename convention. */
export async function setWorkbookFiles(page: Page, bankBuffer: Buffer, glBuffer: Buffer): Promise<void> {
  const bankAccountBBuffer = await createWorkbookFromRows(bankHeaderOnlyFileValidationRows);

  await attachAndVerify(page, 'bank-workbook-input', '1111_bank.xlsx', bankBuffer);
  await attachAndVerify(page, 'bank-workbook-b-input', '2222_bank.xlsx', bankAccountBBuffer);
  await attachAndVerify(page, 'gl-workbook-input', 'gl.xlsx', glBuffer);
}

/**
 * Attaches one workbook and confirms the slot actually took it, retrying once if not.
 *
 * Issue #291: under parallel load a `setInputFiles` call occasionally returns without the app
 * recording the file -- traced directly, the slot still reads "No file selected" immediately
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
