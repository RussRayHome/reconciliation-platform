/**
 * Header + row-object shape both parsers reduce their file to (implementation-spec.md §2.1) --
 * downstream validation and normalization logic is identical regardless of source format. Column
 * order in `headers` is preserved exactly as read, unresolved against any canonical field list --
 * the File Validation Engine's own structural gates are what compare it to the expected
 * banking/GL header lists.
 */
export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

/** A parser that reduces one file format's bytes to the shared row-object shape. */
export interface FileParser {
  parse(bytes: Buffer): Promise<ParsedFile>;
}
