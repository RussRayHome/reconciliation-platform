/**
 * Types ported from the design-handoff bundle's `reference/schema.ts` (the verified reference
 * validator) for the File Validation Engine. Deliberately namespaced away from `@recon/domain` --
 * that package already exports its own `SourceSystem` (`'bank' | 'gl'`, the reconciliation
 * engine's own source tag) and `ValidationResult` (the row/file-level record stored in
 * `reconciliation_validation_result`, the *older* import path's validation table). Both mean
 * something different here, so neither name is reused: source system is inlined as a literal
 * union on `NormalizedRecord` instead of a standalone type, and this module's outcome type is
 * `FileValidationOutcome`, not `ValidationResult`.
 */

/** OFX-aligned transaction types for the banking file (transaction-csv-spec.md §2). */
export const bankTransactionTypes = [
  'CREDIT',
  'DEBIT',
  'DEP',
  'INT',
  'FEE',
  'SRVCHG',
  'ATM',
  'POS',
  'XFER',
  'CHECK',
  'PAYMENT',
  'DIRECTDEP',
  'DIRECTDEBIT',
  'OTHER',
] as const;
export type BankTransactionType = (typeof bankTransactionTypes)[number];

/** Types that must carry a positive (inflow) amount. */
export const INFLOW_TYPES: ReadonlySet<BankTransactionType> = new Set([
  'CREDIT',
  'DEP',
  'INT',
  'DIRECTDEP',
]);

/** Types that must carry a negative (outflow) amount. */
export const OUTFLOW_TYPES: ReadonlySet<BankTransactionType> = new Set([
  'DEBIT',
  'FEE',
  'SRVCHG',
  'ATM',
  'POS',
  'PAYMENT',
  'DIRECTDEBIT',
]);

// Types that may be either sign: XFER, CHECK, OTHER.

/** Expected banking-file header names, in required order (transaction-csv-spec.md §2). */
export const BANKING_HEADERS = [
  'transaction_id',
  'account_id',
  'posted_date',
  'transaction_date',
  'amount',
  'currency_code',
  'transaction_type',
  'description',
  'memo',
  'check_number',
  'reference_number',
  'counterparty_account',
  'running_balance',
] as const;

/** Expected GL-file header names, in required order (transaction-csv-spec.md §3). */
export const GL_HEADERS = [
  'entry_id',
  'line_number',
  'transaction_date',
  'posting_date',
  'account_code',
  'account_name',
  'description',
  'debit_amount',
  'credit_amount',
  'currency_code',
  'reference',
  'entity',
  'department',
  'location',
  'source',
] as const;

/** Required (non-optional) banking columns -- the rest are recommended but not enforced. */
export const REQUIRED_BANKING_HEADERS: readonly string[] = [
  'transaction_id',
  'account_id',
  'posted_date',
  'amount',
  'currency_code',
  'transaction_type',
  'description',
];

/** Required GL columns. debit_amount/credit_amount are jointly required (one of the two, per
 * row -- enforced by GL_NO_AMOUNT/GL_BOTH_AMOUNTS in Step 3, not the structural gate). */
export const REQUIRED_GL_HEADERS: readonly string[] = [
  'entry_id',
  'line_number',
  'transaction_date',
  'account_code',
  'description',
  'currency_code',
];

/** Raw banking row as read from either parser (all values are strings before validation). */
export interface RawBankingRow {
  transaction_id: string;
  account_id: string;
  posted_date: string;
  transaction_date?: string;
  amount: string;
  currency_code: string;
  transaction_type: string;
  description: string;
  memo?: string;
  check_number?: string;
  reference_number?: string;
  counterparty_account?: string;
  running_balance?: string;
}

/** Raw GL row as read from either parser. */
export interface RawGeneralLedgerRow {
  entry_id: string;
  line_number: string;
  transaction_date: string;
  posting_date?: string;
  account_code: string;
  account_name?: string;
  description: string;
  debit_amount?: string;
  credit_amount?: string;
  currency_code: string;
  reference?: string;
  entity?: string;
  department?: string;
  location?: string;
  source?: string;
}

/** Canonical record both formats normalize into -- the reconciliation unit. Mirrors the
 * `normalized_record` table (changeset 0042). */
export interface NormalizedRecord {
  sourceSystem: 'BANK' | 'GL';
  /** Stable id: transaction_id (bank) or `${entry_id}:${line_number}` (GL). */
  recordId: string;
  /** account_id (bank) or account_code (GL). */
  account: string;
  /** ISO 8601 date used for matching (posted_date for bank, transaction_date for GL). */
  date: string;
  currencyCode: string;
  /**
   * Signed amount in the common "cash impact" frame (transaction-csv-spec.md §5):
   *   + increases the account balance, - decreases it.
   * Bank: = amount (bank credits are already +).
   * GL:   = debit_amount - credit_amount (a debit to cash is money in => +).
   * A matched bank line and its GL cash-account line share the SAME sign.
   */
  signedAmount: number;
  direction: 'INFLOW' | 'OUTFLOW';
  /** Absolute magnitude, always >= 0. */
  magnitude: number;
  description: string;
  reference?: string;
  /** Source line number, 1-based, excluding the header row -- preserved for audit. */
  sourceLineNumber: number;
  /** Everything from the source row, preserved for audit (raw JSONB column). */
  raw: RawBankingRow | RawGeneralLedgerRow;
}

export type Severity = 'ERROR' | 'WARNING';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  field?: string;
  /** 1-based data row (excludes header row). Undefined for file-level issues. */
  rowNumber?: number;
  /** GL entry-grouping key, when relevant. */
  entryId?: string;
  message: string;
}

export interface ValidationOptions {
  /** Currency minor units for decimal-places checks (USD = 2). Default 2. */
  currencyMinorUnits?: number;
  /** Require a single currency across the whole file. Default true. */
  singleCurrency?: boolean;
  /** Reject dates after today. Default true. */
  rejectFutureDates?: boolean;
  /** Tolerance for GL entry balancing and running-balance continuity. Default 0.005. */
  amountTolerance?: number;
  /** Flip the sign convention if the reconciliation frame is credit-positive instead of the
   * default cash-impact (debit-positive for GL). Default false. */
  flipSign?: boolean;
}

export const DEFAULT_VALIDATION_OPTIONS: Required<ValidationOptions> = {
  currencyMinorUnits: 2,
  singleCurrency: true,
  rejectFutureDates: true,
  amountTolerance: 0.005,
  flipSign: false,
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
}
