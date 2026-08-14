import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { NavLink, useLocation } from 'react-router';

import type {
  ApprovalCountsByGroup,
  ApprovalGroupKey,
  ExceptionItem,
  RuleFamily,
} from '@recon/domain';

import navRailLogo from '../assets/nav-rail-logo.png';
import { SemanticIcon, type SemanticIconName } from './SemanticIcon';
import { RemoveAccountDialog } from './RemoveAccountDialog';
import { NavRailAccountMenu } from './NavRailAccountMenu';
import { routePaths } from '../routes/routePaths';
import {
  BANK_TEMPLATE_URL,
  BANK_TEMPLATE_XLSX_URL,
  GL_TEMPLATE_URL,
  GL_TEMPLATE_XLSX_URL,
} from '../lib/templates';
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

/** Per-submenu Approvals badge: items awaiting my decision (approver) or my items needing
 * attention -- rejected work I need to fix and resubmit (submitter). Null until counts load. */
const approvalBadgeCount = (
  counts: ApprovalCountsByGroup | null,
  key: ApprovalGroupKey,
  canApprove: boolean,
): number | null => {
  if (!counts) {
    return null;
  }
  return canApprove ? counts[key].pending : counts[key].rejected;
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
  canAccessRunBook,
  canApprove,
  approvalCounts,
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

        <NavRailCategory title="Work" first>
          <NavItemLink
            to={routePaths.importFiles}
            label="Import Files"
            icon="upload"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />

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
          <CollapsibleNavSection
            sectionId="mapping"
            label="Mapping"
            icon="architecture"
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
              to={routePaths.mappingVersions}
              label="Mapping Versions"
              icon="clock"
              isCollapsed={isCollapsed}
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
              <div className="nav-rail__item nav-rail__item--template" title={isCollapsed ? 'Bank template' : undefined}>
                <span className="nav-rail__item-label">Bank template</span>
                <span className="nav-rail__template-formats">
                  <a
                    className="nav-rail__pill nav-rail__pill--link"
                    href={BANK_TEMPLATE_URL}
                    download
                    aria-label="Bank template CSV"
                  >
                    CSV
                  </a>
                  <a
                    className="nav-rail__pill nav-rail__pill--link"
                    href={BANK_TEMPLATE_XLSX_URL}
                    download
                    aria-label="Bank template XLSX"
                  >
                    XLSX
                  </a>
                </span>
              </div>
              <div className="nav-rail__item nav-rail__item--template" title={isCollapsed ? 'GL template' : undefined}>
                <span className="nav-rail__item-label">GL template</span>
                <span className="nav-rail__template-formats">
                  <a
                    className="nav-rail__pill nav-rail__pill--link"
                    href={GL_TEMPLATE_URL}
                    download
                    aria-label="GL template CSV"
                  >
                    CSV
                  </a>
                  <a
                    className="nav-rail__pill nav-rail__pill--link"
                    href={GL_TEMPLATE_XLSX_URL}
                    download
                    aria-label="GL template XLSX"
                  >
                    XLSX
                  </a>
                </span>
              </div>
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
            {/* Variance thresholds are edited inline on the Matching Rules screen (no separate
                route exists yet) -- this link intentionally points at the same page. */}
            <NavItemLink
              to={routePaths.mappingRules}
              label="Variance thresholds"
              icon="exposure"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
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
          <CollapsibleNavSection
            sectionId="approvals"
            label="Approvals"
            icon="review"
            username={username}
            bordered={false}
          >
            <NavItemLink
              to={routePaths.approvalsImports}
              label="Imported files"
              icon="upload"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
              badge={approvalBadgeCount(approvalCounts, 'import', canApprove)}
              badgeTone={canApprove ? 'attention' : 'neutral'}
            />
            <NavItemLink
              to={routePaths.approvalsMappingProfiles}
              label="Mapping Profiles"
              ariaLabel="Mapping Profiles approvals"
              icon="architecture"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
              badge={approvalBadgeCount(approvalCounts, 'mappingProfile', canApprove)}
              badgeTone={canApprove ? 'attention' : 'neutral'}
            />
            <NavItemLink
              to={routePaths.approvalsMatchingRules}
              label="Matching Rule & Variances"
              icon="rule"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
              badge={approvalBadgeCount(approvalCounts, 'matchingRule', canApprove)}
              badgeTone={canApprove ? 'attention' : 'neutral'}
            />
            <NavItemLink
              to={routePaths.approvalsExceptionResolutions}
              label="Exception Resolutions"
              icon="exceptions"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
              badge={approvalBadgeCount(approvalCounts, 'exceptionResolution', canApprove)}
              badgeTone={canApprove ? 'attention' : 'neutral'}
            />
            <NavItemLink
              to={routePaths.approvalsReportDistribution}
              label="Report Distribution"
              icon="reports"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
              badge={approvalBadgeCount(approvalCounts, 'reportDistribution', canApprove)}
              badgeTone={canApprove ? 'attention' : 'neutral'}
            />
          </CollapsibleNavSection>
        </NavRailCategory>

        <NavRailCategory title="Analyze">
          <NavItemLink
            to={routePaths.export}
            label="Reports"
            icon="operations"
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
          canAccessRunBook={canAccessRunBook}
          isCollapsed={isCollapsed}
          username={username}
          onNavigate={onMobileClose}
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
      <span className="nav-rail__item-label-group">
        <span className="nav-rail__item-label">{label}</span>
        {caption ? <span className="nav-rail__item-caption">{caption}</span> : null}
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
