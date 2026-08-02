import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { NavLink } from 'react-router-dom';

import type { ExceptionItem } from '@recon/domain';

import navRailLogo from '../assets/nav-rail-logo.png';
import { SemanticIcon, type SemanticIconName } from './SemanticIcon';
import { RemoveAccountDialog } from './RemoveAccountDialog';
import { routePaths } from '../routes/routePaths';
import { BANK_TEMPLATE_URL, GL_TEMPLATE_URL } from '../lib/templates';
import { useNavSectionCollapse } from '../hooks/useNavSectionCollapse';
import {
  loadSavedViews,
  matchesFacets,
  matchesQuery,
  SAVED_VIEWS_CHANGED_EVENT,
  toExceptionDisplay,
  type SavedTriageView,
} from '../lib/exceptionTriage';

const RAIL_COLLAPSED_STORAGE_PREFIX = 'reconciliation-platform:nav-rail-collapsed';

const railItems: ReadonlyArray<{
  to: string;
  label: string;
  icon: SemanticIconName;
}> = [
  { to: routePaths.importFiles, label: 'Import Files', icon: 'setup' },
  { to: routePaths.reconSummary, label: 'Recon summary', icon: 'reports' },
  { to: routePaths.probableMatches, label: 'Probable matches', icon: 'match' },
  { to: routePaths.exceptions, label: 'Exceptions', icon: 'exceptions' },
];

const accountItems: ReadonlyArray<{ to: string; label: string; icon: SemanticIconName }> = [
  { to: routePaths.accountProfile, label: 'Profile', icon: 'profile' },
  { to: routePaths.accountSecurity, label: 'Security', icon: 'security' },
  { to: routePaths.accountBilling, label: 'Billing', icon: 'billing' },
  { to: routePaths.accountNotification, label: 'Notification', icon: 'notification' },
  { to: routePaths.accountPreferences, label: 'Preferences', icon: 'preferences' },
];

const loadRailCollapsed = (username: string): boolean => {
  try {
    return (
      globalThis.localStorage?.getItem(`${RAIL_COLLAPSED_STORAGE_PREFIX}:${username}`) === 'true'
    );
  } catch {
    return false;
  }
};

const persistRailCollapsed = (username: string, collapsed: boolean): void => {
  try {
    globalThis.localStorage?.setItem(
      `${RAIL_COLLAPSED_STORAGE_PREFIX}:${username}`,
      String(collapsed),
    );
  } catch {
    // Ignore storage failures; collapse state simply resets next session.
  }
};

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
 * Sticky left navigation rail: flattened workspace destinations plus collapsible Mapping,
 * Account, and Documentation sections, all as real routes, with permission-gated system
 * links, saved triage views, and a persistent identity/sign-out footer.
 */
