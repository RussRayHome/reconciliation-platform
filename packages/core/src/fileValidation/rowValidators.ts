import { isBlank, isIsoDate, parseAmount, todayIso } from './primitives';
import {
  DEFAULT_VALIDATION_OPTIONS,
  type NormalizedRecord,
  type RawBankingRow,
  type RawGeneralLedgerRow,
  type ValidationIssue,
  type ValidationOptions,
} from './types';

/**
 * Step 3 of the ordered engine (transaction-csv-spec.md §4.1-§4.4): per-field, file-level, and
 * cross-row rules for the canonical Bank/GL schema.
 */

export interface RowValidationOutcome {
  issues: ValidationIssue[];
  normalized: NormalizedRecord[];
}

/** Fires once per validation issue, for a caller that wants DEBUG-level fault-finding detail
 * (apps/api's importValidationService) without this module depending on a logger itself. */
export type RowIssueObserver = (issue: ValidationIssue) => void;

export const validateBankingRows = (
  rows: RawBankingRow[],
  opts: ValidationOptions = {},
  onIssue?: RowIssueObserver,
): RowValidationOutcome => {
  const options = { ...DEFAULT_VALIDATION_OPTIONS, ...opts };
  const issues: ValidationIssue[] = [];
  const normalized: NormalizedRecord[] = [];
  const seenSequenceNumbers = new Set<string>();
  const today = todayIso();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const rowIssues: ValidationIssue[] = [];
    const err = (code: string, field: string, message: string): void => {
      const issue: ValidationIssue = { severity: 'ERROR', code, field, rowNumber, message };
      issues.push(issue);
      rowIssues.push(issue);
      onIssue?.(issue);
    };

    if (isBlank(row.Date)) {
      err('BANK_DATE_REQUIRED', 'Date', 'Date is required');
    } else if (!isIsoDate(row.Date)) {
      err('BANK_DATE_FORMAT', 'Date', `Date must be YYYY-MM-DD, got "${row.Date}"`);
    } else if (options.rejectFutureDates && row.Date > today) {
      err('BANK_DATE_FUTURE', 'Date', `Date is in the future: ${row.Date}`);
    }

    if (isBlank(row.Description)) {
      err('BANK_DESCRIPTION_REQUIRED', 'Description', 'Description is required');
    }

    const sequenceNumber = row['Sequence Number'];
    if (isBlank(sequenceNumber)) {
      err('BANK_SEQUENCE_REQUIRED', 'Sequence Number', 'Sequence Number is required');
    } else if (seenSequenceNumbers.has(sequenceNumber)) {
      err(
        'BANK_SEQUENCE_DUPLICATE',
        'Sequence Number',
        `Duplicate Sequence Number "${sequenceNumber}" within this file`,
      );
    } else {
      seenSequenceNumbers.add(sequenceNumber);
    }

    const debitBlank = isBlank(row.Debit);
    const creditBlank = isBlank(row.Credit);
    const debit = debitBlank ? 0 : parseAmount(row.Debit);
    const credit = creditBlank ? 0 : parseAmount(row.Credit);

    if (!debitBlank && debit === null) {
      err('BANK_DEBIT_FORMAT', 'Debit', `Debit must be a valid amount: "${row.Debit}"`);
    }
    if (!creditBlank && credit === null) {
      err('BANK_CREDIT_FORMAT', 'Credit', `Credit must be a valid amount: "${row.Credit}"`);
    }
    if (debit !== null && debit < 0) {
      err('BANK_DEBIT_NEGATIVE', 'Debit', 'Debit must be non-negative');
    }
    if (credit !== null && credit < 0) {
      err('BANK_CREDIT_NEGATIVE', 'Credit', 'Credit must be non-negative');
    }

    const debitValue = debit ?? 0;
    const creditValue = credit ?? 0;
    if (debitValue === 0 && creditValue === 0) {
      err('BANK_NO_AMOUNT', 'Debit', 'Exactly one of Debit or Credit must be > 0 (both empty/zero)');
    }
    if (debitValue > 0 && creditValue > 0) {
      err('BANK_BOTH_AMOUNTS', 'Debit', 'A row cannot have both Debit and Credit > 0');
    }

    let runningBalance: number | undefined;
    if (!isBlank(row.Balance)) {
      const parsedBalance = parseAmount(row.Balance);
      if (parsedBalance === null) {
        err('BANK_BALANCE_FORMAT', 'Balance', `Balance must be a valid amount: "${row.Balance}"`);
      } else {
        runningBalance = parsedBalance;
      }
    }

    // Every row is kept, regardless of ERROR/WARNING issues -- nothing is silently dropped from
    // the reconciliation pipeline. A row with an unrecoverable content issue (bad date, both
    // amounts blank, etc.) still becomes a NormalizedRecord using best-effort fallback values for
    // whichever fields failed to parse; its issues travel with it via `issues` so it surfaces as a
    // flagged/reviewable transaction downstream instead of vanishing (see toNormalizedTransactions.ts).
    const signed = creditValue > 0 ? creditValue : -debitValue;
    normalized.push({
      sourceSystem: 'BANK',
      recordId: isBlank(sequenceNumber) ? `row-${rowNumber}` : sequenceNumber,
      date: row.Date,
      signedAmount: signed,
      direction: signed >= 0 ? 'INFLOW' : 'OUTFLOW',
      magnitude: Math.abs(signed),
      description: row.Description,
      checkNumber: row['Check Number'] || undefined,
      referenceNumber: row.Reference || undefined,
      runningBalance,
      sourceLineNumber: rowNumber,
      raw: row,
      issues: rowIssues,
    });
  });

  const allHaveBalance = rows.length > 0 && rows.every((row) => !isBlank(row.Balance));
  if (allHaveBalance) {
    for (let index = 1; index < rows.length; index += 1) {
      const previousRow = rows[index - 1]!;
      const currentRow = rows[index]!;
      const previous = parseAmount(previousRow.Balance);
      const current = parseAmount(currentRow.Balance);
      const debit = isBlank(currentRow.Debit) ? 0 : (parseAmount(currentRow.Debit) ?? 0);
      const credit = isBlank(currentRow.Credit) ? 0 : (parseAmount(currentRow.Credit) ?? 0);
      if (previous === null || current === null) continue;
      const rowSigned = credit > 0 ? credit : -debit;
      if (Math.abs(previous + rowSigned - current) > options.amountTolerance) {
        const issue: ValidationIssue = {
          severity: 'ERROR',
          code: 'BANK_BALANCE_CONTINUITY',
          field: 'Balance',
          rowNumber: index + 1,
          message: `Balance break: ${previous} + (${rowSigned}) != ${current}`,
        };
        issues.push(issue);
        onIssue?.(issue);
      }
    }
  }

  return { issues, normalized };
};

