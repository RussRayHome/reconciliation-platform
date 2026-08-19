const QUOTE = '"';
const NEEDS_QUOTING = /[",\r\n]/;

/** Inverse of `csvParser.ts`'s `tokenizeCsv` -- RFC 4180 quoting (a field containing a comma,
 * quote, or newline is wrapped in quotes, with internal quotes doubled), same hand-rolled
 * convention as the reader (no new dependency). Used by `bankFileMerge.ts` to re-serialize a
 * merged bank dataset back into bytes `validateFile` can consume unchanged. */
const escapeField = (value: string): string => {
  if (!NEEDS_QUOTING.test(value)) {
    return value;
  }
  return `${QUOTE}${value.replaceAll(QUOTE, `${QUOTE}${QUOTE}`)}${QUOTE}`;
};

/** Serializes the shared {headers, rows} shape into RFC 4180 CSV bytes, columns in `headers`
 * order. A row missing a header's key is written as a blank field. */
export const writeCsvBuffer = (headers: string[], rows: Record<string, string>[]): Buffer => {
  const lines = [headers.map(escapeField).join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeField(row[header] ?? '')).join(','));
  });
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
};