export function NavRail({
  unreviewedExceptionCount,
  exceptions,
  onApplySavedView,
  docsHref,
  showDeveloperDashboardLink,
  canAccessDocumentation,
  username,
  profileLabel,
  roleLabel,
  onSignOut,
  isMobileOpen,
  onMobileClose,
}: Readonly<{
  unreviewedExceptionCount: number | null;
  exceptions: ExceptionItem[];
  onApplySavedView: (view: SavedTriageView) => void;
  docsHref: string;
  showDeveloperDashboardLink: boolean;
  canAccessDocumentation: boolean;
  username: string;
  profileLabel: string;
  roleLabel: string;
  onSignOut: () => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
}>) {
  const [isCollapsed, setIsCollapsed] = useState(() => loadRailCollapsed(username));
  const [isRemoveAccountOpen, setIsRemoveAccountOpen] = useState(false);
  const savedViewCounts = useSavedViewCounts(exceptions);

  const toggleCollapsed = (): void => {
    setIsCollapsed((previous) => {
      persistRailCollapsed(username, !previous);
      return !previous;
    });
  };

  const railClassName = [
    'nav-rail',
    isCollapsed ? 'nav-rail--collapsed' : '',
    isMobileOpen ? 'nav-rail--mobile-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {isMobileOpen ? (
        <button
          type="button"
          className="nav-rail__scrim"
          aria-label="Close navigation"
          onClick={onMobileClose}
        />
      ) : null}
      <nav className={railClassName} aria-label="Primary">
        <div className="nav-rail__brand">
          <img
            src={navRailLogo}
            alt="Reconciliation Platform logo"
            className="nav-rail__brand-logo"
          />
          <span className="nav-rail__brand-name">Reconciliation Platform</span>
        </div>

        <button
          type="button"
          className="nav-rail__toggle"
          onClick={toggleCollapsed}
          aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!isCollapsed}
        >
          <span className="nav-rail__toggle-glyph" aria-hidden="true">
            {isCollapsed ? '»' : '«'}
          </span>
          <span className="nav-rail__item-label">Collapse</span>
        </button>

        <NavRailDestinations
          unreviewedExceptionCount={unreviewedExceptionCount}
          isCollapsed={isCollapsed}
          onNavigate={onMobileClose}
        />

        <CollapsibleNavSection sectionId="mapping" label="Mapping" username={username}>
          <NavItemLink
            to={routePaths.mappingFields}
            label="Mapping fields"
            icon="architecture"
            isCollapsed={isCollapsed}
            indented
            onNavigate={onMobileClose}
          />
          <NavItemLink
            to={routePaths.mappingUpload}
            label="Upload files"
            icon="upload"
            isCollapsed={isCollapsed}
            indented
            onNavigate={onMobileClose}
          />
          {!isCollapsed ? (
            <p className="nav-rail__subgroup-label">
              <span className="nav-rail__item-icon" aria-hidden="true">
                <SemanticIcon name="records" />
              </span>
              Download templates
            </p>
          ) : null}
          <div className="nav-rail__indent">
            <a
              className="nav-rail__item"
              href={BANK_TEMPLATE_URL}
              download
              title={isCollapsed ? 'Bank template' : undefined}
            >
              <span className="nav-rail__item-label">Bank template</span>
              <span className="nav-rail__pill">CSV</span>
            </a>
            <a
              className="nav-rail__item"
              href={GL_TEMPLATE_URL}
              download
              title={isCollapsed ? 'GL template' : undefined}
            >
              <span className="nav-rail__item-label">GL template</span>
              <span className="nav-rail__pill">CSV</span>
            </a>
          </div>
        </CollapsibleNavSection>

        <div className="nav-rail__group">
          <NavItemLink
            to={routePaths.export}
            label="Export"
            icon="operations"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />
        </div>

        <CollapsibleNavSection sectionId="account" label="Account" username={username}>
          {accountItems.map((item) => (
            <NavItemLink
              key={item.to}
              to={item.to}
              label={item.label}
              icon={item.icon}
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
          ))}
          <button
            type="button"
            className="nav-rail__item"
            title={isCollapsed ? 'Remove account' : undefined}
            onClick={() => {
              setIsRemoveAccountOpen(true);
              onMobileClose();
            }}
          >
            <span className="nav-rail__item-icon" aria-hidden="true">
              <SemanticIcon name="remove" />
            </span>
            <span className="nav-rail__item-label">Remove account</span>
          </button>
        </CollapsibleNavSection>

        <NavRailSystemLinks
          docsHref={docsHref}
          showDeveloperDashboardLink={showDeveloperDashboardLink}
          canAccessDocumentation={canAccessDocumentation}
          isCollapsed={isCollapsed}
          username={username}
          onNavigate={onMobileClose}
        />

        {!isCollapsed && savedViewCounts.length > 0 ? (
          <div className="nav-rail__section" aria-label="Saved views">
            <p className="nav-rail__section-title">Saved views</p>
            {savedViewCounts.map(({ view, count }) => (
              <button
                key={view.id}
                type="button"
                className="nav-rail__saved-view"
                onClick={() => {
                  onApplySavedView(view);
                  onMobileClose();
                }}
              >
                <span className="nav-rail__saved-view-name">{view.name}</span>
                <span className="nav-rail__saved-view-count">{count}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="nav-rail__footer">
          <span className="nav-rail__footer-avatar" aria-hidden="true">
            {computeInitials(profileLabel)}
          </span>
          <div className="nav-rail__footer-who">
            <span className="nav-rail__footer-name">{profileLabel}</span>
            <span className="nav-rail__footer-role">{roleLabel}</span>
          </div>
          <button type="button" className="nav-rail__footer-logout" onClick={onSignOut}>
            Log out
          </button>
        </div>
      </nav>

      <RemoveAccountDialog
        username={username}
        isOpen={isRemoveAccountOpen}
        onClose={() => setIsRemoveAccountOpen(false)}
      />
    </>
  );
}

/** Shared route-link rendering for a single rail item (used for flat items and section children). */
function NavItemLink({
  to,
  label,
  icon,
  isCollapsed,
  indented,
  badge,
  onNavigate,
}: Readonly<{
  to: string;
  label: string;
  icon: SemanticIconName;
  isCollapsed: boolean;
  indented?: boolean;
  badge?: number | null;
  onNavigate: () => void;
}>) {
  const link = (
    <NavLink
      to={to}
      end={to === routePaths.importFiles}
      className={({ isActive }) =>
        isActive ? 'nav-rail__item nav-rail__item--active' : 'nav-rail__item'
      }
      title={isCollapsed ? label : undefined}
      onClick={onNavigate}
    >
      <span className="nav-rail__item-icon" aria-hidden="true">
        <SemanticIcon name={icon} />
      </span>
      <span className="nav-rail__item-label">{label}</span>
      {badge !== null && badge !== undefined && badge > 0 ? (
        <span className="nav-rail__badge" aria-label={`${badge} open exceptions`}>
          {badge}
        </span>
      ) : null}
    </NavLink>
  );

  return indented ? <div className="nav-rail__indent">{link}</div> : link;
}

/** Collapsible nav-rail group: `<button aria-expanded>` header + children, state persisted per section/user. */
function CollapsibleNavSection({
  sectionId,
  label,
  username,
  children,
}: Readonly<{
  sectionId: string;
  label: string;
  username: string;
  children: ReactNode;
}>) {
  const { isOpen, toggle } = useNavSectionCollapse(sectionId, username);

  return (
    <div className="nav-rail__section nav-rail__collapsible">
      <button
        type="button"
        className="nav-rail__section-header"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        <span className="nav-rail__section-title">{label}</span>
        <span
          className={
            isOpen
              ? 'nav-rail__section-chevron'
              : 'nav-rail__section-chevron nav-rail__section-chevron--closed'
          }
          aria-hidden="true"
        >
          ⌄
        </span>
      </button>
      {isOpen ? <div className="nav-rail__section-children">{children}</div> : null}
    </div>
  );
}

/** Loads saved triage views, keeps them fresh across changes, and annotates each with its match count. */
function useSavedViewCounts(
  exceptions: ExceptionItem[],
): Array<{ view: SavedTriageView; count: number }> {
  const [savedViews, setSavedViews] = useState<SavedTriageView[]>(() => loadSavedViews());

  useEffect(() => {
    const refreshSavedViews = (): void => {
      setSavedViews(loadSavedViews());
    };

    globalThis.addEventListener?.(SAVED_VIEWS_CHANGED_EVENT, refreshSavedViews);

    return () => {
      globalThis.removeEventListener?.(SAVED_VIEWS_CHANGED_EVENT, refreshSavedViews);
    };
  }, []);

  const displays = useMemo(() => exceptions.map(toExceptionDisplay), [exceptions]);

  return useMemo(
    () =>
      savedViews.map((view) => ({
        view,
        count: displays.filter(
          (display) =>
            matchesFacets(display, view.facets) &&
            matchesQuery(display, view.query.trim().toUpperCase()),
        ).length,
      })),
    [displays, savedViews],
  );
}

/** Flattened workspace destinations, rendered as real routes via `NavLink`. */
function NavRailDestinations({
  unreviewedExceptionCount,
  isCollapsed,
  onNavigate,
}: Readonly<{
  unreviewedExceptionCount: number | null;
  isCollapsed: boolean;
  onNavigate: () => void;
}>) {
  return (
    <div className="nav-rail__group" aria-label="Workspace sections">
      {railItems.map((item) => (
        <NavItemLink
          key={item.to}
          to={item.to}
          label={item.label}
          icon={item.icon}
          isCollapsed={isCollapsed}
          onNavigate={onNavigate}
          badge={item.to === routePaths.exceptions ? unreviewedExceptionCount : undefined}
        />
      ))}
    </div>
  );
}

/** Permission-gated system links; unpermitted items are never rendered. */
function NavRailSystemLinks({
  docsHref,
  showDeveloperDashboardLink,
  canAccessDocumentation,
  isCollapsed,
  username,
  onNavigate,
}: Readonly<{
  docsHref: string;
  showDeveloperDashboardLink: boolean;
  canAccessDocumentation: boolean;
  isCollapsed: boolean;
  username: string;
  onNavigate: () => void;
}>) {
  if (!canAccessDocumentation && !showDeveloperDashboardLink) {
    return null;
  }

  return (
    <div className="nav-rail__section nav-rail__section--system" aria-label="System">
      <p className="nav-rail__section-title">System</p>
      {showDeveloperDashboardLink ? (
        <NavLink
          to={routePaths.developer}
          className={({ isActive }) =>
            isActive ? 'nav-rail__item nav-rail__item--active' : 'nav-rail__item'
          }
          title={isCollapsed ? 'Developer Dashboard' : undefined}
          onClick={onNavigate}
        >
          <span className="nav-rail__item-icon" aria-hidden="true">
            <SemanticIcon name="operations" />
          </span>
          <span className="nav-rail__item-label">Developer Dashboard</span>
        </NavLink>
      ) : null}
      {canAccessDocumentation ? (
        <CollapsibleNavSection sectionId="documentation" label="Documentation" username={username}>
          <div className="nav-rail__indent">
            {/* Real, working documentation link (full-page nav to the separate Docs shell) --
                kept as-is under its new label rather than routed to the coming-soon placeholder,
                so this doesn't regress existing functionality. */}
            <a
              className="nav-rail__item nav-rail__item--link"
              href={docsHref}
              title={isCollapsed ? 'User Guide' : undefined}
            >
              <span className="nav-rail__item-icon" aria-hidden="true">
                <SemanticIcon name="reference" />
              </span>
              <span className="nav-rail__item-label">User Guide</span>
            </a>
            <NavItemLink
              to={routePaths.documentationRulebook}
              label="Rulebook"
              icon="rules"
              isCollapsed={isCollapsed}
              onNavigate={onNavigate}
            />
          </div>
        </CollapsibleNavSection>
      ) : null}
    </div>
  );
}
