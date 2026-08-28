import { createWorkbookFromRows } from '@recon/test-fixtures';
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures';
import { loginToApplication, openSetup, submitRunButton } from '../auth';
import {
  bankHeaderOnlyFileValidationRows,
  createSampleGlFileValidationWorkbook,
} from '../fileValidationWorkbooks';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BANK_HEADER = ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'];

test.beforeEach(async ({ page }) => {
  await loginToApplication(page);
});

/** Account B's own bank workbook is a required upload slot (Issue #141), but this file's scenarios
 * only care about Account A's rows -- an empty (header-only) Account B file merges cleanly and
 * contributes zero extra bank rows, so it never perturbs the row counts/exceptions these tests
 * assert on. Bank filenames must start with the account number (or its last 4 digits) followed by
 * "-"/"_" per ADR-0003's filename convention. */
async function setWorkbookFiles(page: Page, bankBuffer: Buffer, glBuffer: Buffer): Promise<void> {
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

// ─── Screen 02: upload transfer states ───────────────────────────────────────
// The "uploading N%" progress state is real XHR upload-progress on a same-machine loopback
// request -- these fixtures transfer in a single tick, so there's no reliable window to catch an
// intermediate percentage without CDP-level throttling. "network-failed" is both more valuable
// (it's the actual error-recovery path) and fully deterministic to trigger via route interception,
// so that's what this covers.

test.describe('upload transfer', () => {
  test('a network interruption during submit shows the retry state, and retry succeeds', async ({
    page,
  }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows([
        BANK_HEADER,
        ['2025-01-02', 'ACME OFFICE SUPPLY', '1', '', '125.50', '', '9874.50'],
      ]),
      createSampleGlFileValidationWorkbook(),
    ]);

    let attempt = 0;
    await page.route('**/api/imports/runs', async (route) => {
      attempt += 1;
      if (attempt === 1) {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await submitRunButton(page).click();

    // Bank and GL upload as a single combined request (ImportUploadCard's own doc comment), so
    // aborting it fails both cards at once.
    await expect(page.getByText('UPLOAD_NETWORK_INTERRUPTED').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Retry upload' }).first().click();

    // The retried request goes through the same route handler (attempt === 2) and is allowed to
    // continue -- since File Validation now sees just one valid row, this run completes rather
    // than reaching Review with matched data (single-row files pass straight through).
    await expect(page.getByText('UPLOAD_NETWORK_INTERRUPTED').first()).not.toBeVisible({ timeout: 15_000 });
  });
});

// ─── Screen 06: partial import ───────────────────────────────────────────────

test.describe('partial import', () => {
  test('a file with one invalid row offers importing the remaining valid rows', async ({ page }) => {
    const [bankBuffer, glBuffer] = await Promise.all([
      createWorkbookFromRows([
        BANK_HEADER,
        ['2025-01-02', 'ACME OFFICE SUPPLY', '1', '', '125.50', '', '9874.50'],
        // Blank Date -- fails BANK_DATE_REQUIRED (Step 3), but the file still has one importable
        // row, landing on Screen 06 (RowGridPanel) rather than Screen 07 (AllRowsInvalidPanel,
        // which only renders when importableRowCount is 0).
        ['', 'BANK FEE MISSING DATE', '2', '', '45.00', '', '9829.50'],
      ]),
      createSampleGlFileValidationWorkbook(),
    ]);

    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await submitRunButton(page).click();

    await expect(page.getByRole('heading', { name: 'Cell validation results' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Skip invalid rows and import the remaining 1')).toBeVisible();

    await page.getByRole('button', { name: 'Import 1 rows & submit' }).click();

    // A completed run lands on the Review stage, Summary view.
    await expect(page.getByText('Total reviewed')).toBeVisible({ timeout: 30_000 });
  });
});
