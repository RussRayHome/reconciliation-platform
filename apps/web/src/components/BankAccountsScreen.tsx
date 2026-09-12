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

  const activeCount = accounts.filter((account) => account.isActive).length;
  // #405: the PREVIEW row renders formatAccountLabel's REAL output, never a hand-assembled
  // lookalike. It is this screen's promise about how the account will read in slot pickers,
  // exception evidence and the audit workbook -- a preview built from a different string would be
  // a promise the product does not keep. Same rule 5a's preview follows.
  const previewLabel = formatAccountLabel({
    accountIdentifier: accountIdentifier.trim() || '4321',
    displayName: displayName.trim() || 'Operating',
    lastFour: previewLastFour ?? '4321',
  });

  return (
    <div className="registry-screen">
      <header>
        <p className="registry-screen__eyebrow">Configure / Bank accounts</p>
        <h1 className="registry-screen__title">Bank accounts</h1>
        <p className="registry-screen__subtitle">
          Every statement is assigned to an account opened here. File names and last-four digits
          help you pick the right one — they never decide it.
        </p>
      </header>

      {error ? (
        <div className="error-banner" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={reload}>
            Try again
          </button>
        </div>
      ) : null}

      <div className="registry-screen__body">
        <SectionCard
          title="Registered accounts"
          description={`${activeCount} active · ${accounts.length - activeCount} deactivated`}
        >
          {isLoading ? (
            <p>Loading bank accounts…</p>
          ) : accounts.length === 0 ? (
            <p className="registry-screen__empty">
              No bank accounts are registered yet.
              {canManage ? ' Open one to start assigning statements.' : null}
            </p>
          ) : (
            <table className="registry-table">
              <caption className="sr-only">Registered bank accounts</caption>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Institution</th>
                  <th scope="col">GL cash account</th>
                  <th scope="col">Status</th>
                  {canManage ? <th scope="col">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <th scope="row">
                      {/* Name over last-four, not one concatenated label: the design dims a
                          deactivated account's name, which needs the two to be separate elements. */}
                      <span
                        className={
                          account.isActive
                            ? 'registry-table__name'
                            : 'registry-table__name registry-table__name--inactive'
                        }
                      >
                        {account.displayName?.trim() || account.accountIdentifier}
                      </span>
                      {account.lastFour ? (
                        <span className="registry-table__id">ending in {account.lastFour}</span>
                      ) : null}
                    </th>
                    <td>{account.institutionName ?? '—'}</td>
                    <td className={account.glCashAccountCode ? undefined : 'registry-table__unset'}>
                      {account.glCashAccountCode ?? '—'}
                    </td>
                    <td>
                      <span className={account.isActive ? 'badge' : 'badge badge--muted'}>
                        {account.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    {canManage ? (
                      <td>
                        <button
                          type="button"
                          className="secondary-button button-small"
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

          {/* #405 item 3. This rule existed only as a comment on this component and in
              packages/domain/src/reconciliationAccount.ts -- invisible to the person it
              constrains. An operator who cannot find a delete button needs to be told it is
              deliberate, not missing. 5a says the same thing about entities and cites this screen. */}
          <p className="registry-screen__rule">
            Deactivating keeps every statement, run and open item already attributed to the account
            and stops it being offered for new assignments. <strong>There is no delete</strong> — an
            account with history must always be able to prove that history.
          </p>
        </SectionCard>

        {/* Non-admins get the table alone. `registry-screen__body:has(> :only-child)` collapses to
            one column, so the layout does not leave a gap where a control used to be. */}
        {canManage ? (
          <SectionCard title="Open new account">
            <form className="registry-form" onSubmit={(event) => void handleRegister(event)}>
              <label htmlFor="account-number-input">Account number</label>
              <input
                id="account-number-input"
                value={accountIdentifier}
                onChange={(event) => setAccountIdentifier(event.target.value)}
                autoComplete="off"
                placeholder="4321"
              />
              <p className="registry-form__hint">
                Stored once, shown only as &ldquo;ending in 4321&rdquo;. Never used as identity.
              </p>

              <label htmlFor="account-name-input">Name</label>
              <input
                id="account-name-input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="off"
                placeholder="Operating"
              />

              <label htmlFor="account-institution-input">Institution</label>
              <input
                id="account-institution-input"
                value={institutionName}
                onChange={(event) => setInstitutionName(event.target.value)}
                autoComplete="off"
                placeholder="Truist"
              />

              <label htmlFor="account-gl-input">GL cash account</label>
              <input
                id="account-gl-input"
                value={glCashAccountCode}
                onChange={(event) => setGlCashAccountCode(event.target.value)}
                autoComplete="off"
              />
              {/* Issue #339's rationale, kept: optional *today* because nothing consumes it yet,
                  not because it does not matter. */}
              <p className="registry-form__hint">
                Optional today. Used once matching is partitioned per account.
              </p>

              {formError ? (
                <p role="alert" className="registry-screen__error">
                  {formError}
                </p>
              ) : null}

              <button type="submit" className="primary-button" disabled={isSaving}>
                {isSaving ? 'Opening…' : 'Open account'}
              </button>

              <div className="registry-form__preview">
                <span className="registry-form__preview-label">Preview</span>
                <span className="registry-form__preview-value">{previewLabel}</span>
                <p className="registry-form__hint">
                  Exactly how this account reads in slot pickers, exception evidence and the audit
                  workbook.
                </p>
              </div>
            </form>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
