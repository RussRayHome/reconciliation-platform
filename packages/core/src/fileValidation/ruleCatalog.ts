import type { Severity } from './types';

/**
 * Single source of truth for every rule code the File Validation Engine can emit. Mirrors
 * `validation_rule_version` (changeset 0047, deprecated/superseded by the Issue #137 changeset)
 * so the DB catalog can never silently drift from the codes `structuralGates.ts`/
 * `rowValidators.ts` actually produce -- `ruleCatalog.test.ts` asserts both directions of that
 * equivalence.
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
    code: 'BANK_DATE_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Date is required.',
  },
  {
    code: 'BANK_DATE_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Date must be YYYY-MM-DD.',
  },
  {
    code: 'BANK_DATE_FUTURE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Date is in the future.',
  },
  {
    code: 'BANK_DESCRIPTION_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Description is required.',
  },
  {
    code: 'BANK_SEQUENCE_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Sequence Number is required.',
  },
  {
    code: 'BANK_SEQUENCE_DUPLICATE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Sequence Number duplicates another row within the same file.',
  },
  {
    code: 'BANK_DEBIT_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Debit must be a valid amount.',
  },
  {
    code: 'BANK_CREDIT_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Credit must be a valid amount.',
  },
  {
    code: 'BANK_DEBIT_NEGATIVE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Debit must be non-negative.',
  },
  {
    code: 'BANK_CREDIT_NEGATIVE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Credit must be non-negative.',
  },
  {
    code: 'BANK_NO_AMOUNT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Exactly one of Debit or Credit must be greater than 0 (both were empty/zero).',
  },
  {
    code: 'BANK_BOTH_AMOUNTS',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'A row cannot have both Debit and Credit greater than 0.',
  },
  {
    code: 'BANK_BALANCE_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BANK',
    description: 'Balance must be a valid amount.',
  },
  {
    code: 'BANK_BALANCE_CONTINUITY',
    severity: 'ERROR',
    scope: 'CROSS_ROW',
    sourceType: 'BANK',
    description: "Balance does not continue from the prior row's balance plus this row's amount.",
  },

  // ── GL (Step 3, rowValidators.ts validateGeneralLedgerRows) ──────────────────────────────────
  {
    code: 'GL_TXN_DATE_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'Date is required.',
  },
  {
    code: 'GL_TXN_DATE_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'Date must be YYYY-MM-DD.',
  },
  {
    code: 'GL_TXN_DATE_FUTURE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'Date is in the future.',
  },
  {
    code: 'GL_DESCRIPTION_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'Memo is required.',
  },
  {
    code: 'GL_AMOUNT_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'Amount is required and must be a valid signed amount.',
  },
  {
    code: 'GL_AMOUNT_ZERO',
    severity: 'WARNING',
    scope: 'ROW',
    sourceType: 'GL',
    description: 'Amount is zero.',
  },
] as const;
