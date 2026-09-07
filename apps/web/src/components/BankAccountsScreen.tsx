import { useState, type FormEvent } from 'react';

import type { ReconciliationAccount } from '@recon/domain';
import { deriveLastFour, formatAccountLabel } from '@recon/domain';
import { SectionCard } from '@recon/ui';

import { useReconciliationAccounts } from '../hooks/useReconciliationAccounts';
import { registerAccountRequest, updateAccountRequest } from '../lib/api';

/**
 * The bank account registry (A-D1, Issue #338).
 *
 * A statement can only be assigned to an account registered here, so this screen is the front door
 * that replaced the old side door -- previously a bank account came into existence as a side effect
 * of a filename, with the last four digits standing in for identity. Accounts now have a stable id
 * that never appears in the interface; every control here works in labels.
 *
 * Deactivate rather than delete: a deactivated account keeps every statement, run and open item
 * already attributed to it and simply stops being offered for new assignments. Deleting one would
 * orphan history that a reconciliation is supposed to be able to prove.
 */
export function BankAccountsScreen({ canManage }: Readonly<{ canManage: boolean }>) {
  const { accounts, isLoading, error, reload } = useReconciliationAccounts({
    includeInactive: true,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [accountIdentifier, setAccountIdentifier] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [glCashAccountCode, setGlCashAccountCode] = useState('');

  const previewLastFour = deriveLastFour(accountIdentifier);

  const handleRegister = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (accountIdentifier.trim().length === 0) {
      setFormError('An account number is required.');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      await registerAccountRequest({
        accountIdentifier: accountIdentifier.trim(),
        displayName: displayName.trim() || undefined,
        institutionName: institutionName.trim() || undefined,
        glCashAccountCode: glCashAccountCode.trim() || undefined,
      });
      setAccountIdentifier('');
      setDisplayName('');
      setInstitutionName('');
      setGlCashAccountCode('');
      reload();
    } catch (registerError) {
      setFormError(
        registerError instanceof Error ? registerError.message : 'Could not register the account.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (account: ReconciliationAccount): Promise<void> => {
    setFormError(null);
    try {
      await updateAccountRequest(account.id, { isActive: !account.isActive });
      reload();
    } catch (updateError) {
      setFormError(
        updateError instanceof Error ? updateError.message : 'Could not update the account.',
      );
    }
  };

  return (
    <SectionCard
      title="Bank accounts"
      description="Every bank statement is assigned to one of these accounts. Last-four digits and file names help you pick the right one, but they never decide it."
    >
      {error ? (
        <div className="error-banner" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={reload}>
            Try again
          </button>
        </div>
      ) : null}

      {canManage ? (
        <form className="bank-accounts__form" onSubmit={handleRegister}>
          <div className="bank-accounts__field">
            <label htmlFor="account-number-input">Account number</label>
            <input
              id="account-number-input"
              value={accountIdentifier}
              onChange={(event) => setAccountIdentifier(event.target.value)}
              autoComplete="off"
            />
            {previewLastFour ? (
              <p className="bank-accounts__hint">Shown as “ending in {previewLastFour}”.</p>
            ) : null}
          </div>

          <div className="bank-accounts__field">
            <label htmlFor="account-name-input">Name</label>
            <input
              id="account-name-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Operating"
              autoComplete="off"
            />
          </div>

          <div className="bank-accounts__field">
            <label htmlFor="account-institution-input">Institution</label>
            <input
              id="account-institution-input"
              value={institutionName}
              onChange={(event) => setInstitutionName(event.target.value)}
              placeholder="Truist"
              autoComplete="off"
            />
          </div>

          <div className="bank-accounts__field">
            <label htmlFor="account-gl-code-input">GL cash account</label>
            <input
              id="account-gl-code-input"
              value={glCashAccountCode}
              onChange={(event) => setGlCashAccountCode(event.target.value)}
              autoComplete="off"
            />
            {/* A-D2 (Issue #339) declares this binding on the account rather than inferring it.
                Nothing consumes it until matching is partitioned per account pair (Issue #344),
                so it is captured but optional -- an account registered without it still works. */}
            <p className="bank-accounts__hint">
              Optional today. Used once matching is partitioned per account.
            </p>
          </div>

          {formError ? (
            <p className="bank-accounts__error" role="alert">
              {formError}
            </p>
          ) : null}

          <button type="submit" className="primary-button" disabled={isSaving}>
            {isSaving ? 'Registering…' : 'Register account'}
          </button>
        </form>
      ) : null}

      {isLoading ? (
        <p>Loading bank accounts…</p>
      ) : accounts.length === 0 ? (
        <p className="bank-accounts__empty">
          No bank accounts are registered yet.
          {canManage ? ' Register one above to start assigning statements.' : null}
        </p>
      ) : (
        <table className="bank-accounts__table">
          <caption className="sr-only">Registered bank accounts</caption>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Institution</th>
              <th scope="col">GL cash account</th>
              <th scope="col">Status</th>
              {canManage ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <th scope="row">{formatAccountLabel(account)}</th>
                <td>{account.institutionName ?? '—'}</td>
                <td>{account.glCashAccountCode ?? '—'}</td>
                <td>{account.isActive ? 'Active' : 'Deactivated'}</td>
                {canManage ? (
                  <td>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleToggleActive(account)}
                    >
                      {account.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}
