import { describe, expect, it } from 'vitest';

import ExcelJS from 'exceljs';

import { XlsxParser } from './xlsxParser';

const toBuffer = async (workbook: ExcelJS.Workbook): Promise<Buffer> =>
  Buffer.from(await workbook.xlsx.writeBuffer());

describe('XlsxParser', () => {
  it('reads the header row and following rows from the first worksheet', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['transaction_id', 'amount']);
    sheet.addRow(['TXN-1', 100]);
    sheet.addRow(['TXN-2', -50]);

    const parser = new XlsxParser();
    const result = await parser.parse(await toBuffer(workbook));

    expect(result).toEqual({
      headers: ['transaction_id', 'amount'],
      rows: [
        { transaction_id: 'TXN-1', amount: '100' },
        { transaction_id: 'TXN-2', amount: '-50' },
      ],
    });
  });

  it('formats a native date cell as plain YYYY-MM-DD', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['posted_date']);
    sheet.addRow([new Date('2026-08-04T00:00:00Z')]);

    const parser = new XlsxParser();
    const result = await parser.parse(await toBuffer(workbook));

    expect(result.rows).toEqual([{ posted_date: '2026-08-04' }]);
  });

  it('resolves a formula cell to its cached result', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['total']);
    const row = sheet.addRow([0]);
    row.getCell(1).value = { formula: 'A1+1', result: 42 } as ExcelJS.CellValue;

    const parser = new XlsxParser();
    const result = await parser.parse(await toBuffer(workbook));

    expect(result.rows).toEqual([{ total: '42' }]);
  });

  it('joins rich text runs into plain text', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['description']);
    sheet.getCell('A2').value = {
      richText: [{ text: 'Rich ' }, { text: 'text' }],
    } as ExcelJS.CellValue;

    const parser = new XlsxParser();
    const result = await parser.parse(await toBuffer(workbook));

    expect(result.rows).toEqual([{ description: 'Rich text' }]);
  });

  it('preserves a blank header cell as an empty-string column so later columns stay aligned', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['a', null, 'c']);
    sheet.addRow(['1', '2', '3']);

    const parser = new XlsxParser();
    const result = await parser.parse(await toBuffer(workbook));

    expect(result.headers).toEqual(['a', '', 'c']);
    expect(result.rows).toEqual([{ a: '1', '': '2', c: '3' }]);
  });

  it('skips a fully empty row', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['a', 'b']);
    sheet.addRow(['1', '2']);
    sheet.addRow([null, null]);
    sheet.addRow(['3', '4']);

    const parser = new XlsxParser();
    const result = await parser.parse(await toBuffer(workbook));

    expect(result.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('returns empty headers and rows when the workbook has no worksheets', async () => {
    const workbook = new ExcelJS.Workbook();

    const parser = new XlsxParser();
    const result = await parser.parse(await toBuffer(workbook));

    expect(result).toEqual({ headers: [], rows: [] });
  });
});
