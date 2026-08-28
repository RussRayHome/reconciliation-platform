import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { NavLink } from 'react-router';

import { approvalGroupKeys, type ApprovalCountsByGroup, type ExceptionItem } from '@recon/domain';

import navRailLogo from '../assets/nav-rail-logo.png';
import { SemanticIcon, type SemanticIconName } from './SemanticIcon';
import { RemoveAccountDialog } from './RemoveAccountDialog';
import { NavRailAccountMenu } from './NavRailAccountMenu';
import { routePaths } from '../routes/routePaths';
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

/** N1: one Pending approvals rail badge, summed across all five approval groups -- items awaiting
 * my decision (approver) or my items needing attention -- rejected work I need to fix and
 * resubmit (submitter), same per-group split `approvalBadgeCount` always used, just totalled
 * instead of shown per submenu now that the five submenus are gone. Null until counts load. */
const summedApprovalBadgeCount = (
  counts: ApprovalCountsByGroup | null,
  canApprove: boolean,
): number | null => {
  if (!counts) {
    return null;
  }
  return approvalGroupKeys.reduce(
    (total, key) => total + (canApprove ? counts[key].pending : counts[key].rejected),
    0,
  );
};

/**
 * Sticky left navigation rail, grouped into four pipeline-order categories -- WORK, CONFIGURE,
 * REVIEW, ANALYZE -- plus a permission-gated System section and a footer identity/account menu.
 * Approvals is a collapsible section here, with one rail item per approvable type; clicking one
 * opens that type's own Pending/Approved/Rejected/My submissions table.
 */
export function NavRail({
  unreviewedExceptionCount,
  exceptions,
  onApplySavedView,
  docsHref,
  canAccessDocumentation,
  canApprove,
  approvalCounts,
  username,
  profileLabel,
  roleLabel,
  onSignOut,
  isMobileOpen,
  onMobileClose,
  matchingRuleTotalCount,
}: Readonly<{
  unreviewedExceptionCount: number | null;
  exceptions: ExceptionItem[];
  onApplySavedView: (view: SavedTriageView) => void;
  docsHref: string;
  canAccessDocumentation: boolean;
  /** Whether this user can act as an approver -- drives each Approvals submenu badge's tone. */
  canApprove: boolean;
  /** Per-submenu Approvals badge counts. Null until loaded. */
  approvalCounts: ApprovalCountsByGroup | null;
  username: string;
  profileLabel: string;
  roleLabel: string;
  onSignOut: () => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
  /** Total rule count for the Matching Rules item's pill/aria-label; omitted (no pill) until the catalog loads. */
  matchingRuleTotalCount?: number;
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

        <NavRailCategory title="Work" first>
          <CollapsibleNavSection
            sectionId="importFiles"
            label="Import Files"
            icon="upload"
            username={username}
            bordered={false}
          >
            <NavItemLink
              to={routePaths.importFilesBank}
              label="Bank Statements"
              icon="upload"
              caption="BANK · GL"
              hue="bank"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
            <NavItemLink
              to={routePaths.importFilesBilling}
              label="AP / Billing"
              icon="upload"
              caption="BILLING"
              hue="ap"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
          </CollapsibleNavSection>

          <CollapsibleNavSection
            sectionId="reconciliation"
            label="Reconciliation"
            icon="reports"
            username={username}
            bordered={false}
          >
            <NavItemLink
              to={routePaths.reconSummary}
              label="File-based"
              icon="reports"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
            <NavItemLink
              to={routePaths.probableMatches}
              label="Rules-based"
              icon="match"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
          </CollapsibleNavSection>

          <NavItemLink
            to={routePaths.exceptions}
            label="Exceptions"
            icon="exceptions"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
            badge={unreviewedExceptionCount}
          />
        </NavRailCategory>

        <NavRailCategory title="Configure">
          {/* N2: Mapping Profiles/Versions/History all render ComingSoonPage (see
              EXPECTED_ABSENT_FROM_RAIL in NavRail.test.tsx) -- the "Mapping" section wrapper is
              removed along with them, but Create Mapping is a working, verification-gated screen
              and is promoted to a plain top-level item here rather than losing its only rail entry
              point. */}
          <NavItemLink
            to={routePaths.mappingCreate}
            label="Create Mapping"
            icon="setup"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />

          <CollapsibleNavSection
            sectionId="rules"
            label="Rules & Variances"
            icon="rule"
            username={username}
            bordered={false}
          >
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
            {/* N3: the per-family/tunability facets and the Variance thresholds link both
                duplicated capability the Matching Rules screen itself already has (its own family
                and tunable/fixed filter chips, and a labelled "Variance thresholds" section) --
                removed here, not rebuilt there. */}
            <NavItemLink
              to={routePaths.mappingRulesVersions}
              label="Rule Versions"
              icon="clock"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
          </CollapsibleNavSection>
        </NavRailCategory>

        <NavRailCategory title="Review">
          {/* N1: the five per-type approval submenus (and their section header) are removed --
              one destination, one summed count. Each row inside links to its own object screen
              (ApprovalsPage.tsx's APPROVAL_GROUPS), not a queue copy. */}
          <NavItemLink
            to={routePaths.approvals}
            label="Pending approvals"
            icon="review"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
            badge={summedApprovalBadgeCount(approvalCounts, canApprove)}
            badgeTone={canApprove ? 'attention' : 'neutral'}
          />
        </NavRailCategory>

        <NavRailCategory title="Analyze">
          <NavItemLink
            to={routePaths.export}
            label="Reports"
            icon="operations"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />
          <NavItemLink
            to={routePaths.openItemsSchedule}
            label="Open Items Schedule"
            icon="clock"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />
          {!isCollapsed && savedViewCounts.length > 0 ? (
            <>
              <p className="nav-rail__subgroup-label">Saved views</p>
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
            </>
          ) : null}
        </NavRailCategory>

        <NavRailSystemLinks
          docsHref={docsHref}
          canAccessDocumentation={canAccessDocumentation}
          isCollapsed={isCollapsed}
          username={username}
        />

        <NavRailAccountMenu
          profileLabel={profileLabel}
          roleLabel={roleLabel}
          onSignOut={onSignOut}
          onNavigate={onMobileClose}
          onOpenRemoveAccount={() => setIsRemoveAccountOpen(true)}
        />
      </nav>

      <RemoveAccountDialog
        username={username}
        isOpen={isRemoveAccountOpen}
        onClose={() => setIsRemoveAccountOpen(false)}
      />
    </>
  );
}

