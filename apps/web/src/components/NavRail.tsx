import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { ExceptionItem } from '@recon/domain';

import { SemanticIcon, type SemanticIconName } from './SemanticIcon';
import {
  loadSavedViews,
  matchesFacets,
  matchesQuery,
  SAVED_VIEWS_CHANGED_EVENT,
  toExceptionDisplay,
  type SavedTriageView,
} from '../lib/exceptionTriage';

/** Flattened workspace destinations surfaced by the navigation rail. */
export type RailDestination =
  'setup' | 'summary' | 'probable-matches' | 'exceptions' | 'close' | 'developer';

const RAIL_COLLAPSED_STORAGE_PREFIX = 'reconciliation-platform:nav-rail-collapsed';

const railItems: ReadonlyArray<{
  id: RailDestination;
  label: string;
  icon: SemanticIconName;
}> = [
  { id: 'setup', label: 'Setup', icon: 'setup' },
  { id: 'summary', label: 'Summary', icon: 'reports' },
  { id: 'probable-matches', label: 'Probable matches', icon: 'match' },
  { id: 'exceptions', label: 'Exceptions', icon: 'exceptions' },
  { id: 'close', label: 'Close & export', icon: 'operations' },
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

/**
 * Sticky left navigation rail: flattened workspace destinations with roving-tabindex
 * keyboard support, permission-gated system links, and saved triage views.
 */
export function NavRail({
  activeDestination,
  onSelectDestination,
  unreviewedExceptionCount,
  exceptions,
  onApplySavedView,
  docsHref,
  showDeveloperDashboardLink,
  canAccessDocumentation,
  username,
  isMobileOpen,
  onMobileClose,
}: Readonly<{
  activeDestination: RailDestination;
  onSelectDestination: (destination: RailDestination) => void;
  unreviewedExceptionCount: number | null;
  exceptions: ExceptionItem[];
  onApplySavedView: (view: SavedTriageView) => void;
  docsHref: string;
  showDeveloperDashboardLink: boolean;
  canAccessDocumentation: boolean;
  username: string;
  isMobileOpen: boolean;
  onMobileClose: () => void;
}>) {
  const [isCollapsed, setIsCollapsed] = useState(() => loadRailCollapsed(username));
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
      <nav className={railClassName} aria-label="Workspace navigation">
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
          activeDestination={activeDestination}
          unreviewedExceptionCount={unreviewedExceptionCount}
          isCollapsed={isCollapsed}
          onSelect={(destination) => {
            onSelectDestination(destination);
            onMobileClose();
          }}
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

        <NavRailSystemLinks
          docsHref={docsHref}
          showDeveloperDashboardLink={showDeveloperDashboardLink}
          canAccessDocumentation={canAccessDocumentation}
          isCollapsed={isCollapsed}
          activeDestination={activeDestination}
          onSelectDestination={(destination) => {
            onSelectDestination(destination);
            onMobileClose();
          }}
        />
      </nav>
    </>
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

/** Vertical roving-tabindex tab list over the flattened workspace destinations. */
function NavRailDestinations({
  activeDestination,
  unreviewedExceptionCount,
  isCollapsed,
  onSelect,
}: Readonly<{
  activeDestination: RailDestination;
  unreviewedExceptionCount: number | null;
  isCollapsed: boolean;
  onSelect: (destination: RailDestination) => void;
}>) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = railItems.findIndex((item) => item.id === activeDestination);
  const rovingIndex = activeIndex === -1 ? 0 : activeIndex;

  const focusAndSelectItem = (index: number): void => {
    const boundedIndex = (index + railItems.length) % railItems.length;
    const nextItem = railItems[boundedIndex];

    if (!nextItem) {
      return;
    }

    onSelect(nextItem.id);
    itemRefs.current[boundedIndex]?.focus();
  };

  const handleItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        focusAndSelectItem(index + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        focusAndSelectItem(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAndSelectItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusAndSelectItem(railItems.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="nav-rail__group"
      role="tablist"
      aria-label="Workspace sections"
      aria-orientation="vertical"
    >
      {railItems.map((item, index) => {
        const isActive = item.id === activeDestination;
        const showBadge =
          item.id === 'exceptions' &&
          unreviewedExceptionCount !== null &&
          unreviewedExceptionCount > 0;

        return (
          <button
            key={item.id}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            className={isActive ? 'nav-rail__item nav-rail__item--active' : 'nav-rail__item'}
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            aria-controls={`tab-panel-${item.id}`}
            tabIndex={rovingIndex === index ? 0 : -1}
            title={isCollapsed ? item.label : undefined}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => handleItemKeyDown(event, index)}
          >
            <span className="nav-rail__item-icon" aria-hidden="true">
              <SemanticIcon name={item.icon} />
            </span>
            <span className="nav-rail__item-label">{item.label}</span>
            {showBadge ? (
              <span
                className="nav-rail__badge"
                aria-label={`${unreviewedExceptionCount} unreviewed`}
              >
                {unreviewedExceptionCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Permission-gated system links; unpermitted items are never rendered. */
function NavRailSystemLinks({
  docsHref,
  showDeveloperDashboardLink,
  canAccessDocumentation,
  isCollapsed,
  activeDestination,
  onSelectDestination,
}: Readonly<{
  docsHref: string;
  showDeveloperDashboardLink: boolean;
  canAccessDocumentation: boolean;
  isCollapsed: boolean;
  activeDestination: RailDestination;
  onSelectDestination: (destination: RailDestination) => void;
}>) {
  if (!canAccessDocumentation && !showDeveloperDashboardLink) {
    return null;
  }

  return (
    <div className="nav-rail__section nav-rail__section--system" aria-label="System">
      <p className="nav-rail__section-title">System</p>
      {showDeveloperDashboardLink ? (
        <button
          type="button"
          className={
            activeDestination === 'developer'
              ? 'nav-rail__item nav-rail__item--active'
              : 'nav-rail__item'
          }
          aria-current={activeDestination === 'developer' ? 'page' : undefined}
          title={isCollapsed ? 'Developer Dashboard' : undefined}
          onClick={() => onSelectDestination('developer')}
        >
          <span className="nav-rail__item-icon" aria-hidden="true">
            <SemanticIcon name="operations" />
          </span>
          <span className="nav-rail__item-label">Developer Dashboard</span>
        </button>
      ) : null}
      {canAccessDocumentation ? (
        <a
          className="nav-rail__item nav-rail__item--link"
          href={docsHref}
          title={isCollapsed ? 'Documentation' : undefined}
        >
          <span className="nav-rail__item-icon" aria-hidden="true">
            <SemanticIcon name="help" />
          </span>
          <span className="nav-rail__item-label">Documentation</span>
        </a>
      ) : null}
    </div>
  );
}
