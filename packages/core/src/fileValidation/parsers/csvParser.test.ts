import { describe, expect, it } from 'vitest';

import { CsvParser, parseCsvBuffer } from './csvParser';

describe('parseCsvBuffer', () => {
  it('parses a simple header + rows file', () => {
    const bytes = Buffer.from('a,b,c\n1,2,3\n4,5,6\n', 'utf8');

    expect(parseCsvBuffer(bytes)).toEqual({
      headers: ['a', 'b', 'c'],
      rows: [
        { a: '1', b: '2', c: '3' },
        { a: '4', b: '5', c: '6' },
      ],
    });
  });

  it('handles a quoted field containing a comma', () => {
    const bytes = Buffer.from('description,amount\n"Coffee, tea, and snacks",12.50\n', 'utf8');

    expect(parseCsvBuffer(bytes).rows).toEqual([{ description: 'Coffee, tea, and snacks', amount: '12.50' }]);
  });

  it('handles a quoted field containing a literal embedded newline', () => {
    const bytes = Buffer.from('description,amount\n"Line one\nLine two",5.00\n', 'utf8');

    expect(parseCsvBuffer(bytes).rows).toEqual([{ description: 'Line one\nLine two', amount: '5.00' }]);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    const bytes = Buffer.from('description,amount\n"She said ""hello""",1.00\n', 'utf8');

    expect(parseCsvBuffer(bytes).rows).toEqual([{ description: 'She said "hello"', amount: '1.00' }]);
  });

  it('treats a bare (unquoted) field with no special characters as a plain string', () => {
    const bytes = Buffer.from('a,b\nplain,text\n', 'utf8');

    expect(parseCsvBuffer(bytes).rows).toEqual([{ a: 'plain', b: 'text' }]);
  });

  it('accepts CRLF line endings identically to LF', () => {
    const crlf = Buffer.from('a,b\r\n1,2\r\n3,4\r\n', 'utf8');
    const lf = Buffer.from('a,b\n1,2\n3,4\n', 'utf8');

    expect(parseCsvBuffer(crlf)).toEqual(parseCsvBuffer(lf));
  });

  it('strips a leading UTF-8 BOM', () => {
    const withBom = Buffer.concat([Buffer.from('\uFEFF', 'utf8'), Buffer.from('a,b\n1,2\n', 'utf8')]);

    expect(parseCsvBuffer(withBom)).toEqual({ headers: ['a', 'b'], rows: [{ a: '1', b: '2' }] });
  });

  it('parses correctly with no trailing newline at end of file', () => {
    const bytes = Buffer.from('a,b\n1,2', 'utf8');

    expect(parseCsvBuffer(bytes)).toEqual({ headers: ['a', 'b'], rows: [{ a: '1', b: '2' }] });
  });

  it('skips blank interstitial and trailing lines rather than treating them as data rows', () => {
    const bytes = Buffer.from('a,b\n1,2\n\n3,4\n\n', 'utf8');

    expect(parseCsvBuffer(bytes).rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('fills a missing trailing field with an empty string when a row is short', () => {
    const bytes = Buffer.from('a,b,c\n1,2\n', 'utf8');

    expect(parseCsvBuffer(bytes).rows).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('returns empty headers and rows for an empty buffer', () => {
    expect(parseCsvBuffer(Buffer.from('', 'utf8'))).toEqual({ headers: [], rows: [] });
  });
});

describe('CsvParser', () => {
  it('implements FileParser.parse as an async wrapper around parseCsvBuffer', async () => {
    const parser = new CsvParser();
    const result = await parser.parse(Buffer.from('a,b\n1,2\n', 'utf8'));

    expect(result).toEqual({ headers: ['a', 'b'], rows: [{ a: '1', b: '2' }] });
  });
});
