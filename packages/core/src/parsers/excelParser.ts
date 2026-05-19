import type {
  BusinessField,
  RawTransactionRow,
  SourceFile,
  SourceReconciliationConfig,
  SourceSystem,
} from '@recon/domain';

import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';

const normalizeHeader = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, ' ')
    .replaceAll(/\s+/g, ' ');

const tokenizeHeader = (value: string): string[] =>
  normalizeHeader(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => (token.endsWith('S') ? token.slice(0, -1) : token));

const scoreAliasMatch = (header: string, alias: string): number => {
  const normalizedHeader = normalizeHeader(header);
  const normalizedAlias = normalizeHeader(alias);

  if (!normalizedHeader || !normalizedAlias) {
    return 0;
  }

  if (normalizedHeader === normalizedAlias) {
    return 100;
  }

  if (normalizedHeader.includes(normalizedAlias) || normalizedAlias.includes(normalizedHeader)) {
    return 90;
  }

  const headerTokens = tokenizeHeader(normalizedHeader);
  const aliasTokens = tokenizeHeader(normalizedAlias);

  if (!headerTokens.length || !aliasTokens.length) {
    return 0;
  }

  const tokenMatches = aliasTokens.filter((aliasToken) =>
    headerTokens.some(
      (headerToken) =>
        headerToken === aliasToken ||
        headerToken.startsWith(aliasToken) ||
        aliasToken.startsWith(headerToken),
    ),
  ).length;

  if (tokenMatches === 0) {
    return 0;
  }

  if (tokenMatches === aliasTokens.length) {
    return 80;
  }

  return 50;
};

const stringifyUnknown = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return JSON.stringify(value);
};

const stringifyCellValue = (value: ExcelJS.CellValue | null): string | undefined => {
  if (value === null) {
    return undefined;
  }

  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }

    if ('result' in value && value.result !== undefined) {
      return stringifyUnknown(value.result);
    }

    if ('formula' in value && value.result !== undefined) {
      return stringifyUnknown(value.result);
    }

    if ('richText' in value) {
      return value.richText.map((part) => part.text).join('');
    }

    if (value instanceof Date) {
      return value.toISOString();
    }
  }

  return stringifyUnknown(value);
};

const findBestColumnForAliases = (
  headerByIndex: Map<number, string>,
  aliases: string[],
): { bestScore: number; bestColumnIndex: number | undefined } => {
  let bestScore = 0;
  let bestColumnIndex: number | undefined;

  for (const [columnIndex, header] of headerByIndex.entries()) {
    for (const alias of aliases) {
      const score = scoreAliasMatch(header, alias);
      if (score > bestScore) {
        bestScore = score;
        bestColumnIndex = columnIndex;
      }
    }
  }

  return { bestScore, bestColumnIndex };
};

const getColumnIndexes = (
  headerRow: ExcelJS.Row,
  config: SourceReconciliationConfig,
): Partial<Record<BusinessField, number>> => {
  const headerByIndex = new Map<number, string>();

  headerRow.eachCell((cell, colNumber) => {
    const text = stringifyCellValue(cell.value);
    if (!text) {
      return;
    }

    headerByIndex.set(colNumber, text);
  });

  const columnIndexes: Partial<Record<BusinessField, number>> = {};

  for (const [field, aliases] of Object.entries(config.columnAliases) as [
    BusinessField,
    string[],
  ][]) {
    const { bestScore, bestColumnIndex } = findBestColumnForAliases(headerByIndex, aliases);

    if (bestColumnIndex && bestScore >= 80) {
      columnIndexes[field] = bestColumnIndex;
    }
  }

  return columnIndexes;
};

const cellValueByIndex = (row: ExcelJS.Row, index: number | undefined): string | undefined => {
  if (!index) {
    return undefined;
  }

  return stringifyCellValue(row.getCell(index).value)?.trim() || undefined;
};

const isBeginningBalanceRow = (
  row: RawTransactionRow,
  config: SourceReconciliationConfig,
): boolean => {
  if (!config.excludeBeginningBalance) {
    return false;
  }

  const haystacks = [row.descriptionRaw, row.payeeNameRaw, row.merchantNameRaw]
    .filter(Boolean)
    .map((value) => value!.toUpperCase());

  return config.beginningBalancePatterns.some((pattern) =>
    haystacks.some((haystack) => haystack.includes(pattern.toUpperCase())),
  );
};

