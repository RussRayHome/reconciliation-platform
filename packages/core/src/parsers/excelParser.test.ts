import { describe, expect, it } from 'vitest';

import ExcelJS from 'exceljs';

import { defaultReconciliationConfig } from '@recon/config';

import { parseWorkbook } from './excelParser';

const toBuffer = async (workbook: ExcelJS.Workbook): Promise<Uint8Array> =>
  new Uint8Array(await workbook.xlsx.writeBuffer());

describe('parseWorkbook', () => {
  it('resolves columns via alias scoring and stringifies varied cell types', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ledger');
    // Headers exercise exact, substring, full-token, and partial-token alias scoring.
    sheet.addRow(['Transaction Date', 'Descriptions', 'Amount', 'Reference', 'Extra Notes']);
    sheet.addRow([new Date('2026-03-31T00:00:00Z'), 'Coffee shop', 12.5, 'REF-1', true]);

    const formulaRow = sheet.addRow(['2026-04-01', 'Totals', 0, 'REF-2', '']);
    formulaRow.getCell(3).value = { formula: 'A2+1', result: 42 } as ExcelJS.CellValue;

    sheet.getCell('B4').value = {
      richText: [{ text: 'Rich ' }, { text: 'text' }],
    } as ExcelJS.CellValue;
    sheet.getCell('A4').value = '2026-04-02';
    sheet.getCell('C4').value = 99;

    // Fully empty row should be skipped.
    sheet.addRow([null, null, null, null, null]);

    const { sourceFile, rawRows } = await parseWorkbook({
      source: 'bank',
      fileName: 'ledger.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1024,
      buffer: await toBuffer(workbook),
      config: defaultReconciliationConfig.bank,
    });

    expect(sourceFile.worksheetName).toBe('Ledger');
    expect(rawRows).toHaveLength(3);
    expect(rawRows[0]?.transactionDateRaw).toContain('2026');
    expect(rawRows[0]?.descriptionRaw).toBe('Coffee shop');
    expect(rawRows[1]?.amountRaw).toBe('42');
    expect(rawRows[2]?.descriptionRaw).toBe('Rich text');
    expect(rawRows.every((row) => !row.excluded)).toBe(true);
  });

  it('excludes beginning-balance and configured excluded rows for GL sources', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('GL');
    sheet.addRow(['Date', 'Memo', 'Amount', 'Name']);
    sheet.addRow(['2026-03-01', 'Beginning Balance', 0, 'System']);
    sheet.addRow(['2026-03-02', 'Vendor payment', -50, 'Acme']);
    sheet.addRow(['2026-03-03', 'Manually excluded', -75, 'Beta']);

    const { rawRows } = await parseWorkbook({
      source: 'gl',
      fileName: 'gl.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 2048,
      buffer: await toBuffer(workbook),
      config: { ...defaultReconciliationConfig.gl, excludedRows: [4] },
    });

    const beginning = rawRows.find((row) => row.descriptionRaw === 'Beginning Balance');
    const payment = rawRows.find((row) => row.descriptionRaw === 'Vendor payment');
    const manual = rawRows.find((row) => row.descriptionRaw === 'Manually excluded');

    expect(beginning?.excluded).toBe(true);
    expect(beginning?.exclusionReason).toContain('Beginning balance');
    expect(payment?.excluded).toBe(false);
    expect(manual?.excluded).toBe(true);
  });

  it('throws when the workbook has no worksheet', async () => {
    const workbook = new ExcelJS.Workbook();

    await expect(
      parseWorkbook({
        source: 'bank',
        fileName: 'empty.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 10,
        buffer: await toBuffer(workbook),
        config: defaultReconciliationConfig.bank,
      }),
    ).rejects.toThrow(/No worksheet found/);
  });
});
