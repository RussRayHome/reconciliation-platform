import type { Severity } from './types';

/**
 * Single source of truth for every rule code the File Validation Engine can emit. Mirrors
 * `validation_rule_version` (changeset 0047) so the DB catalog can never silently drift from the
 * codes `structuralGates.ts`/`rowValidators.ts` actually produce -- `ruleCatalog.test.ts` asserts
 * both directions of that equivalence. 0047 seeds one row per entry below at version_number 1.
 */

/** Mirrors the older reconciliation_validation_rule_version.scope convention (changeset 0016) --
 * FILE/CROSS_ROW are new to this engine (0016's rules never needed them), SCHEMA covers the
 * Step 1/2 structural gates, ROW covers Step 3 per-field checks. */
export type FileValidationRuleScope = 'SCHEMA' | 'FILE' | 'ROW' | 'CROSS_ROW';

export interface FileValidationRuleDefinition {
  code: string;
  severity: Severity;
  scope: FileValidationRuleScope;
  /** null for STRUCT_* codes, which apply to both formats identically. */
  sourceType: 'BANK' | 'GL' | null;
  description: string;
}

export const FILE_VALIDATION_RULES: readonly FileValidationRuleDefinition[] = [
  // ── STRUCT (Step 1/2 structural gates, structuralGates.ts) ──────────────────────────────────
  {
    code: 'STRUCT_HEADER_MISSING',
    severity: 'ERROR',
    scope: 'SCHEMA',
    sourceType: null,
    description: 'No header row was found, or the first row does not match any expected column name.',
  },
  {
    code: 'STRUCT_COLUMN_MISSING',
    severity: 'ERROR',
    scope: 'SCHEMA',
    sourceType: null,
    description: 'A required column is absent from the file.',
  },
  {
    code: 'STRUCT_COLUMN_ORDER',
    severity: 'ERROR',
    scope: 'SCHEMA',
    sourceType: null,
    description: 'A required column is present but out of order relative to the other required columns.',
  },
  {
    code: 'STRUCT_COLUMN_UNKNOWN',
    severity: 'WARNING',
    scope: 'SCHEMA',
    sourceType: null,
    description: 'An unrecognized column is present and is ignored.',
  },

  // ── BANK (Step 3, rowValidators.ts validateBankingRows) ──────────────────────────────────────
  {
    code: 'BANK_ID_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'transaction_id is required.',
  },
  {
    code: 'BANK_ID_DUPLICATE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'transaction_id duplicates an earlier row in the same file.',
  },
  {
    code: 'BANK_ACCOUNT_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'account_id is required.',
  },
  {
    code: 'BANK_POSTED_DATE_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'posted_date is required.',
  },
  {
    code: 'BANK_POSTED_DATE_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'posted_date must be YYYY-MM-DD.',
  },
  {
    code: 'BANK_POSTED_DATE_FUTURE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'posted_date is in the future.',
  },
  {
    code: 'BANK_TXN_DATE_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'transaction_date must be YYYY-MM-DD.',
  },
  {
    code: 'BANK_TXN_DATE_AFTER_POSTED',
    severity: 'WARNING',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'transaction_date is after posted_date.',
  },
  {
    code: 'BANK_AMOUNT_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'amount must be a plain signed decimal (no symbols/thousands separators).',
  },
  {
    code: 'BANK_AMOUNT_ZERO',
    severity: 'WARNING',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'amount is zero.',
  },
  {
    code: 'BANK_CURRENCY_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'currency_code is required.',
  },
  {
    code: 'BANK_CURRENCY_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'currency_code must be a 3-letter ISO 4217 code.',
  },
  {
    code: 'BANK_TYPE_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'transaction_type is required.',
  },
  {
    code: 'BANK_TYPE_INVALID',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'transaction_type is not a recognized value.',
  },
  {
    code: 'BANK_TYPE_SIGN',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: "amount's sign does not match the inflow/outflow convention for this transaction_type.",
  },
  {
    code: 'BANK_DESCRIPTION_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'description is required.',
  },
  {
    code: 'BANK_CHECK_NUMBER_MISSING',
    severity: 'WARNING',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'check_number is recommended when transaction_type is CHECK.',
  },
  {
    code: 'BANK_BALANCE_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'running_balance must be a plain decimal.',
  },
  {
    code: 'BANK_MULTI_CURRENCY',
    severity: 'ERROR',
    scope: 'FILE',
    sourceType: 'BANK',
    description: 'The file mixes currencies; a single currency is expected.',
  },
  {
    code: 'BANK_BALANCE_CONTINUITY',
    severity: 'ERROR',
    scope: 'CROSS_ROW',
    sourceType: 'BANK',
    description: "running_balance does not continue from the prior row's balance plus this row's amount.",
  },

  // ── GL (Step 3, rowValidators.ts validateGeneralLedgerRows) ──────────────────────────────────
  {
    code: 'GL_ENTRY_ID_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'entry_id is required.',
  },
  {
    code: 'GL_LINE_NO_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'line_number is required.',
  },
  {
    code: 'GL_LINE_NO_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'line_number must be a positive integer.',
  },
  {
    code: 'GL_TXN_DATE_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'transaction_date is required.',
  },
  {
    code: 'GL_TXN_DATE_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'transaction_date must be YYYY-MM-DD.',
  },
  {
    code: 'GL_TXN_DATE_FUTURE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'transaction_date is in the future.',
  },
  {
    code: 'GL_POSTING_DATE_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'posting_date must be YYYY-MM-DD.',
  },
  {
    code: 'GL_POSTING_BEFORE_TXN',
    severity: 'WARNING',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'posting_date is before transaction_date.',
  },
  {
    code: 'GL_ACCOUNT_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'account_code is required.',
  },
  {
    code: 'GL_DESCRIPTION_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'description is required.',
  },
  {
    code: 'GL_CURRENCY_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'currency_code is required.',
  },
  {
    code: 'GL_CURRENCY_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'currency_code must be a 3-letter ISO 4217 code.',
  },
  {
    code: 'GL_DEBIT_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'debit_amount must be a plain decimal.',
  },
  {
    code: 'GL_CREDIT_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'credit_amount must be a plain decimal.',
  },
  {
    code: 'GL_DEBIT_NEGATIVE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'debit_amount must be non-negative.',
  },
  {
    code: 'GL_CREDIT_NEGATIVE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'credit_amount must be non-negative.',
  },
  {
    code: 'GL_NO_AMOUNT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'Exactly one of debit_amount or credit_amount must be greater than 0 (both were empty/zero).',
  },
  {
    code: 'GL_BOTH_AMOUNTS',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'A line cannot have both debit_amount and credit_amount greater than 0.',
  },
  {
    code: 'GL_MULTI_CURRENCY',
    severity: 'ERROR',
    scope: 'FILE',
    sourceType: 'GL',
    description: 'The file mixes currencies; a single currency is expected.',
  },
  {
    code: 'GL_LINE_NO_DUPLICATE',
    severity: 'ERROR',
    scope: 'CROSS_ROW',
    sourceType: 'GL',
    description: 'line_number duplicates another line within the same entry_id.',
  },
  {
    code: 'GL_UNBALANCED',
    severity: 'ERROR',
    scope: 'CROSS_ROW',
    sourceType: 'GL',
    description: "An entry's total debits and credits do not balance within tolerance.",
  },
] as const;
