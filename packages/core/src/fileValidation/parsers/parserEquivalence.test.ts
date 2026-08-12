import { describe, expect, it } from 'vitest';

import ExcelJS from 'exceljs';

import { CsvParser } from './csvParser';
import { XlsxParser } from './xlsxParser';

const toBuffer = async (workbook: ExcelJS.Workbook): Promise<Buffer> =>
  Buffer.from(await workbook.xlsx.writeBuffer());

/**
 * implementation-spec.md's own Definition of Done: "A CSV file and its equivalent XLSX file
 * validate to the same result and normalized records." No .xlsx fixtures actually ship in the
 * design-handoff bundle (only .csv, despite the docs describing .{csv,xlsx} pairs), so this
 * builds the XLSX equivalent in-memory from the same values rather than committing a fabricated
 * binary fixture -- this is the acceptance test that proves the two parsers are equivalent by
 * construction, independent of any specific bundled sample file.
 */
describe('CSV/XLSX parser equivalence', () => {
  it('reduces a banking-format sample to identical row objects from both formats', async () => {
    const headers = [
      'transaction_id',
      'account_id',
      'posted_date',
      'transaction_date',
      'amount',
      'currency_code',
      'transaction_type',
      'description',
      'memo',
      'check_number',
      'reference_number',
      'counterparty_account',
      'running_balance',
    ];
    const dataRows = [
      [
        'TXN-1001',
        '****4821',
        '2026-07-01',
        '2026-07-01',
        '2500.00',
        'USD',
        'DEP',
        'Payroll deposit, biweekly',
        '',
        '',
        'REF-1',
        '',
        '10000.00',
      ],
      [
        'TXN-1002',
        '****4821',
        '2026-07-02',
        '2026-07-02',
        '-84.23',
        'USD',
        'POS',
        'Card purchase "Acme Coffee"',
        '',
        '',
        'REF-2',
        '',
        '9915.77',
      ],
    ];

    const csvLine = (values: string[]): string =>
      values.map((value) => (/[,"\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)).join(',');
    const csvBytes = Buffer.from(
      [csvLine(headers), ...dataRows.map(csvLine)].join('\n') + '\n',
      'utf8',
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(headers);
    dataRows.forEach((row) => sheet.addRow(row));
    const xlsxBytes = await toBuffer(workbook);

    const csvResult = await new CsvParser().parse(csvBytes);
    const xlsxResult = await new XlsxParser().parse(xlsxBytes);

    expect(xlsxResult).toEqual(csvResult);
  });
});
