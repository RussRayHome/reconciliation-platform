import { describe, expect, it } from 'vitest';

import { parseCsvBuffer } from './csvParser';
import { writeCsvBuffer } from './csvWriter';

describe('writeCsvBuffer', () => {
  it('round-trips plain fields through the real CSV parser', () => {
    const headers = ['Date', 'Description', 'Sequence Number'];
    const rows = [
      { Date: '2026-02-02', Description: 'ACME OFFICE SUPPLY', 'Sequence Number': '1234-000001' },
      { Date: '2026-02-03', Description: 'PAYROLL ACH', 'Sequence Number': '1234-000002' },
    ];

    const buffer = writeCsvBuffer(headers, rows);
    const parsed = parseCsvBuffer(buffer);

    expect(parsed.headers).toEqual(headers);
    expect(parsed.rows).toEqual(rows);
  });

  it('quotes a field containing a comma', () => {
    const buffer = writeCsvBuffer(['Description'], [{ Description: 'ACME, INC' }]);
    expect(buffer.toString('utf8')).toBe('Description\n"ACME, INC"\n');

    const parsed = parseCsvBuffer(buffer);
    expect(parsed.rows).toEqual([{ Description: 'ACME, INC' }]);
  });

  it('quotes and doubles an embedded quote', () => {
    const buffer = writeCsvBuffer(['Description'], [{ Description: 'Say "hi"' }]);
    expect(buffer.toString('utf8')).toBe('Description\n"Say ""hi"""\n');

    const parsed = parseCsvBuffer(buffer);
    expect(parsed.rows).toEqual([{ Description: 'Say "hi"' }]);
  });

  it('quotes a field containing an embedded newline', () => {
    const buffer = writeCsvBuffer(['Description'], [{ Description: 'Line one\nLine two' }]);

    const parsed = parseCsvBuffer(buffer);
    expect(parsed.rows).toEqual([{ Description: 'Line one\nLine two' }]);
  });

  it('writes a blank field when a row is missing a header key', () => {
    const buffer = writeCsvBuffer(['Date', 'Balance'], [{ Date: '2026-02-02' }]);
    expect(buffer.toString('utf8')).toBe('Date,Balance\n2026-02-02,\n');
  });
});
