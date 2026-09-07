/**
 * Types for the File Validation Engine, validating against the canonical schema in
 * `docs/transaction-csv-spec.md` (Issue #137) -- the same human-readable headers the app's
 * downloadable Bank/GL templates ship, not an invented parallel schema. Deliberately namespaced
 * away from `@recon/domain` -- that package already exports its own `SourceSystem`
 * (`'bank' | 'gl'`, the reconciliation engine's own source tag) and `ValidationResult` (the
 * row/file-level record stored in `reconciliation_validation_result`, the *older* import path's
 * validation table). Both mean something different here, so neither name is reused: source system
 * is inlined as a literal union on `NormalizedRecord` instead of a standalone type, and this
 * module's outcome type is `FileValidationOutcome`, not `ValidationResult`.
 */

/** Expected banking-file header names, in required order (transaction-csv-spec.md §2). */
export const BANKING_HEADERS = [
  'Date',
  'Description',
  'Sequence Number',
  'Check Number',
  'Reference',
  'Debit',
  'Credit',
  'Balance',
] as const;

/** Expected GL-file header names, in required order (transaction-csv-spec.md §3). */
export const GL_HEADERS = ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'] as const;

/** The account-identity column `mergeBankFiles` writes onto every merged bank row (A-D1, Issue
 * #338). Carries the confirmed `reconciliation_account.id` UUID -- it is not a second account
 * identifier, and it is never something an operator fills in by hand. */
export const INTERFACE_ID_HEADER = 'Interface ID';

/**
 * Headers of the MERGED bank dataset, as distinct from {@link BANKING_HEADERS}, which stays the
 * contract for a raw per-account upload and for the downloadable template. Only the merged file
 * reaches `validateFile` (raw files are structurally checked inside `mergeBankFiles` and never
 * validated on their own), so recognising `Interface ID` here -- rather than adding it to
 * `BANKING_HEADERS` -- keeps it out of the template without it being warned as an unknown column.
 */
export const MERGED_BANKING_HEADERS = [...BANKING_HEADERS, INTERFACE_ID_HEADER] as const;

/** Required (non-optional) banking columns. Debit/Credit are jointly required (one of the two,
 * per row -- enforced by BANK_NO_AMOUNT/BANK_BOTH_AMOUNTS in Step 3, not the structural gate). */
export const REQUIRED_BANKING_HEADERS: readonly string[] = ['Date', 'Description', 'Sequence Number'];

/** Required GL columns. */
export const REQUIRED_GL_HEADERS: readonly string[] = ['Date', 'Memo', 'Amount'];

/** Expected AP/Billing subledger header names, in required order (R1 work plan WP0.1). */
export const BILLING_HEADERS = [
  'Entity Id',
  'Vendor Id',
  'Vendor Name',
  'Doc Type',
  'Doc No',
  'Doc Date',
  'Due Date',
  'Amount',
  'Currency',
  'GL Account',
  'Applied To Doc No',
  'Status',
] as const;

/** Required AP/Billing columns -- the identity + amount backbone. Due Date is deliberately NOT
 * required here: a row missing it is still importable (flagged AP_DUE_DATE_MISSING and left
 * unbandable for aging), matching Bank's own Debit/Credit split between structural presence and
 * per-row content enforcement. */
export const REQUIRED_BILLING_HEADERS: readonly string[] = [
  'Entity Id',
  'Vendor Id',
  'Doc No',
  'Doc Date',
  'Amount',
];

/** Raw banking row as read from either parser (all values are strings before validation). */
export interface RawBankingRow {
  Date: string;
  Description: string;
  'Sequence Number': string;
  'Check Number'?: string;
  Reference?: string;
  Debit?: string;
  Credit?: string;
  Balance?: string;
  /** Present only on a merged bank dataset -- see {@link INTERFACE_ID_HEADER}. */
  'Interface ID'?: string;
}

/** Raw GL row as read from either parser. */
export interface RawGeneralLedgerRow {
  Date: string;
  Type?: string;
  Num?: string;
  Name?: string;
  Memo: string;
  Amount: string;
}

/** Raw AP/Billing subledger row as read from either parser. */
export interface RawApBillingRow {
  'Entity Id': string;
  'Vendor Id': string;
  'Vendor Name'?: string;
  'Doc Type'?: string;
  'Doc No': string;
  'Doc Date': string;
  'Due Date'?: string;
  Amount: string;
  Currency?: string;
  'GL Account'?: string;
  'Applied To Doc No'?: string;
  Status?: string;
}

/** Canonical record both formats normalize into -- the reconciliation unit. Mirrors the
 * `canonical_record` table (changesets 0042/0046). Note: this TypeScript type keeps the
 * `NormalizedRecord`/`sourceSystem: 'BANK'|'GL'` shape unchanged -- the mapping onto
 * `canonical_record`'s wider envelope (`source_type`, `counterparty_*`, `reference_ids`,
 * `evidence`) happens at the persistence boundary, not here. */
