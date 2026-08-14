import { isBlank, isIso4217, isIsoDate, parseDecimal, todayIso } from './primitives';
import {
  bankTransactionTypes,
  DEFAULT_VALIDATION_OPTIONS,
  INFLOW_TYPES,
  OUTFLOW_TYPES,
  type BankTransactionType,
  type NormalizedRecord,
  type RawBankingRow,
  type RawGeneralLedgerRow,
  type ValidationIssue,
  type ValidationOptions,
} from './types';

/**
 * Step 3 of the ordered engine (transaction-csv-spec.md §4.1-§4.4): per-field, file-level, and
 * entry-level rules, ported near-verbatim from the design-handoff bundle's `reference/schema.ts`
 * -- same code names, severities, and messages, per the adjusted plan's own instruction to keep
 * this port byte-for-byte equivalent to the verified reference. The only material additions are
 * `sourceLineNumber` on each normalized record (schema.ts didn't need it; `canonical_record`,
 * changeset 0042, does) and accepting already-parsed row objects rather than reading files.
 */

export interface RowValidationOutcome {
  issues: ValidationIssue[];
  normalized: NormalizedRecord[];
}

export const validateBankingRows = (
  rows: RawBankingRow[],
  opts: ValidationOptions = {},
): RowValidationOutcome => {
  const options = { ...DEFAULT_VALIDATION_OPTIONS, ...opts };
  const issues: ValidationIssue[] = [];
  const normalized: NormalizedRecord[] = [];
  const seenIds = new Set<string>();
  const currencies = new Set<string>();
  const today = todayIso();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    let hardError = false;
    const err = (code: string, field: string, message: string): void => {
      issues.push({ severity: 'ERROR', code, field, rowNumber, message });
      hardError = true;
    };
    const warn = (code: string, field: string, message: string): void => {
      issues.push({ severity: 'WARNING', code, field, rowNumber, message });
    };

    if (isBlank(row.transaction_id)) {
      err('BANK_ID_REQUIRED', 'transaction_id', 'transaction_id is required');
    } else if (seenIds.has(row.transaction_id)) {
      err('BANK_ID_DUPLICATE', 'transaction_id', `Duplicate transaction_id "${row.transaction_id}"`);
    } else {
      seenIds.add(row.transaction_id);
    }

    if (isBlank(row.account_id)) {
      err('BANK_ACCOUNT_REQUIRED', 'account_id', 'account_id is required');
    }

    if (isBlank(row.posted_date)) {
      err('BANK_POSTED_DATE_REQUIRED', 'posted_date', 'posted_date is required');
    } else if (!isIsoDate(row.posted_date)) {
      err(
        'BANK_POSTED_DATE_FORMAT',
        'posted_date',
        `posted_date must be YYYY-MM-DD, got "${row.posted_date}"`,
      );
    } else if (options.rejectFutureDates && row.posted_date > today) {
      err('BANK_POSTED_DATE_FUTURE', 'posted_date', `posted_date is in the future: ${row.posted_date}`);
    }

    if (!isBlank(row.transaction_date)) {
      if (!isIsoDate(row.transaction_date!)) {
        err('BANK_TXN_DATE_FORMAT', 'transaction_date', 'transaction_date must be YYYY-MM-DD');
      } else if (isIsoDate(row.posted_date) && row.transaction_date! > row.posted_date) {
        warn(
          'BANK_TXN_DATE_AFTER_POSTED',
          'transaction_date',
          'transaction_date is after posted_date',
        );
      }
    }

    const amount = parseDecimal(row.amount, options.currencyMinorUnits);
    if (amount === null) {
      err(
        'BANK_AMOUNT_FORMAT',
        'amount',
        `amount must be a plain signed decimal (no symbols/thousands separators): "${row.amount}"`,
      );
    } else if (amount === 0) {
      warn('BANK_AMOUNT_ZERO', 'amount', 'amount is zero');
    }

    if (isBlank(row.currency_code)) {
      err('BANK_CURRENCY_REQUIRED', 'currency_code', 'currency_code is required');
    } else if (!isIso4217(row.currency_code)) {
      err(
        'BANK_CURRENCY_FORMAT',
        'currency_code',
        `currency_code must be a 3-letter ISO 4217 code: "${row.currency_code}"`,
      );
    } else {
      currencies.add(row.currency_code);
    }

    const type = row.transaction_type as BankTransactionType;
    if (isBlank(row.transaction_type)) {
      err('BANK_TYPE_REQUIRED', 'transaction_type', 'transaction_type is required');
    } else if (!(bankTransactionTypes as readonly string[]).includes(row.transaction_type)) {
      err('BANK_TYPE_INVALID', 'transaction_type', `Unknown transaction_type "${row.transaction_type}"`);
    } else if (amount !== null) {
      if (INFLOW_TYPES.has(type) && amount < 0) {
        err('BANK_TYPE_SIGN', 'transaction_type', `${type} must have a positive amount`);
      }
      if (OUTFLOW_TYPES.has(type) && amount > 0) {
        err('BANK_TYPE_SIGN', 'transaction_type', `${type} must have a negative amount`);
      }
    }

    if (isBlank(row.description)) {
      err('BANK_DESCRIPTION_REQUIRED', 'description', 'description is required');
    }

    if (type === 'CHECK' && isBlank(row.check_number)) {
      warn(
        'BANK_CHECK_NUMBER_MISSING',
        'check_number',
        'check_number recommended when transaction_type is CHECK',
      );
    }

    if (
      !isBlank(row.running_balance) &&
      parseDecimal(row.running_balance!, options.currencyMinorUnits) === null
    ) {
      err(
        'BANK_BALANCE_FORMAT',
        'running_balance',
        `running_balance must be a plain decimal: "${row.running_balance}"`,
      );
    }

    if (!hardError && amount !== null) {
      const signed = options.flipSign ? -amount : amount;
      normalized.push({
        sourceSystem: 'BANK',
        recordId: row.transaction_id,
        account: row.account_id,
        date: row.posted_date,
        currencyCode: row.currency_code,
        signedAmount: signed,
        direction: signed >= 0 ? 'INFLOW' : 'OUTFLOW',
        magnitude: Math.abs(signed),
        description: row.description,
        reference: row.reference_number || undefined,
        sourceLineNumber: rowNumber,
        raw: row,
      });
    }
  });

  if (options.singleCurrency && currencies.size > 1) {
    issues.push({
      severity: 'ERROR',
      code: 'BANK_MULTI_CURRENCY',
      message: `File mixes currencies: ${[...currencies].join(', ')}. Expected a single currency.`,
    });
  }

  const allHaveBalance = rows.length > 0 && rows.every((row) => !isBlank(row.running_balance));
  if (allHaveBalance) {
    for (let index = 1; index < rows.length; index += 1) {
      const previousRow = rows[index - 1]!;
      const currentRow = rows[index]!;
      const previous = parseDecimal(previousRow.running_balance!, options.currencyMinorUnits);
      const current = parseDecimal(currentRow.running_balance!, options.currencyMinorUnits);
      const amount = parseDecimal(currentRow.amount, options.currencyMinorUnits);
      if (previous === null || current === null || amount === null) continue;
      if (Math.abs(previous + amount - current) > options.amountTolerance) {
        issues.push({
          severity: 'ERROR',
          code: 'BANK_BALANCE_CONTINUITY',
          field: 'running_balance',
          rowNumber: index + 1,
          message: `running_balance break: ${previous} + (${amount}) != ${current}`,
        });
      }
    }
  }

  return { issues, normalized };
};

