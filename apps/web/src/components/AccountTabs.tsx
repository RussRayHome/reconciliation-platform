import { useLocation, useNavigate } from 'react-router';

import { RovingTabList } from './RovingTabList';
import { routePaths } from '../routes/routePaths';

type AccountTabId = 'profile' | 'security' | 'preferences' | 'notification' | 'billing';

const TABS: ReadonlyArray<{ id: AccountTabId; label: string; path: string }> = [
  { id: 'profile', label: 'Profile', path: routePaths.accountProfile },
  { id: 'security', label: 'Security', path: routePaths.accountSecurity },
  { id: 'preferences', label: 'Preferences', path: routePaths.accountPreferences },
  { id: 'notification', label: 'Notifications', path: routePaths.accountNotification },
  { id: 'billing', label: 'Billing', path: routePaths.accountBilling },
];

/**
 * The account family's in-screen tabs (10c, 12a–12c, UI-12, #451).
 *
 * Five routes, one strip — and the rail's account row stays the active entry while any of them is
 * open, rather than the rail growing five children. That is the recorded rail rule, and the same
 * reasoning that keeps Mapping a single leaf.
 *
 * Each tab is a real route, so back, bookmarking and deep links behave.
 */
export function AccountTabs() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Exact match, not prefix: `/accounts` is the organization's BANK ACCOUNT registry (A-D1), a
  // different screen whose path is one character away from this family's stem. routePaths.ts
  // carries a comment warning about exactly this collision.
  const active = TABS.find((tab) => tab.path === pathname)?.id;
  if (!active) {
    return null;
  }

  return (
    <RovingTabList
      items={TABS.map(({ id, label }) => ({ id, label }))}
      activeId={active}
      onSelect={(id) => {
        const target = TABS.find((tab) => tab.id === id);
        // void: react-router's navigate returns a promise this caller has no use for.
        if (target) void navigate(target.path);
      }}
      ariaLabel="Account screens"
      tabIdPrefix="account-tab"
      panelIdPrefix="account-panel"
      listClassName="mapping-tabs"
      tabClassName="mapping-tabs__tab"
      activeTabClassName="mapping-tabs__tab--active"
    />
  );
}
