// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import {
  AccountBillingScreen,
  AccountNotificationScreen,
  AccountPreferencesScreen,
  AccountProfileScreen,
  AccountSecurityScreen,
} from './AccountScreens';
import { routePaths } from '../routes/routePaths';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const at = (path: string, node: React.ReactNode) =>
  render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);

describe('AccountProfileScreen (12a, #451)', () => {
  const renderProfile = (over: Partial<Parameters<typeof AccountProfileScreen>[0]> = {}) =>
    at(
      routePaths.accountProfile,
      <AccountProfileScreen
        username="rray"
        roleLabel="Controller"
        displayName="Russ Ray"
        identityVerificationStatus="verified"
        entityVerificationStatus="pending"
        {...over}
      />,
    );

  it('shows who you are signed in as, from the live session', () => {
    renderProfile();

    expect(screen.getByText('rray')).toBeInTheDocument();
    expect(screen.getByText('Controller')).toBeInTheDocument();
    expect(screen.getByText('Russ Ray')).toBeInTheDocument();
  });

  // `failed` is a real third state. Collapsing it into "Pending" would tell someone to wait when
  // the check has already finished and gone against them.
  it('distinguishes a failed entity check from one still pending', () => {
    renderProfile({ entityVerificationStatus: 'failed' });
    expect(screen.getByText('Failed')).toBeInTheDocument();

    cleanup();
    renderProfile({ entityVerificationStatus: 'pending' });
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  // A-D1: internal ids never reach the interface. The session carries only the organization's
  // UUID, so the organization is deliberately not shown rather than shown as a UUID.
  it('never renders an organization id', () => {
    const { container } = renderProfile();

    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(screen.queryByText(/Organization/i)).toBeNull();
  });

  it('explains that name and role are administrator-set rather than offering a dead edit control', () => {
    renderProfile();

    expect(screen.getByText(/set by an administrator/)).toBeInTheDocument();
    // queryAllByRole, not getAllByRole: there are no buttons at all here, which is the assertion --
    // the get form throws on an empty match and would fail for the right reason with the wrong error.
    expect(
      screen.queryAllByRole('button').filter((b) => /edit|save|change/i.test(b.textContent ?? '')),
    ).toEqual([]);
  });
});

describe('AccountPreferencesScreen (12c, #451)', () => {
  it('offers the two preferences that genuinely exist, and persists a change', async () => {
    const user = userEvent.setup();
    at(routePaths.accountPreferences, <AccountPreferencesScreen username="rray" />);

    await user.selectOptions(screen.getByLabelText('Table density'), 'compact');
    expect(screen.getByLabelText('Table density')).toHaveValue('compact');

    await user.selectOptions(screen.getByLabelText('Aging threshold'), '60');
    expect(screen.getByLabelText('Aging threshold')).toHaveValue('60');
  });

  // Both are display lenses -- they never rewrite a stored figure. Saying so on screen matters
  // because a threshold that looked like it re-aged the data would be a reason not to touch it.
  it('says outright that these change display only', () => {
    at(routePaths.accountPreferences, <AccountPreferencesScreen username="rray" />);

    expect(screen.getByText(/Affects display only/)).toBeInTheDocument();
    expect(screen.getByText(/never changes a recorded age/)).toBeInTheDocument();
  });
});

/**
 * The three screens whose capability does not exist. Each names what is missing rather than
 * offering a control that would not work — an operator learns whether to wait, ask, or work
 * around it, which "coming soon" never tells them.
 */
describe('the account screens whose capability is not built (#451)', () => {
  it('Security names the three things that do not exist, and offers no dead controls', () => {
    at(routePaths.accountSecurity, <AccountSecurityScreen />);

    expect(screen.getByText(/multi-factor authentication is not available/)).toBeInTheDocument();
    expect(screen.getByText(/Passwords are set by an administrator/)).toBeInTheDocument();
    expect(screen.getByText(/sign-in history is recorded but not yet shown/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('Notifications says nothing sends yet, rather than collecting settings nothing reads', () => {
    at(routePaths.accountNotification, <AccountNotificationScreen />);

    expect(screen.getByText(/does not send notifications yet/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  // 12b is design-only by decision: showing a plan or a payment method would describe an
  // arrangement that does not exist, and signup deliberately collects no card.
  it('Billing states there is no payment capability rather than showing an empty plan', () => {
    at(routePaths.accountBilling, <AccountBillingScreen />);

    expect(screen.getByText(/takes no payment today/)).toBeInTheDocument();
    expect(screen.getByText(/collects no card/)).toBeInTheDocument();
  });

  it('keeps the tab strip on every one of them, so none is a dead end', () => {
    for (const [path, node] of [
      [routePaths.accountSecurity, <AccountSecurityScreen key="s" />],
      [routePaths.accountNotification, <AccountNotificationScreen key="n" />],
      [routePaths.accountBilling, <AccountBillingScreen key="b" />],
    ] as const) {
      at(path, node);
      expect(screen.getByRole('tab', { name: 'Profile' })).toBeInTheDocument();
      cleanup();
    }
  });
});