export const validateGeneralLedgerRows = (
  rows: RawGeneralLedgerRow[],
  opts: ValidationOptions = {},
  onIssue?: RowIssueObserver,
): RowValidationOutcome => {
  const options = { ...DEFAULT_VALIDATION_OPTIONS, ...opts };
  const issues: ValidationIssue[] = [];
  const normalized: NormalizedRecord[] = [];
  const today = todayIso();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const rowIssues: ValidationIssue[] = [];
    const err = (code: string, field: string, message: string): void => {
      const issue: ValidationIssue = { severity: 'ERROR', code, field, rowNumber, message };
      issues.push(issue);
      rowIssues.push(issue);
      onIssue?.(issue);
    };
    const warn = (code: string, field: string, message: string): void => {
      const issue: ValidationIssue = { severity: 'WARNING', code, field, rowNumber, message };
      issues.push(issue);
      rowIssues.push(issue);
      onIssue?.(issue);
    };

    if (isBlank(row.Date)) {
      err('GL_TXN_DATE_REQUIRED', 'Date', 'Date is required');
    } else if (!isIsoDate(row.Date)) {
      err('GL_TXN_DATE_FORMAT', 'Date', 'Date must be YYYY-MM-DD');
    } else if (options.rejectFutureDates && row.Date > today) {
      err('GL_TXN_DATE_FUTURE', 'Date', `Date is in the future: ${row.Date}`);
    }

    if (isBlank(row.Memo)) {
      err('GL_DESCRIPTION_REQUIRED', 'Memo', 'Memo is required');
    }

    const amount = isBlank(row.Amount) ? null : parseAmount(row.Amount);
    if (isBlank(row.Amount)) {
      err('GL_AMOUNT_FORMAT', 'Amount', 'Amount is required');
    } else if (amount === null) {
      err('GL_AMOUNT_FORMAT', 'Amount', `Amount must be a valid signed amount: "${row.Amount}"`);
    } else if (amount === 0) {
      warn('GL_AMOUNT_ZERO', 'Amount', 'Amount is zero');
    }

    // Every row is kept, regardless of ERROR/WARNING issues -- nothing is silently dropped from
    // the reconciliation pipeline. A row whose Amount couldn't be parsed still becomes a
    // NormalizedRecord with signedAmount 0; its issues travel with it via `issues` so it surfaces
    // as a flagged/reviewable transaction downstream instead of vanishing.
    const signedAmount = amount ?? 0;
    normalized.push({
      sourceSystem: 'GL',
      recordId: String(rowNumber),
      date: row.Date,
      signedAmount,
      direction: signedAmount >= 0 ? 'INFLOW' : 'OUTFLOW',
      magnitude: Math.abs(signedAmount),
      description: row.Memo,
      transactionType: row.Type || undefined,
      referenceNumber: row.Num || undefined,
      payeeName: row.Name || undefined,
      sourceLineNumber: rowNumber,
      raw: row,
      issues: rowIssues,
    });
  });

  return { issues, normalized };
};
