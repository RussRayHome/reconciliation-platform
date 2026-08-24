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
  /** null for STRUCT_* codes, which apply to every format identically. */
  sourceType: 'BANK' | 'GL' | 'BILLING' | null;
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

  // ── BILLING (Step 3, rowValidators.ts validateBillingRows) ───────────────────────────────────
  {
    code: 'AP_ENTITY_ID_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Entity Id is required.',
  },
  {
    code: 'AP_ENTITY_MISMATCH',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: "Entity Id does not match this file's entity -- one AP ledger slot holds exactly one entity.",
  },
  {
    code: 'AP_VENDOR_ID_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Vendor Id is required.',
  },
  {
    code: 'AP_DOC_NO_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Doc No is required.',
  },
  {
    code: 'AP_DOC_NO_DUPLICATE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Doc No duplicates another row within the same file.',
  },
  {
    code: 'AP_DOC_DATE_REQUIRED',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Doc Date is required.',
  },
  {
    code: 'AP_DOC_DATE_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Doc Date must be YYYY-MM-DD.',
  },
  {
    code: 'AP_DOC_DATE_FUTURE',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Doc Date is in the future.',
  },
  {
    code: 'AP_DUE_DATE_MISSING',
    severity: 'WARNING',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Due Date is missing; the row will be unbandable for aging.',
  },
  {
    code: 'AP_DUE_DATE_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Due Date must be YYYY-MM-DD.',
  },
  {
    code: 'AP_AMOUNT_FORMAT',
    severity: 'ERROR',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Amount is required and must be a valid signed amount.',
  },
  {
    code: 'AP_AMOUNT_ZERO',
    severity: 'WARNING',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Amount is zero.',
  },
  {
    code: 'AP_DOC_TYPE_UNRECOGNIZED',
    severity: 'WARNING',
    scope: 'ROW',
    sourceType: 'BILLING',
    description: 'Doc Type is not one of the recognized values (Bill, Payment, Credit Memo).',
  },
  {
    code: 'AP_APPLIED_DOC_UNKNOWN',
    severity: 'WARNING',
    scope: 'CROSS_ROW',
    sourceType: 'BILLING',
    description: 'Applied To Doc No does not match any Doc No in this file.',
  },
] as const;
