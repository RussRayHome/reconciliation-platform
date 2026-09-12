import type { ReconciliationAccount } from '@recon/domain';
import { formatAccountLabel, parseBankAccountLast4FromFilename } from '@recon/domain';

import { Link } from 'react-router';

import { candidatesForFilename } from '../lib/bankAccountSuggestion';
import { routePaths } from '../routes/routePaths';

/**
 * The account-selection control for one uploaded bank statement (A-D1, Issue #338).
 *
 * Shows friendly labels only -- "Operating — ending in 5703" -- and keeps the account UUID
 * internal, which is what the decision requires of every account-selection interface. The filename
 * is used for exactly one thing: telling the operator when their choice and the file's name
 * disagree. It never selects on their behalf when the answer is ambiguous.
 */

interface BankAccountAssignmentProps {
  /** The staged file this assignment is for; null while the slot is empty. */
  file: File | null;
  accounts: readonly ReconciliationAccount[];
  accountId: string | null;
  onChange: (accountId: string | null) => void;
  /** Ties the control to its slot for `htmlFor`/`aria` and for Playwright selectors. */
  controlId: string;
  accountsUnavailable?: boolean;
}

export function BankAccountAssignment({
  file,
  accounts,
  accountId,
  onChange,
  controlId,
  accountsUnavailable = false,
}: Readonly<BankAccountAssignmentProps>) {
  if (!file) {
    return null;
  }

  const selected = accounts.find((account) => account.id === accountId) ?? null;
  const filenameLastFour = parseBankAccountLast4FromFilename(file.name);
  const ambiguous = candidatesForFilename(file.name, accounts).length > 1;

  // Only a real disagreement is worth a warning. A filename with no leading digits makes no claim
  // about the account, and an account with no derivable last four has nothing to compare -- the
  // server applies the same three-way test before it will reject the upload.
  const disagrees =
    selected !== null &&
    filenameLastFour !== null &&
    selected.lastFour !== null &&
    filenameLastFour !== selected.lastFour;

  return (
    <div className="source-slot__account">
      <label htmlFor={controlId}>Bank account</label>
      <select
        id={controlId}
        value={accountId ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        aria-describedby={disagrees ? `${controlId}-conflict` : undefined}
      >
        <option value="">Select an account…</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {formatAccountLabel(account)}
          </option>
        ))}
      </select>

      {accountsUnavailable ? (
        <p className="source-slot__account-hint">
          Bank accounts couldn&apos;t be loaded, so this statement can&apos;t be assigned yet.
        </p>
      ) : accounts.length === 0 ? (
        /* #392 decision 1. The hint was accurate and still a dead end: it said a run needs a
           registered account without saying where to register one, and a fresh organization meets
           it before it has done anything else -- changeset 0059's backfill is a migration-time
           snapshot, so an organization created after it starts with none.

           Safe to show unconditionally: `canManageAccounts` tracks `canSubmitImportRuns` exactly
           (packages/domain/src/enums.ts), so anyone who can reach this control -- it only renders
           on the submit path -- can also register the account it points at. */
        <p className="source-slot__account-hint">
          No bank accounts are registered yet.{' '}
          <Link className="source-slot__account-hint-link" to={routePaths.bankAccounts}>
            Register one
          </Link>{' '}
          before submitting a run.
        </p>
      ) : null}

      {accountId === null && ambiguous ? (
        <p className="source-slot__account-hint">
          More than one account ends in {filenameLastFour}. Pick the right one — we won&apos;t
          guess.
        </p>
      ) : null}

      {disagrees ? (
        <p className="source-slot__account-conflict" id={`${controlId}-conflict`} role="status">
          This file&apos;s name starts with {filenameLastFour}, but you assigned it to{' '}
          <strong>{formatAccountLabel(selected)}</strong>. You&apos;ll be asked to confirm before
          the run is created.
        </p>
      ) : null}
    </div>
  );
}