export interface NormalizedRecord {
  sourceSystem: 'BANK' | 'GL' | 'BILLING';
  /** Stable id: Sequence Number (bank), unique within its own file. GL rows have no equivalent
   * input column -- `import_file_id` + `sourceLineNumber` already uniquely identifies a GL row
   * (transaction-csv-spec.md §5), so GL's recordId is a file-scoped position marker, not a
   * user-provided value. */
  recordId: string;
  /**
   * The confirmed `reconciliation_account.id` UUID this row belongs to (A-D1, Issue #338/#342).
   * Bank rows carry it in the merged dataset's {@link INTERFACE_ID_HEADER} column, written by
   * `mergeBankFiles` from the account the operator explicitly assigned the statement to. Still
   * optional: GL and Billing have no account column of their own (transaction-csv-spec.md §3),
   * and a bank file validated outside the merge path has no assignment context.
   *
   * Deliberately NOT derived from the filename or the last four digits -- neither establishes
   * identity, and neither is unique even within one organization.
   */
  account?: string;
  /** ISO 8601 date used for matching. */
  date: string;
  /**
   * Signed amount, cash-impact frame: + increases the account balance, - decreases it.
   * Bank: credit column populated => +credit; otherwise -debit.
   * GL:   the Amount column directly -- already in the same sign convention as Bank, no flip.
   * A matched bank line and its GL counterpart share the SAME sign.
   */
  signedAmount: number;
  direction: 'INFLOW' | 'OUTFLOW';
  /** Absolute magnitude, always >= 0. */
  magnitude: number;
  description: string;
  /** GL's Type column verbatim (e.g. "Journal Entry", "Check", "Deposit") -- the Matching
   * Engine's transaction-kind inference (check/journal/transfer/deposit heuristics,
   * `exceptionClassifierUtils.ts`'s `inferTransactionKind`) reads this, so it must carry the
   * real column text, not a derived label. Bank has no Type column at all; left undefined there
   * -- the adapter falls back to a credit/debit label only for Bank, never overriding GL's real
   * value. */
  transactionType?: string;
  /** Bank only. */
  checkNumber?: string;
  /** Bank's Reference column, or GL's Num column. */
  referenceNumber?: string;
  /** GL's Name column. */
  payeeName?: string;
  /** Bank's Balance column, used only for the running-balance continuity check. */
  runningBalance?: number;
  /** Source line number, 1-based, excluding the header row -- preserved for audit. */
  sourceLineNumber: number;
  /** Everything from the source row, preserved for audit (raw JSONB column). */
  raw: RawBankingRow | RawGeneralLedgerRow | RawApBillingRow;
  /** This row's own Step 3 validation issues (ERROR and WARNING), carried through even though the
   * row is still normalized -- nothing is excluded from the reconciliation pipeline on a content
   * issue any more (only a structural gate-1/2 failure excludes rows, by aborting the whole file).
   * `toNormalizedTransactions.ts` maps this into `NormalizedTransaction.dataQualityIssues` so a
   * flagged row still surfaces as a reviewable exception instead of vanishing. Always present,
   * possibly empty -- not optional, so every construction site must account for it. */
  issues: ValidationIssue[];
}

export type Severity = 'ERROR' | 'WARNING';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  field?: string;
  /** 1-based data row (excludes header row). Undefined for file-level issues. */
  rowNumber?: number;
  message: string;
}

export interface ValidationOptions {
  /** Reject dates after today. Default true. */
  rejectFutureDates?: boolean;
  /** Tolerance for Bank's running-balance continuity check. Default 0.005. */
  amountTolerance?: number;
}

export const DEFAULT_VALIDATION_OPTIONS: Required<ValidationOptions> = {
  rejectFutureDates: true,
  amountTolerance: 0.005,
};

/** Which of the three ordered gates (transaction-csv-spec.md §4) ran before the engine stopped --
 * a gate failure stops further checks for that file, so this is always a prefix of the full
 * ['HEADER', 'COLUMN_ORDER', 'CELL_VALUES'] sequence. */
export type FileValidationGate = 'HEADER' | 'COLUMN_ORDER' | 'CELL_VALUES';

/** Result of running the full ordered engine against one file. */
export interface FileValidationOutcome {
  /** True when there are zero ERROR-severity issues across every gate that ran. */
  ok: boolean;
  gatesRun: FileValidationGate[];
  issues: ValidationIssue[];
  /** Rows that passed Step 3's per-row hard validation. Empty unless CELL_VALUES ran. */
  normalized: NormalizedRecord[];
  /** Data rows the parser found, excluding the header row -- always populated, even when a
   * structural gate stops the engine before Step 3 runs, since the parser already read every row
   * before Step 1 checks it. Callers (import_file.row_count) use this rather than
   * normalized.length, which only counts rows that individually passed Step 3. */
  totalRowCount: number;
}
