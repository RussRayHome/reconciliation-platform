import { useEffect, useRef, useState } from 'react';

import { NavLink } from 'react-router';

import { SemanticIcon, type SemanticIconName } from './SemanticIcon';
import { routePaths } from '../routes/routePaths';

const accountItems: ReadonlyArray<{ to: string; label: string; icon: SemanticIconName }> = [
  { to: routePaths.accountProfile, label: 'Profile', icon: 'profile' },
  { to: routePaths.accountSecurity, label: 'Security', icon: 'security' },
  { to: routePaths.accountBilling, label: 'Billing', icon: 'billing' },
  { to: routePaths.accountNotification, label: 'Notification', icon: 'notification' },
  { to: routePaths.accountPreferences, label: 'Preferences', icon: 'preferences' },
];

const computeInitials = (label: string): string => {
  const parts = label.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return '?';
  }

  if (parts.length === 1) {
    return (parts[0] ?? '').slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
};

/**
 * Footer identity block + account menu popover. Replaces the old always-expanded "Account"
 * rail section: Profile/Security/Billing/Notification/Preferences/Remove account/Log out now
 * live behind the footer's avatar+role chevron instead of occupying the top of the rail.
 */
export function NavRailAccountMenu({
  profileLabel,
  roleLabel,
  onSignOut,
  onNavigate,
  onOpenRemoveAccount,
}: Readonly<{
  profileLabel: string;
  roleLabel: string;
  onSignOut: () => void;
  onNavigate: () => void;
  onOpenRemoveAccount: () => void;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const close = (): void => setIsOpen(false);

  return (
    <div className="nav-rail__footer" ref={containerRef}>
      <span className="nav-rail__footer-avatar" aria-hidden="true">
        {computeInitials(profileLabel)}
      </span>
      <div className="nav-rail__footer-who">
        <span className="nav-rail__footer-name">{profileLabel}</span>
        <span className="nav-rail__footer-role">{roleLabel}</span>
      </div>
      <button
        type="button"
        className="nav-rail__footer-menu-toggle"
        aria-label={isOpen ? 'Close account menu' : 'Open account menu'}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((previous) => !previous)}
      >
        <span
          className={
            isOpen
              ? 'nav-rail__section-chevron'
              : 'nav-rail__section-chevron nav-rail__section-chevron--closed'
          }
          aria-hidden="true"
        >
          ⌃
        </span>
      </button>

      {isOpen ? (
        <div className="nav-rail__account-menu">
          {accountItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="nav-rail__item"
              onClick={() => {
                close();
                onNavigate();
              }}
            >
              <span className="nav-rail__item-icon" aria-hidden="true">
                <SemanticIcon name={item.icon} />
              </span>
              <span className="nav-rail__item-label">{item.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className="nav-rail__item"
            onClick={() => {
              close();
              onOpenRemoveAccount();
            }}
          >
            <span className="nav-rail__item-icon" aria-hidden="true">
              <SemanticIcon name="remove" />
            </span>
            <span className="nav-rail__item-label">Remove account</span>
          </button>
          <button
            type="button"
            className="nav-rail__item"
            onClick={() => {
              close();
              onSignOut();
            }}
          >
            <span className="nav-rail__item-label">Log out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
