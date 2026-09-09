import type { AccountAssignmentConflict, ReconciliationAccount } from '@recon/domain';
import { formatAccountLabel, parseBankAccountLast4FromFilename } from '@recon/domain';
import type { PostgresAccountStore } from '@recon/persistence';

/**
 * Statement-to-account assignment (A-D1, Issue #338). Every uploaded bank statement is assigned to
 * a registered account by the operator; this module validates that assignment set before anything
 * is merged or persisted.
 *
 * The filename is consulted only to detect a *disagreement* with what the operator chose. It never
 * selects an account, never overrides an assignment, and its absence is no longer an error -- a
 * bank file may be named anything at all, because the assignment, not the name, is the identity.
 */

/** One upload paired with the account the operator assigned it to. */
export interface BankAccountAssignmentRequest {
  originalFilename: string;
  accountId: string;
  /** The operator's acknowledgement of a previously-reported conflict. */
  confirmed?: boolean;
}

export interface ResolvedBankAccountAssignment {
  originalFilename: string;
  account: ReconciliationAccount;
}

/** A rejection the operator can fix by re-picking, rather than a conflict they can confirm past. */
export class BankAccountAssignmentError extends Error {
  /** @param message What the operator has to change -- a duplicate assignment or a deactivated
   * account. Unlike a conflict, there is nothing here to confirm past. */
  constructor(message: string) {
    super(message);
    this.name = 'BankAccountAssignmentError';
  }
}

/** One or more assignments disagree with their filename and have not been confirmed (A-D1). The
 * caller surfaces these for confirmation or reassignment; it must never resolve them itself. */
export class BankAccountAssignmentConflictError extends Error {
  /** @param conflicts Every disagreement in the set, not just the first: a multi-file upload must
   * be able to prompt per file rather than surfacing them one round trip at a time. */
  constructor(public readonly conflicts: AccountAssignmentConflict[]) {
    super(
      conflicts.length === 1
        ? conflicts[0]!.message
        : `${conflicts.length} bank files disagree with their assigned account.`,
    );
    this.name = 'BankAccountAssignmentConflictError';
  }
}

/**
 * Validates and resolves a run's whole assignment set at once.
 *
 * Whole-set, not file-by-file, for two reasons: an account may be used only once per run, which is
 * only visible across the set; and a partial resolution would let the first files' work happen
 * before a later file turned out to name an account this organization does not own.
 *
 * A-D1's "account information inside the statement contradicts the selected account" case has no
 * analogue here yet -- the bank template carries no account column at all
 * (docs/transaction-csv-spec.md §2), so a statement has nothing with which to contradict its
 * assignment. That check becomes reachable only if the template gains such a column.
 */
export const resolveBankAccountAssignments = async (input: {
  accountStore: PostgresAccountStore;
  organizationId: string;
  requests: readonly BankAccountAssignmentRequest[];
}): Promise<ResolvedBankAccountAssignment[]> => {
  const { accountStore, organizationId, requests } = input;

  const accountIds = requests.map((request) => request.accountId);
  if (new Set(accountIds).size !== accountIds.length) {
    throw new BankAccountAssignmentError(
      'Each bank file must be assigned to a different account -- one account cannot have two statements in the same run.',
    );
  }

  // Throws UnknownReconciliationAccountError for anything this organization does not own, which
  // the route maps to a 404-shaped rejection. RLS already scopes the query; this turns an
  // invisible row into an explicit failure rather than a silently short assignment set.
  const accounts = await accountStore.resolveAccounts(organizationId, accountIds);

  const inactive = requests
    .map((request) => accounts.get(request.accountId)!)
    .filter((account) => !account.isActive);
  if (inactive.length > 0) {
    throw new BankAccountAssignmentError(
      `Cannot assign a statement to the deactivated account "${formatAccountLabel(inactive[0]!)}".`,
    );
  }

  const conflicts: AccountAssignmentConflict[] = [];
  const resolved: ResolvedBankAccountAssignment[] = [];

  for (const request of requests) {
    const account = accounts.get(request.accountId)!;
    const filenameLastFour = parseBankAccountLast4FromFilename(request.originalFilename);
    const label = formatAccountLabel(account);

    // Only an actual disagreement is a conflict. A filename with no leading digits carries no
    // claim about the account, so there is nothing for it to disagree with -- and an account with
    // no derivable last four has nothing to compare against. Neither is an error under A-D1.
    const disagrees =
      filenameLastFour !== null &&
      account.lastFour !== null &&
      filenameLastFour !== account.lastFour;

    if (disagrees && !request.confirmed) {
      conflicts.push({
        kind: 'FILENAME_LAST_FOUR_MISMATCH',
        originalFilename: request.originalFilename,
        accountId: account.id,
        accountLabel: label,
        filenameLastFour,
        message:
          `"${request.originalFilename}" starts with ${filenameLastFour}, but it was assigned to ` +
          `${label}. Confirm the assignment or pick a different account.`,
      });
      continue;
    }

    resolved.push({ originalFilename: request.originalFilename, account });
  }

  if (conflicts.length > 0) {
    throw new BankAccountAssignmentConflictError(conflicts);
  }

  return resolved;
};

/**
 * The accounts a filename could plausibly refer to, for pre-selecting the assignment control.
 *
 * Returns every active account sharing the filename's last four -- deliberately all of them. A-D1
 * forbids choosing the first match automatically, so when this returns more than one entry the
 * caller must leave the choice to the operator rather than treating the first as the answer.
 */
export const suggestAccountsForFilename = async (input: {
  accountStore: PostgresAccountStore;
  organizationId: string;
  originalFilename: string;
}): Promise<{ filenameLastFour: string | null; candidates: ReconciliationAccount[] }> => {
  const filenameLastFour = parseBankAccountLast4FromFilename(input.originalFilename);
  if (filenameLastFour === null) {
    return { filenameLastFour: null, candidates: [] };
  }
  const candidates = await input.accountStore.findByLastFour(
    input.organizationId,
    filenameLastFour,
  );
  return { filenameLastFour, candidates };
};
