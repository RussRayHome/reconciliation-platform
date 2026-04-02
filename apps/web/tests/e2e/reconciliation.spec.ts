import { createSampleBankWorkbook, createSampleQboWorkbook } from '@recon/test-fixtures';
import { expect, test } from '@playwright/test';

test('uploads workbooks and shows reconciliation results', async ({ page }) => {
  const currentYear = new Date().getFullYear();
  const [bankBuffer, qboBuffer] = await Promise.all([
    createSampleBankWorkbook(),
    createSampleQboWorkbook(),
  ]);

  await page.goto('/');

  await page.getByLabel('Bank workbook').setInputFiles({
    name: 'bank.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bankBuffer,
  });
  await page.getByLabel('QBO workbook').setInputFiles({
    name: 'qbo.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: qboBuffer,
  });
  await page.getByPlaceholder('OPERATING-001').fill('OPERATING-001');
  await page.getByLabel('Monthly reconciliation month').selectOption('March');
  await page.getByLabel('Reconciliation label').fill(`Monthly Recon for March ${currentYear}`);
  await page.getByRole('button', { name: 'Run reconciliation' }).click();

  await expect(page.getByRole('heading', { name: 'Exception Report' })).toBeVisible();
  await expect(page.getByText('Total reviewed')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Probable Match Review' })).toBeVisible();
});
