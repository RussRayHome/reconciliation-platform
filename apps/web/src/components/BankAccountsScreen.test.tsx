import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ReconciliationAccount } from '@recon/domain';
import { formatAccountLabel } from '@recon/domain';

import * as api from '../lib/api';
import { BankAccountsScreen } from './BankAccountsScreen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const account = (over: Partial<ReconciliationAccount> = {}): ReconciliationAccount =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: 'org-1',
    accountIdentifier: '4321',
    displayName: 'Operating',
    institutionName: 'Truist',
    lastFour: '4321',
    currencyCode: 'USD',
    glCashAccountCode: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as ReconciliationAccount;

const renderScreen = async (accounts: ReconciliationAccount[], canManage = true) => {
  vi.spyOn(api, 'listAccountsRequest').mockResolvedValue(accounts);
  render(<BankAccountsScreen canManage={canManage} />);
  // The hook fetches on mount; wait for the table rather than asserting through the loading state.
  if (accounts.length > 0) {
    await screen.findByText('Operating');
  }
};

describe('BankAccountsScreen (3a)', () => {
  // A-D1's central rule. It lived only in code comments before #405 -- invisible to the operator
  // it constrains, who would look for a delete button, fail to find one, and read that as a bug.
  it('states the deactivate-not-delete rule on the screen, not just in the API', async () => {
    await renderScreen([account()]);

    expect(screen.getByText(/There is no delete/)).toBeInTheDocument();
    expect(screen.getByText(/keeps every statement, run and open item/)).toBeInTheDocument();
  });

  it('offers no delete affordance anywhere', async () => {
    await renderScreen([account(), account({ id: 'b', displayName: 'Payroll', isActive: false })]);

    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(buttons.filter((label) => /delete|remove/i.test(label))).toEqual([]);
  });

  it('offers Deactivate for an active account and Reactivate for a deactivated one', async () => {
    await renderScreen([
      account(),
      account({ id: 'b', displayName: 'Payroll', lastFour: '8890', isActive: false }),
    ]);

    const active = screen.getByRole('row', { name: /Operating/ });
    const inactive = screen.getByRole('row', { name: /Payroll/ });
    expect(within(active).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(within(inactive).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('shows the last four beneath the name, never the stable id', async () => {
    await renderScreen([account()]);

    const row = screen.getByRole('row', { name: /Operating/ });
    expect(within(row).getByText('ending in 4321')).toBeInTheDocument();
    // A-D1: the UUID is internal and must never reach the interface.
    expect(row.textContent).not.toContain('11111111-1111-4111-8111-111111111111');
  });

  // #405's done-when, worded exactly: "the preview string equals formatAccountLabel(account)".
  // A preview assembled by hand would be a promise about other screens that this one cannot keep.
  it('previews the real formatter output as the operator types', async () => {
    const user = userEvent.setup();
    await renderScreen([]);

    await user.type(screen.getByLabelText('Account number'), '9988');
    await user.type(screen.getByLabelText('Name'), 'Payroll');

    await waitFor(() => {
      expect(screen.getByText(formatAccountLabel({
        accountIdentifier: '9988',
        displayName: 'Payroll',
        lastFour: '9988',
      }))).toBeInTheDocument();
    });
  });

  it('keeps the Issue #339 rationale on the optional GL field', async () => {
    await renderScreen([]);

    expect(
      screen.getByText('Optional today. Used once matching is partitioned per account.'),
    ).toBeInTheDocument();
  });

  // [OBJECT] rule 27's "not available" case: a non-admin cannot open an account by any sequence of
  // actions, so the control is REMOVED rather than rendered disabled. Same treatment as 5a's 13c.
  it('removes the open-account panel and row actions for a non-admin', async () => {
    await renderScreen([account()], false);

    expect(screen.queryByRole('heading', { name: 'Open new account' })).toBeNull();
    expect(screen.queryByLabelText('Account number')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull();
    // The registry itself still reads -- every role needs account labels to interpret a run.
    expect(screen.getByText('Operating')).toBeInTheDocument();
  });

  it('counts active and deactivated accounts in the card header', async () => {
    await renderScreen([
      account(),
      account({ id: 'b', displayName: 'Payroll', lastFour: '8890', isActive: false }),
    ]);

    expect(screen.getByText('1 active · 1 deactivated')).toBeInTheDocument();
  });
});
