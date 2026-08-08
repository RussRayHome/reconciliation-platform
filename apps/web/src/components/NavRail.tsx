import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { NavLink, useLocation } from 'react-router-dom';

import type { ExceptionItem, RuleFamily } from '@recon/domain';

import navRailLogo from '../assets/nav-rail-logo.png';
import { SemanticIcon, type SemanticIconName } from './SemanticIcon';
import { RemoveAccountDialog } from './RemoveAccountDialog';
import { routePaths } from '../routes/routePaths';
import { BANK_TEMPLATE_URL, GL_TEMPLATE_URL } from '../lib/templates';
import { useNavSectionCollapse } from '../hooks/useNavSectionCollapse';
import { parseRuleFamilyParam, parseTunableParam, ruleFamilyToSlug } from '../lib/ruleFilters';
import {
  loadSavedViews,
  matchesFacets,
  matchesQuery,
  SAVED_VIEWS_CHANGED_EVENT,
  toExceptionDisplay,
  type SavedTriageView,
} from '../lib/exceptionTriage';

const RAIL_COLLAPSED_STORAGE_PREFIX = 'reconciliation-platform:nav-rail-collapsed';

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
 * Sticky left navigation rail: Account up top, the Import/Mapping/Approvals/Reconciliation/
 * Exceptions workflow, Reports, and a permission-gated System section, all as real routes, plus
 * saved triage views and a persistent identity/sign-out footer.
 */
export function NavRail({
  unreviewedExceptionCount,
  exceptions,
  onApplySavedView,
  docsHref,
  canAccessDocumentation,
  canAccessRunBook,
  username,
  profileLabel,
  roleLabel,
  onSignOut,
  isMobileOpen,
  onMobileClose,
  matchingRuleTotalCount,
  matchingRuleFamilyCounts,
  matchingRuleFixedCount,
}: Readonly<{
  unreviewedExceptionCount: number | null;
  exceptions: ExceptionItem[];
  onApplySavedView: (view: SavedTriageView) => void;
  docsHref: string;
  canAccessDocumentation: boolean;
  canAccessRunBook: boolean;
  username: string;
  profileLabel: string;
  roleLabel: string;
  onSignOut: () => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
  /** Total rule count for the Matching Rules item's pill/aria-label; omitted (no pill) until the catalog loads. */
  matchingRuleTotalCount?: number;
  /** Per-family rule counts for the Matching Rules rail sub-items; omitted (no sub-items) until the catalog loads. */
  matchingRuleFamilyCounts?: Array<{ family: RuleFamily; count: number }>;
  /** Count of rules with no adjustable metric, for the "No adjustable metric" sub-item. */
  matchingRuleFixedCount?: number;
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
          <span className="nav-rail__brand-name">Recon Platform</span>
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

        <div className="nav-rail__group nav-rail__group--divided" aria-label="Workspace sections">
          <NavItemLink
            to={routePaths.importFiles}
            label="Import Files"
            icon="setup"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />

          <CollapsibleNavSection
            sectionId="mapping"
            label="Mapping"
            username={username}
            bordered={false}
          >
            <NavItemLink
              to={routePaths.mappingProfiles}
              label="Mapping Profiles"
              icon="architecture"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
            <NavItemLink
              to={routePaths.mappingCreate}
              label="Create Mapping"
              icon="setup"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
            <NavItemLink
              to={routePaths.mappingRules}
              label="Matching Rules"
              icon="rule"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
              count={matchingRuleTotalCount}
              ariaLabel={
                matchingRuleTotalCount === undefined
                  ? 'Matching Rules'
                  : `Matching Rules, ${matchingRuleTotalCount} rules`
              }
            />
            {matchingRuleFamilyCounts ? (
              <div className="nav-rail__indent">
                {matchingRuleFamilyCounts.map(({ family, count }) => (
                  <MatchingRuleFilterLink
                    key={family}
                    label={family}
                    count={count}
                    search={`?family=${ruleFamilyToSlug(family)}`}
                    isActiveFor={(searchParams) => parseRuleFamilyParam(searchParams.get('family')) === family}
                    isCollapsed={isCollapsed}
                    onNavigate={onMobileClose}
                  />
                ))}
                {matchingRuleFixedCount !== undefined ? (
                  <MatchingRuleFilterLink
                    label="No adjustable metric"
                    count={matchingRuleFixedCount}
                    search="?tunable=false"
                    isActiveFor={(searchParams) => parseTunableParam(searchParams.get('tunable')) === false}
                    isCollapsed={isCollapsed}
                    onNavigate={onMobileClose}
                  />
                ) : null}
              </div>
            ) : null}
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
            <NavItemLink
              to={routePaths.mappingHistory}
              label="Mapping History"
              icon="clock"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
          </CollapsibleNavSection>

          <CollapsibleNavSection
            sectionId="approvals"
            label="Approvals"
            username={username}
            bordered={false}
          >
            <NavItemLink
              to={routePaths.approvalsPending}
              label="Pending Imports"
              icon="review"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
            <NavItemLink
              to={routePaths.approvalsApproved}
              label="Approved Imports"
              icon="quality"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
            <NavItemLink
              to={routePaths.approvalsRejected}
              label="Rejected Imports"
              icon="missing"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
          </CollapsibleNavSection>

          <NavItemLink
            to={routePaths.reconSummary}
            label="Reconciliation"
            icon="reports"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />
          <NavItemLink
            to={routePaths.exceptions}
            label="Exceptions"
            icon="exceptions"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
            badge={unreviewedExceptionCount}
          />
        </div>

        <div className="nav-rail__group nav-rail__group--divided">
          <NavItemLink
            to={routePaths.export}
            label="Reports"
            icon="operations"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />
        </div>

        <NavRailSystemLinks
          docsHref={docsHref}
          canAccessDocumentation={canAccessDocumentation}
          canAccessRunBook={canAccessRunBook}
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
  count,
  ariaLabel,
  onNavigate,
}: Readonly<{
  to: string;
  label: string;
  icon: SemanticIconName;
  isCollapsed: boolean;
  indented?: boolean;
  badge?: number | null;
  count?: number;
  ariaLabel?: string;
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
      aria-label={ariaLabel}
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
      {count !== undefined ? <span className="nav-rail__pill">{count}</span> : null}
    </NavLink>
  );

  return indented ? <div className="nav-rail__indent">{link}</div> : link;
}

