import { useState, type ReactNode } from 'react';

import { Link, useLocation } from 'react-router';

import { approvalGroupKeys, type ApprovalCountsByGroup, type ExceptionItem } from '@recon/domain';

import navRailLogo from '../assets/nav-rail-logo.png';
import { SemanticIcon, type SemanticIconName } from './SemanticIcon';
import { RemoveAccountDialog } from './RemoveAccountDialog';
import { NavRailAccountMenu } from './NavRailAccountMenu';
import { routePaths } from '../routes/routePaths';
import { useSavedViewCounts } from '../hooks/useSavedViewCounts';
import { useNavSectionCollapse } from '../hooks/useNavSectionCollapse';
import type { SavedTriageView } from '../lib/exceptionTriage';

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
 * Sticky left navigation rail, grouped into four pipeline-order categories -- CLOSE, CONFIGURE,
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
  probableMatchCount,
  activeAccountCount,
  apEntityCount,
  arEntityCount,
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
  /** Null before a run exists / while the registry could not be read -- an absent badge, never a
   * zero. Both read the same source their destination screen renders from (UI-1 item 4). */
  probableMatchCount?: number | null;
  activeAccountCount?: number | null;
  apEntityCount?: number | null;
  arEntityCount?: number | null;
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

        {/* N4: "Close" holds the whole close journey in order -- Import Files, Reconcile,
            Exceptions, Reports. Renamed from "Work" (a label change) with Reports moved in from
            Analyze (also a label/position change); every sectionId below is untouched, since
            useNavSectionCollapse bakes the id into each user's collapse-state storage key. */}
        <NavRailCategory title="Runs" first>
          {/* UI refresh decision 1: Import Files is the ONLY section that flattens, because its two
              children became source-type tabs on one New run screen. Every other disclosure stays.
              The caption is the design's sub-label; AR and payroll join it when UI-2 wires them. */}
          {/* UI-4 (#403): Home is the first RUNS entry and the rail's landing destination. No
              badge -- it is a place, not a queue. */}
          <NavItemLink
            to={routePaths.runsHome}
            label="Home"
            icon="overview"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />

          <NavItemLink
            to={routePaths.importFiles}
            label="New run"
            icon="upload"
            caption="BANK · GL · SUBLEDGERS"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />

          <CollapsibleNavSection
            sectionId="reconciliation"
            label="Match results"
            icon="reports"
            username={username}
            bordered={false}
          >
            <NavItemLink
              to={routePaths.reconSummary}
              label="Summary"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
            <NavItemLink
              to={routePaths.probableMatches}
              label="Probable matches"
              badge={probableMatchCount ?? null}
              badgeTone="neutral"
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

          <NavItemLink
            to={routePaths.export}
            label="Reports & export"
            icon="reference"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />
        </NavRailCategory>

        <NavRailCategory title="Configure">
          {/* N2: Mapping Profiles/Versions/History all render ComingSoonPage (see
              EXPECTED_ABSENT_FROM_RAIL in NavRail.test.tsx) -- the "Mapping" section wrapper is
              removed along with them, but Create Mapping is a working, verification-gated screen
              and is promoted to a plain top-level item here rather than losing its only rail entry
              point. */}
          <NavItemLink
            to={routePaths.bankAccounts}
            label="Bank accounts"
            icon="records"
            badge={activeAccountCount ?? null}
            badgeTone="neutral"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />

          {/* UI-9 (#448): the disclosure the canonical rail promises. UI-1 deliberately did not add
              it, because a section whose children do not exist is a rail entry pointing at
              nothing -- exactly the failure the nav audit (#456) exists to catch. Its children
              ship in the same commit as the screens they open. */}
          <CollapsibleNavSection
            sectionId="subledger-entities"
            label="Subledger entities"
            icon="architecture"
            username={username}
            bordered={false}
          >
            <NavItemLink
              to={routePaths.apEntities}
              label="AP entities"
              badge={apEntityCount ?? null}
              badgeTone="neutral"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
            <NavItemLink
              to={routePaths.arEntities}
              label="AR entities"
              badge={arEntityCount ?? null}
              badgeTone="neutral"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
          </CollapsibleNavSection>

          <NavItemLink
            to={routePaths.mappingCreate}
            alsoActiveFor={[
              routePaths.mappingProfiles,
              routePaths.mappingVersions,
              routePaths.mappingHistory,
            ]}
            label="Mapping"
            icon="setup"
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
          />

          <CollapsibleNavSection
            sectionId="rules"
            label="Matching rules"
            icon="rule"
            username={username}
            bordered={false}
          >
            <NavItemLink
              to={routePaths.mappingRules}
              label="Rules & variances"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
              badge={matchingRuleTotalCount ?? null}
              badgeTone="neutral"
              ariaLabel={
                matchingRuleTotalCount === undefined
                  ? 'Rules & variances'
                  : `Rules & variances, ${matchingRuleTotalCount} rules`
              }
            />
            {/* N3: the per-family/tunability facets and the Variance thresholds link both
                duplicated capability the Matching Rules screen itself already has (its own family
                and tunable/fixed filter chips, and a labelled "Variance thresholds" section) --
                removed here, not rebuilt there. */}
            <NavItemLink
              to={routePaths.mappingRulesVersions}
              label="Versions"
              isCollapsed={isCollapsed}
              onNavigate={onMobileClose}
            />
          </CollapsibleNavSection>
        </NavRailCategory>

        <NavRailCategory title="Approvals">
          {/* N1: the five per-type approval submenus (and their section header) are removed --
              one destination, one summed count. Each row inside links to its own object screen
              (ApprovalsPage.tsx's APPROVAL_GROUPS), not a queue copy. */}
          <NavItemLink
            to={routePaths.approvals}
            label="Pending"
            icon="review"
            alsoActiveFor={[routePaths.approvalsPolicy]}
            isCollapsed={isCollapsed}
            onNavigate={onMobileClose}
            badge={summedApprovalBadgeCount(approvalCounts, canApprove)}
            badgeTone={canApprove ? 'attention' : 'neutral'}
          />
        </NavRailCategory>

        <NavRailCategory title="Analyze">
          <NavItemLink
            to={routePaths.openItemsSchedule}
            label="Open items"
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
  alsoActiveFor,
  hue,
  ariaLabel,
  onNavigate,
}: Readonly<{
  to: string;
  label: string;
  /** Omitted for disclosure children: the canonical rail draws them as label-only rows behind the
   * guide line, which is part of how the rail fits its 900px card. */
  icon?: SemanticIconName;
  isCollapsed: boolean;
  indented?: boolean;
  badge?: number | null;
  badgeTone?: 'attention' | 'neutral';
  caption?: string;
  /** UI-13 (#456): extra paths this entry stays active for -- the rest of the screen family it
   * opens. Deliberately an explicit list, not a `/mapping/*` prefix: `/mapping/rules` and
   * `/mapping/rules/versions` belong to Matching rules' own children, and a prefix would light
   * two entries at once, which is the exact rule this phase exists to enforce. */
  alsoActiveFor?: readonly string[];
  /** Source-hue edge marker (e.g. the Import Files children) -- omit for items with no source
   * association. */
  hue?: 'bank' | 'ap';
  ariaLabel?: string;
  onNavigate: () => void;
}>) {
  // UI-13 (#456). Active state is computed here rather than left to NavLink, for two reasons the
  // one-active-entry sweep in App.test.tsx found the moment it existed:
  //
  //   - NavLink matches by PREFIX, so `/mapping/rules/versions` lit both "Rules & variances"
  //     (/mapping/rules) and "Versions" at once -- two highlighted entries, which the canonical
  //     rail forbids.
  //   - NavLink also owns `aria-current` and writes `undefined` when its own match fails, so a
  //     prop set alongside it is silently discarded.
  //
  // Exact match plus an explicit `alsoActiveFor` list makes every highlight a declared fact. The
  // `end` special-case for '/' goes away with it: exactness is now the default rather than an
  // exception one route had to ask for.
  const { pathname } = useLocation();
  const isActive = pathname === to || (alsoActiveFor?.includes(pathname) ?? false);
  const classes = ['nav-rail__item'];
  if (isActive) classes.push('nav-rail__item--active');
  if (hue) classes.push(`nav-rail__item--${hue}`);
  const link = (
    <Link
      to={to}
      aria-current={isActive ? 'page' : undefined}
      className={classes.join(' ')}
      title={isCollapsed ? label : undefined}
      aria-label={ariaLabel}
      onClick={onNavigate}
    >
      {icon ? (
        <span className="nav-rail__item-icon" aria-hidden="true">
          <SemanticIcon name={icon} />
        </span>
      ) : null}
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
    </Link>
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
            {/* "Run book" is the canonical documentation name as of 2026-09-11 (#397); "User
                guide" is retired vocabulary and appears in no rail entry, heading, copy string or
                route. This is a label change only -- nothing in code was named after "user guide",
                which is part of why the rail was the side to move.

                The href stays on the separate Docs shell, which is real and working.
                `documentationRunBook` (/documentation/run-book) still renders ComingSoonPage, so
                pointing the rail at it would retarget a working entry onto a placeholder. The two
                consolidate when 10e is built -- see #450/#451. */}
            <a
              className="nav-rail__item nav-rail__item--link"
              href={docsHref}
              title={isCollapsed ? 'Run book' : undefined}
            >
              <span className="nav-rail__item-label">Run book</span>
            </a>
          </div>
        </CollapsibleNavSection>
      ) : null}
    </div>
  );
}
