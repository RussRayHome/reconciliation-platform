import { createWorkbookFromRows } from '@recon/test-fixtures';
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures';
import { loginToApplication, openSetup } from '../auth';
import { createSampleGlFileValidationWorkbook } from '../fileValidationWorkbooks';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BANK_HEADER = [
  'transaction_id',
  'account_id',
  'posted_date',
  'amount',
  'currency_code',
  'transaction_type',
  'description',
];

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
        ['TXN-6001', 'OPERATING-001', '2025-01-02', '-125.50', 'USD', 'DEBIT', 'ACME OFFICE SUPPLY'],
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
    await page.getByRole('button', { name: 'Submit run' }).click();

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
        ['TXN-6101', 'OPERATING-001', '2025-01-02', '-125.50', 'USD', 'DEBIT', 'ACME OFFICE SUPPLY'],
        // Blank posted_date -- fails BANK_POSTED_DATE_REQUIRED (Step 3), but the file still has
        // one importable row, landing on Screen 06 (RowGridPanel) rather than Screen 07
        // (AllRowsInvalidPanel, which only renders when importableRowCount is 0).
        ['TXN-6102', 'OPERATING-001', '', '-45.00', 'USD', 'FEE', 'BANK FEE MISSING DATE'],
      ]),
      createSampleGlFileValidationWorkbook(),
    ]);

    await openSetup(page);
    await setWorkbookFiles(page, bankBuffer, glBuffer);
    await page.getByRole('button', { name: 'Submit run' }).click();

    await expect(page.getByRole('heading', { name: 'Cell validation results' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Skip invalid rows and import the remaining 1')).toBeVisible();

    await page.getByRole('button', { name: 'Import 1 rows & submit' }).click();

    // A completed run lands on the Review stage, Summary view.
    await expect(page.getByText('Total reviewed')).toBeVisible({ timeout: 30_000 });
  });
});