/** Input required to parse a bank or QBO Excel/CSV workbook. */
export interface ParseWorkbookInput {
  source: SourceSystem;
  sourceFileId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Uint8Array;
  config: SourceReconciliationConfig;
}

/** Parsed output: the resolved source-file metadata and the extracted raw transaction rows. */
export interface ParsedWorkbook {
  sourceFile: SourceFile;
  rawRows: RawTransactionRow[];
}

/**
 * Parses a bank or QBO workbook buffer into raw transaction rows using the provided
 * reconciliation config for header resolution and column mapping.
 */
export const parseWorkbook = async ({
  source,
  sourceFileId,
  fileName,
  mimeType,
  sizeBytes,
  buffer,
  config,
}: ParseWorkbookInput): Promise<ParsedWorkbook> => {
  const workbookPayload = Buffer.from(buffer);

  let workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      workbookPayload as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      workbookPayload as unknown as Parameters<typeof workbook.xlsx.load>[0],
      {
        ignoreNodes: ['drawing', 'picture'],
      },
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error(`No worksheet found in ${fileName}.`);
  }

  const headerRow = worksheet.getRow(config.headerRow);
  const columnIndexes = getColumnIndexes(headerRow, config);

  const sourceFile: SourceFile = {
    id: sourceFileId ?? randomUUID(),
    source,
    fileName,
    mimeType,
    sizeBytes,
    worksheetName: worksheet.name,
    headerRow: config.headerRow,
    transactionStartRow: config.transactionStartRow,
    excludedRowNumbers: [...config.excludedRows],
    uploadedAt: new Date().toISOString(),
  };

  const rawRows: RawTransactionRow[] = [];
  const lastRowNumber = worksheet.actualRowCount || worksheet.rowCount;

  for (let lineNumber = config.transactionStartRow; lineNumber <= lastRowNumber; lineNumber += 1) {
    const row = worksheet.getRow(lineNumber);
    const rawValues: RawTransactionRow['rawValues'] = {};
    let hasValue = false;

    headerRow.eachCell((cell, columnNumber) => {
      const headerName = stringifyCellValue(cell.value)?.trim() || `Column ${columnNumber}`;
      const value = row.getCell(columnNumber).value;
      rawValues[headerName] = value instanceof Date ? value : (stringifyCellValue(value) ?? null);
      if (rawValues[headerName] !== null && rawValues[headerName] !== '') {
        hasValue = true;
      }
    });

    if (!hasValue) {
      continue;
    }

    const parsedRow: RawTransactionRow = {
      id: randomUUID(),
      sourceFileId: sourceFile.id,
      source,
      spreadsheetFileName: fileName,
      worksheetName: worksheet.name,
      lineNumber,
      rawValues,
      transactionDateRaw: cellValueByIndex(row, columnIndexes.transactionDate),
      postingDateRaw: cellValueByIndex(row, columnIndexes.postingDate),
      transactionTypeRaw: cellValueByIndex(row, columnIndexes.transactionType),
      checkNumberRaw: cellValueByIndex(row, columnIndexes.checkNumber),
      serialNumberRaw: cellValueByIndex(row, columnIndexes.serialNumber),
      referenceNumberRaw: cellValueByIndex(row, columnIndexes.referenceNumber),
      descriptionRaw: cellValueByIndex(row, columnIndexes.description),
      merchantNameRaw: cellValueByIndex(row, columnIndexes.merchantName),
      payeeNameRaw: cellValueByIndex(row, columnIndexes.payeeName),
      amountRaw: cellValueByIndex(row, columnIndexes.amount),
      debitRaw: cellValueByIndex(row, columnIndexes.debit),
      creditRaw: cellValueByIndex(row, columnIndexes.credit),
      runningBalanceRaw: cellValueByIndex(row, columnIndexes.runningBalance),
      excluded: config.excludedRows.includes(lineNumber),
      parsingIssues: [],
    };

    if (isBeginningBalanceRow(parsedRow, config)) {
      parsedRow.excluded = true;
      parsedRow.exclusionReason = 'Beginning balance row excluded from reconciliation.';
      sourceFile.excludedRowNumbers.push(lineNumber);
    }

    rawRows.push(parsedRow);
  }

  return {
    sourceFile,
    rawRows,
  };
};
