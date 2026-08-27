import { createWorkbookFromRows } from '@recon/test-fixtures';
import type { Page } from '@playwright/test';

import { expect } from './fixtures';
import { openSetup } from './auth';
import { bankHeaderOnlyFileValidationRows } from './fileValidationWorkbooks';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Account B's own bank workbook is a required upload slot (Issue #141); an empty (header-only)
 * file merges cleanly and contributes zero extra bank rows, so it never perturbs the row
 * counts/exception categories these scenarios assert on. Bank filenames must start with the
 * account number (or its last 4 digits) followed by "-"/"_" per ADR-0003's filename convention. */
export async function setWorkbookFiles(page: Page, bankBuffer: Buffer, glBuffer: Buffer): Promise<void> {
  const bankAccountBBuffer = await createWorkbookFromRows(bankHeaderOnlyFileValidationRows);

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
    name: 'gl.xlsx',
    mimeType: XLSX_MIME,
    buffer: glBuffer,
  });
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

  await page.getByRole('button', { name: 'Submit run' }).click();
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
