/** Only the header row (plus one sample row for live transform previews) is ever read from an uploaded file. */
const HEADER_READ_BYTES = 65536;

export type MappingSourceColumn = { id: string; sample: string };

/** Quote-aware, comma-delimited single-line CSV parse (handles `""`-escaped quotes within a field). */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current.trim());
  return fields;
}

/** Builds source columns from a header line and an optional first data line (used as the sample value). */
export function parseHeaderRow(headerLine: string, sampleLine?: string): MappingSourceColumn[] {
  const headers = parseCsvLine(headerLine).filter(Boolean);
  const samples = sampleLine ? parseCsvLine(sampleLine) : [];
  return headers.map((id, index) => ({ id, sample: samples[index] ?? '' }));
}

/**
 * Reads only the first 64KB of `file` — never the full file — and returns its header-derived
 * source columns. Throws if no header row can be detected (empty file, or a first line that's
 * entirely whitespace).
 */
export async function readHeaderOnly(file: File): Promise<MappingSourceColumn[]> {
  const text = await file.slice(0, HEADER_READ_BYTES).text();
  const lines = text.split(/\r?\n/);
  const headerLine = lines[0] ?? '';

  if (!headerLine.trim()) {
    throw new Error('No header row detected.');
  }

  const columns = parseHeaderRow(headerLine, lines[1]);

  if (columns.length === 0) {
    throw new Error('No header row detected.');
  }

  return columns;
}