export const validateGeneralLedgerRows = (
  rows: RawGeneralLedgerRow[],
  opts: ValidationOptions = {},
): RowValidationOutcome => {
  const options = { ...DEFAULT_VALIDATION_OPTIONS, ...opts };
  const issues: ValidationIssue[] = [];
  const normalized: NormalizedRecord[] = [];
  const currencies = new Set<string>();
  const today = todayIso();

  const byEntry = new Map<string, { row: RawGeneralLedgerRow; rowNumber: number }[]>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    let hardError = false;
    const err = (code: string, field: string, message: string): void => {
      issues.push({ severity: 'ERROR', code, field, rowNumber, entryId: row.entry_id, message });
      hardError = true;
    };

    if (isBlank(row.entry_id)) {
      err('GL_ENTRY_ID_REQUIRED', 'entry_id', 'entry_id is required');
    }
    if (isBlank(row.line_number)) {
      err('GL_LINE_NO_REQUIRED', 'line_number', 'line_number is required');
    } else if (!/^\d+$/.test(row.line_number.trim()) || Number(row.line_number) < 1) {
      err(
        'GL_LINE_NO_FORMAT',
        'line_number',
        `line_number must be a positive integer: "${row.line_number}"`,
      );
    }

    if (isBlank(row.transaction_date)) {
      err('GL_TXN_DATE_REQUIRED', 'transaction_date', 'transaction_date is required');
    } else if (!isIsoDate(row.transaction_date)) {
      err('GL_TXN_DATE_FORMAT', 'transaction_date', 'transaction_date must be YYYY-MM-DD');
    } else if (options.rejectFutureDates && row.transaction_date > today) {
      err('GL_TXN_DATE_FUTURE', 'transaction_date', `transaction_date is in the future: ${row.transaction_date}`);
    }

    if (!isBlank(row.posting_date)) {
      if (!isIsoDate(row.posting_date!)) {
        err('GL_POSTING_DATE_FORMAT', 'posting_date', 'posting_date must be YYYY-MM-DD');
      } else if (isIsoDate(row.transaction_date) && row.posting_date! < row.transaction_date) {
        issues.push({
          severity: 'WARNING',
          code: 'GL_POSTING_BEFORE_TXN',
          field: 'posting_date',
          rowNumber,
          entryId: row.entry_id,
          message: 'posting_date is before transaction_date',
        });
      }
    }

    if (isBlank(row.account_code)) {
      err('GL_ACCOUNT_REQUIRED', 'account_code', 'account_code is required');
    }
    if (isBlank(row.description)) {
      err('GL_DESCRIPTION_REQUIRED', 'description', 'description is required');
    }

    if (isBlank(row.currency_code)) {
      err('GL_CURRENCY_REQUIRED', 'currency_code', 'currency_code is required');
    } else if (!isIso4217(row.currency_code)) {
      err('GL_CURRENCY_FORMAT', 'currency_code', `currency_code must be ISO 4217: "${row.currency_code}"`);
    } else {
      currencies.add(row.currency_code);
    }

    const debitBlank = isBlank(row.debit_amount);
    const creditBlank = isBlank(row.credit_amount);
    const debit = debitBlank ? 0 : parseDecimal(row.debit_amount!, options.currencyMinorUnits);
    const credit = creditBlank ? 0 : parseDecimal(row.credit_amount!, options.currencyMinorUnits);

    if (!debitBlank && debit === null) {
      err('GL_DEBIT_FORMAT', 'debit_amount', `debit_amount must be a plain decimal: "${row.debit_amount}"`);
    }
    if (!creditBlank && credit === null) {
      err('GL_CREDIT_FORMAT', 'credit_amount', `credit_amount must be a plain decimal: "${row.credit_amount}"`);
    }
    if (debit !== null && debit < 0) {
      err('GL_DEBIT_NEGATIVE', 'debit_amount', 'debit_amount must be non-negative');
    }
    if (credit !== null && credit < 0) {
      err('GL_CREDIT_NEGATIVE', 'credit_amount', 'credit_amount must be non-negative');
    }

    const debitValue = debit ?? 0;
    const creditValue = credit ?? 0;
    if (debitValue === 0 && creditValue === 0) {
      err(
        'GL_NO_AMOUNT',
        'debit_amount',
        'Exactly one of debit_amount or credit_amount must be > 0 (both empty/zero)',
      );
    }
    if (debitValue > 0 && creditValue > 0) {
      err('GL_BOTH_AMOUNTS', 'debit_amount', 'A line cannot have both debit_amount and credit_amount > 0');
    }

    if (!byEntry.has(row.entry_id)) {
      byEntry.set(row.entry_id, []);
    }
    byEntry.get(row.entry_id)!.push({ row, rowNumber });

    if (!hardError && debit !== null && credit !== null) {
      const raw = debitValue - creditValue;
      const signed = options.flipSign ? -raw : raw;
      normalized.push({
        sourceSystem: 'GL',
        recordId: `${row.entry_id}:${row.line_number}`,
        account: row.account_code,
        date: row.transaction_date,
        currencyCode: row.currency_code,
        signedAmount: signed,
        direction: signed >= 0 ? 'INFLOW' : 'OUTFLOW',
        magnitude: Math.abs(signed),
        description: row.description,
        reference: row.reference || undefined,
        sourceLineNumber: rowNumber,
        raw: row,
      });
    }
  });

  if (options.singleCurrency && currencies.size > 1) {
    issues.push({
      severity: 'ERROR',
      code: 'GL_MULTI_CURRENCY',
      message: `File mixes currencies: ${[...currencies].join(', ')}`,
    });
  }

  for (const [entryId, lines] of byEntry) {
    let totalDebit = 0;
    let totalCredit = 0;
    const seenLineNumbers = new Set<string>();
    for (const { row } of lines) {
      const debit = isBlank(row.debit_amount)
        ? 0
        : (parseDecimal(row.debit_amount!, options.currencyMinorUnits) ?? 0);
      const credit = isBlank(row.credit_amount)
        ? 0
        : (parseDecimal(row.credit_amount!, options.currencyMinorUnits) ?? 0);
      totalDebit += debit;
      totalCredit += credit;

      const lineNumber = (row.line_number || '').trim();
      if (lineNumber) {
        if (seenLineNumbers.has(lineNumber)) {
          issues.push({
            severity: 'ERROR',
            code: 'GL_LINE_NO_DUPLICATE',
            field: 'line_number',
            entryId,
            message: `Duplicate line_number ${lineNumber} in entry ${entryId}`,
          });
        }
        seenLineNumbers.add(lineNumber);
      }
    }

    if (Math.abs(totalDebit - totalCredit) > options.amountTolerance) {
      issues.push({
        severity: 'ERROR',
        code: 'GL_UNBALANCED',
        entryId,
        message: `Entry ${entryId} is unbalanced: debits ${totalDebit.toFixed(2)} != credits ${totalCredit.toFixed(2)}`,
      });
    }
  }

  return { issues, normalized };
};