/**
 * One Matching Rules filter sub-item -- navigates to `/mapping/rules` plus a family or tunable
 * query param (T5: "filters into /mapping/rules -- not separate routes"). Active-state is
 * determined by `isActiveFor` inspecting the current URLSearchParams directly rather than
 * NavLink's own `isActive`, since that only compares pathname, not query params.
 */
function MatchingRuleFilterLink({
  label,
  count,
  search,
  isActiveFor,
  isCollapsed,
  onNavigate,
}: Readonly<{
  label: string;
  count: number;
  search: string;
  isActiveFor: (searchParams: URLSearchParams) => boolean;
  isCollapsed: boolean;
  onNavigate: () => void;
}>) {
  const location = useLocation();
  const isActive =
    location.pathname === routePaths.mappingRules &&
    isActiveFor(new URLSearchParams(location.search));

  return (
    <NavLink
      to={`${routePaths.mappingRules}${search}`}
      className={isActive ? 'nav-rail__item nav-rail__item--active' : 'nav-rail__item'}
      title={isCollapsed ? label : undefined}
      onClick={onNavigate}
    >
      <span className="nav-rail__item-label">{label}</span>
      <span className="nav-rail__pill">{count}</span>
    </NavLink>
  );
}

/** Collapsible nav-rail group: `<button aria-expanded>` header + children, state persisted per section/user. */
function CollapsibleNavSection({
  sectionId,
  label,
  username,
  bordered = true,
  children,
}: Readonly<{
  sectionId: string;
  label: string;
  username: string;
  bordered?: boolean;
  children: ReactNode;
}>) {
  const { isOpen, toggle } = useNavSectionCollapse(sectionId, username);

  return (
    <div
      className={
        bordered
          ? 'nav-rail__section nav-rail__collapsible'
          : 'nav-rail__section nav-rail__collapsible nav-rail__collapsible--unbordered'
      }
    >
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

/** Permission-gated system links; unpermitted items are never rendered. */
function NavRailSystemLinks({
  docsHref,
  canAccessDocumentation,
  canAccessRunBook,
  isCollapsed,
  username,
  onNavigate,
}: Readonly<{
  docsHref: string;
  canAccessDocumentation: boolean;
  canAccessRunBook: boolean;
  isCollapsed: boolean;
  username: string;
  onNavigate: () => void;
}>) {
  if (!canAccessDocumentation) {
    return null;
  }

  return (
    <div className="nav-rail__section nav-rail__section--system" aria-label="System">
      <p className="nav-rail__section-title">System</p>
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
            {canAccessRunBook ? (
              <NavItemLink
                to={routePaths.documentationRunBook}
                label="Run Book"
                icon="rules"
                isCollapsed={isCollapsed}
                onNavigate={onNavigate}
              />
            ) : null}
          </div>
        </CollapsibleNavSection>
      ) : null}
    </div>
  );
}
