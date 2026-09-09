/**
 * Bank-account identity (A-D1, Issue #338). A registered bank account's identity is its
 * system-generated `reconciliation_account.id` UUID, stable across every statement ever uploaded
 * for it. Last-four digits and filenames are display and suggestion material only: they are not
 * unique -- not even within one organization -- and must never establish identity, select
 * configuration, or override an explicit assignment.
 *
 * Lives in `@recon/domain` rather than `@recon/core` because `apps/web` needs the same label
 * formatting and conflict vocabulary the API uses, and `apps/web` has no dependency on
 * `@recon/core` (same reasoning as `bankAccountFilename.ts`).
 */

/** A bank account registered under an organization -- the only thing a statement may be assigned to. */
export interface ReconciliationAccount {
  /** The account's stable identity. Generated once at registration, reused on every statement. */
  id: string;
  organizationId: string;
  /**
   * The account number as the organization records it. A human-facing value carried for display
   * and reporting -- unique per organization only so the registration UI can refuse an obvious
   * duplicate, never the key anything resolves against.
   */
  accountIdentifier: string;
  /** Friendly name, e.g. `Operating`. Combined with {@link ReconciliationAccount.lastFour} by
   * {@link formatAccountLabel} to produce what the account-selection UI actually shows. */
  displayName: string | null;
  institutionName: string | null;
  /** Last four digits, derived at registration from `accountIdentifier`. Display and assignment-
   * suggestion material; explicitly not assumed unique (A-D1). */
  lastFour: string | null;
  currencyCode: string;
  /**
   * The GL cash account this bank account reconciles against (A-D2, Issue #339). Optional at
   * registration -- captured here so the binding is declared on the account rather than inferred,
   * but nothing consumes it until Track A3 partitions matching.
   */
  glCashAccountCode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields an operator supplies when registering an account. `lastFour` is derived, never supplied. */
export interface RegisterReconciliationAccountInput {
  accountIdentifier: string;
  displayName?: string | null;
  institutionName?: string | null;
  currencyCode?: string;
  glCashAccountCode?: string | null;
}

/** Fields an operator may change afterwards. `accountIdentifier` is deliberately absent: editing it
 * would silently re-point every statement already assigned to this account. Register a new account
 * and deactivate this one instead. */
export interface UpdateReconciliationAccountInput {
  displayName?: string | null;
  institutionName?: string | null;
  currencyCode?: string;
  glCashAccountCode?: string | null;
  isActive?: boolean;
}

/** Digits-only tail used for display and for suggesting an assignment. Returns null when the
 * identifier holds fewer than four digits -- a short or non-numeric identifier is legal, it simply
 * cannot offer a last-four hint. */
export const deriveLastFour = (accountIdentifier: string): string | null => {
  const digits = accountIdentifier.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
};

/**
 * What the account-selection interface displays -- e.g. `Operating — ending in 5703` (A-D1). The
 * UUID stays internal; selecting a label is what assigns its underlying account id.
 *
 * Degrades in the order the operator would want: a named account without a derivable last-four
 * shows its name alone, an unnamed one falls back to the raw identifier, so a label is never empty
 * and never leaks a UUID.
 */
export const formatAccountLabel = (
  account: Pick<ReconciliationAccount, 'accountIdentifier' | 'displayName' | 'lastFour'>,
): string => {
  const name = account.displayName?.trim() || null;
  const tail = account.lastFour ? `ending in ${account.lastFour}` : null;
  if (name && tail) return `${name} — ${tail}`;
  if (name) return name;
  if (tail) return tail;
  return account.accountIdentifier;
};

/**
 * Why an uploaded statement's assignment needs explicit confirmation before the merge proceeds
 * (A-D1 "Filename and statement conflicts"). Never auto-resolved: a filename cannot override an
 * assignment, and the first matching account is never chosen automatically.
 */
export type AccountAssignmentConflictKind =
  /** The filename's leading digits disagree with the assigned account's last four. */
  | 'FILENAME_LAST_FOUR_MISMATCH'
  /** More than one active account shares the assigned account's last four, so a filename hint
   * cannot distinguish them and the operator's explicit choice is the only evidence. */
  | 'AMBIGUOUS_LAST_FOUR';

export interface AccountAssignmentConflict {
  kind: AccountAssignmentConflictKind;
  /** The upload this conflict is about, named so a multi-file upload stays attributable. */
  originalFilename: string;
  /** The account the operator selected. */
  accountId: string;
  accountLabel: string;
  /** Last four parsed from the filename, when there was one. */
  filenameLastFour: string | null;
  message: string;
}