/** Non-collapsible category wrapper (WORK/CONFIGURE/REVIEW/ANALYZE) -- always-visible label, survives rail collapse as a divider line. */
function NavRailCategory({
  title,
  first = false,
  children,
}: Readonly<{ title: string; first?: boolean; children: ReactNode }>) {
  return (
    <div
      className={
        first
          ? 'nav-rail__section nav-rail__section--category'
          : 'nav-rail__section nav-rail__section--category nav-rail__section--category-divided'
      }
      aria-label={title}
    >
      <p className="nav-rail__section-title">{title}</p>
      <div className="nav-rail__group">{children}</div>
    </div>
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
  badgeTone = 'attention',
  caption,
  count,
  hue,
  ariaLabel,
  onNavigate,
}: Readonly<{
  to: string;
  label: string;
  icon: SemanticIconName;
  isCollapsed: boolean;
  indented?: boolean;
  badge?: number | null;
  badgeTone?: 'attention' | 'neutral';
  caption?: string;
  count?: number;
  /** Source-hue edge marker (e.g. the Import Files children) -- omit for items with no source
   * association. */
  hue?: 'bank' | 'ap';
  ariaLabel?: string;
  onNavigate: () => void;
}>) {
  const link = (
    <NavLink
      to={to}
      end={to === routePaths.importFilesBank}
      className={({ isActive }) => {
        const classes = ['nav-rail__item'];
        if (isActive) classes.push('nav-rail__item--active');
        if (hue) classes.push(`nav-rail__item--${hue}`);
        return classes.join(' ');
      }}
      title={isCollapsed ? label : undefined}
      aria-label={ariaLabel}
      onClick={onNavigate}
    >
      <span className="nav-rail__item-icon" aria-hidden="true">
        <SemanticIcon name={icon} />
      </span>
      <span className="nav-rail__item-label-group">
        <span className="nav-rail__item-label">{label}</span>
        {caption ? (
          <span className="nav-rail__item-caption" aria-hidden="true">
            {caption}
          </span>
        ) : null}
      </span>
      {badge !== null && badge !== undefined && badge > 0 ? (
        <span
          className={
            badgeTone === 'neutral' ? 'nav-rail__badge nav-rail__badge--neutral' : 'nav-rail__badge'
          }
          aria-label={ariaLabel ? undefined : `${badge} ${label}`}
        >
          {badge}
        </span>
      ) : null}
      {count !== undefined ? <span className="nav-rail__pill">{count}</span> : null}
    </NavLink>
  );

  return indented ? <div className="nav-rail__indent">{link}</div> : link;
}

/** Collapsible nav-rail group: `<button aria-expanded>` header + children, state persisted per section/user. */
function CollapsibleNavSection({
  sectionId,
  label,
  icon,
  username,
  bordered = true,
  children,
}: Readonly<{
  sectionId: string;
  label: string;
  icon?: SemanticIconName;
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
        {icon ? (
          <span className="nav-rail__item-icon" aria-hidden="true">
            <SemanticIcon name={icon} />
          </span>
        ) : null}
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
  isCollapsed,
  username,
}: Readonly<{
  docsHref: string;
  canAccessDocumentation: boolean;
  isCollapsed: boolean;
  username: string;
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
            {/* N2: Run Book rendered ComingSoonPage -- removed along with the rail entry point. */}
          </div>
        </CollapsibleNavSection>
      ) : null}
    </div>
  );
}
