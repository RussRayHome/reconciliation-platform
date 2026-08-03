import { describe, expect, it } from 'vitest';

import { parseCsvLine, parseHeaderRow, readHeaderOnly } from './csvHeader';

describe('parseCsvLine', () => {
  it('splits a plain comma-delimited line', () => {
    expect(parseCsvLine('Post Date,Description,Amount')).toEqual([
      'Post Date',
      'Description',
      'Amount',
    ]);
  });

  it('keeps commas inside quoted fields intact', () => {
    expect(parseCsvLine('"Smith, John",Amount')).toEqual(['Smith, John', 'Amount']);
  });

  it('unescapes doubled quotes within a quoted field', () => {
    expect(parseCsvLine('"He said ""hi""",Amount')).toEqual(['He said "hi"', 'Amount']);
  });

  it('trims surrounding whitespace on unquoted fields', () => {
    expect(parseCsvLine(' Post Date , Amount ')).toEqual(['Post Date', 'Amount']);
  });
});

describe('parseHeaderRow', () => {
  it('pairs each header with the same-index sample value', () => {
    expect(parseHeaderRow('Date,Amount', '2026-07-14,1250.00')).toEqual([
      { id: 'Date', sample: '2026-07-14' },
      { id: 'Amount', sample: '1250.00' },
    ]);
  });

  it('defaults sample to an empty string when no sample line is given', () => {
    expect(parseHeaderRow('Date,Amount')).toEqual([
      { id: 'Date', sample: '' },
      { id: 'Amount', sample: '' },
    ]);
  });

  it('drops empty header cells from trailing commas', () => {
    expect(parseHeaderRow('Date,Amount,,')).toEqual([
      { id: 'Date', sample: '' },
      { id: 'Amount', sample: '' },
    ]);
  });
});

describe('readHeaderOnly', () => {
  it('reads only the header and first data line, even from a much larger file', () => {
    const rows = ['Date,Amount', '2026-07-14,1250.00', '2026-07-15,42.00'];
    const file = new File([rows.join('\n')], 'sample.csv', { type: 'text/csv' });

    return readHeaderOnly(file).then((columns) => {
      expect(columns).toEqual([
        { id: 'Date', sample: '2026-07-14' },
        { id: 'Amount', sample: '1250.00' },
      ]);
    });
  });

  it('rejects a file with no header row', async () => {
    const file = new File([''], 'empty.csv', { type: 'text/csv' });
    await expect(readHeaderOnly(file)).rejects.toThrow('No header row detected.');
  });

  it('rejects a file whose first line is only whitespace', async () => {
    const file = new File(['   \nDate,Amount'], 'blank-first-line.csv', { type: 'text/csv' });
    await expect(readHeaderOnly(file)).rejects.toThrow('No header row detected.');
  });
});
