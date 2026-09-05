import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { ExceptionItem, ReviewerDecision } from '@recon/domain';
import { useVirtualizer } from '@tanstack/react-virtual';

import { ExceptionRow } from './ExceptionRow';
import { ExceptionEvidencePanel } from './ExceptionEvidencePanel';
import { ExceptionFacets } from './ExceptionFacets';
import { ExceptionListHeader } from './ExceptionListHeader';
import { actionByOutcome, type DecisionAction } from '../hooks/useReviewerDecisions';
import {
  buildFacetOptions,
  emptyFacetSelection,
  loadSavedViews,
  matchesFacets,
  matchesQuery,
  persistSavedViews,
  sortDisplays,
  toExceptionDisplay,
  type SavedTriageView,
  type TriageFacetKey,
  type TriageFacetSelection,
  type TriageSortDirection,
  type TriageSortKey,
} from '../lib/exceptionTriage';

const facetGroupMeta: ReadonlyArray<{ key: TriageFacetKey; label: string }> = [
  { key: 'severity', label: 'Severity' },
  { key: 'category', label: 'Category' },
  { key: 'source', label: 'Source' },
  { key: 'rule', label: 'Rule' },
  { key: 'amountBand', label: 'Amount band' },
];

/** Master–detail exception triage: dense virtualized list, evidence detail, and in-place decisions. */
export function ExceptionTriage({
  exceptions,
  decisionByTargetId,
  pendingTargetId,
  decisionError,
  lastChange,
  onDecide,
  onClearDecision,
  onUndoLastDecision,
  pendingSavedViewId = null,
  onPendingSavedViewApplied,
  starredIds,
  onToggleStar,
  density = 'comfortable',
}: Readonly<{
  exceptions: ExceptionItem[];
  decisionByTargetId: Record<string, ReviewerDecision>;
  pendingTargetId: string | null;
  decisionError: string | null;
  lastChange: { targetId: string; label: string } | null;
  onDecide: (targetId: string, action: DecisionAction, notes?: string) => void;
  onClearDecision: (targetId: string) => void;
  onUndoLastDecision: () => void;
  pendingSavedViewId?: string | null;
  onPendingSavedViewApplied?: () => void;
  starredIds?: string[];
  onToggleStar?: (exceptionId: string) => void;
  density?: 'comfortable' | 'compact';
}>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: TriageSortKey; direction: TriageSortDirection }>({
    key: 'severity',
    direction: 'desc',
  });
  const [facetSelection, setFacetSelection] = useState<TriageFacetSelection>(emptyFacetSelection);
  const [savedViews, setSavedViews] = useState<SavedTriageView[]>(() => loadSavedViews());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [noteDraftByExceptionId, setNoteDraftByExceptionId] = useState<Record<string, string>>({});
  const [isDesktop, setIsDesktop] = useState(() =>
    globalThis.window === undefined
      ? true
      : globalThis.window.matchMedia('(min-width: 961px)').matches,
  );

  const listRef = useRef<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState(40);

  // Read --row-height once per density change so the virtualizer tracks the density system.
  useEffect(() => {
    const element = listRef.current;

    if (!element) {
      return;
    }

    const value = Number.parseFloat(
      globalThis.getComputedStyle(element).getPropertyValue('--row-height'),
    );

    if (Number.isFinite(value) && value > 0) {
      setRowHeight(value);
    }
  }, [density]);

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toUpperCase();

  const allDisplays = useMemo(() => exceptions.map(toExceptionDisplay), [exceptions]);

  const facetGroups = useMemo(
    () =>
      facetGroupMeta.map((group) => ({
        key: group.key,
        label: group.label,
        options: buildFacetOptions(allDisplays, group.key, facetSelection),
      })),
    [allDisplays, facetSelection],
  );

  const filtered = useMemo(() => {
    const matched = allDisplays.filter(
      (display) => matchesFacets(display, facetSelection) && matchesQuery(display, normalizedQuery),
    );

    return sortDisplays(matched, sort.key, sort.direction);
  }, [allDisplays, facetSelection, normalizedQuery, sort]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    (Object.keys(facetSelection) as TriageFacetKey[]).some((key) => facetSelection[key].length > 0);

  useEffect(() => {
    if (globalThis.window === undefined) {
      return undefined;
    }

    const mediaQueryList = globalThis.window.matchMedia('(min-width: 961px)');
    const onChange = (event: MediaQueryListEvent): void => {
      setIsDesktop(event.matches);
    };

    setIsDesktop(mediaQueryList.matches);
    mediaQueryList.addEventListener('change', onChange);

    return () => {
      mediaQueryList.removeEventListener('change', onChange);
    };
  }, []);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }

    setSelectedId((current) => {
      if (current && filtered.some((display) => display.item.id === current)) {
        return current;
      }

      return filtered[0]?.item.id ?? null;
    });
  }, [filtered]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  useEffect(() => {
    rowVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight]);

  const selectedIndex = filtered.findIndex((display) => display.item.id === selectedId);
  const selectedDisplay = selectedIndex >= 0 ? filtered[selectedIndex] : undefined;
  const decidedCount = filtered.filter((display) => decisionByTargetId[display.item.id]).length;

  const focusRow = (id: string): void => {
    globalThis.requestAnimationFrame?.(() => {
      document.getElementById(`exception-option-${id}`)?.focus();
    });
  };

  const selectByIndex = (index: number, options: { openDrawer: boolean; focus: boolean }): void => {
    const target = filtered[index];

    if (!target) {
      return;
    }

    setSelectedId(target.item.id);
    rowVirtualizer.scrollToIndex(index, { align: 'auto' });

    if (options.focus) {
      focusRow(target.item.id);
    }

    if (options.openDrawer && !isDesktop) {
      setIsDrawerOpen(true);
    }
  };

  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const key = event.key.toLowerCase();

    // Never let a decision shortcut fire while the reviewer is typing in the note or search field.
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
      return;
    }

    if (key === 'arrowdown') {
      event.preventDefault();
      selectByIndex(selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, filtered.length - 1), {
        openDrawer: false,
        focus: true,
      });
      return;
    }

    if (key === 'arrowup') {
      event.preventDefault();
      selectByIndex(selectedIndex <= 0 ? 0 : selectedIndex - 1, {
        openDrawer: false,
        focus: true,
      });
      return;
    }

    if (!selectedDisplay) {
      return;
    }

    if (key === 'a') {
      event.preventDefault();
      toggleDecision(selectedDisplay.item.id, 'accept');
    } else if (key === 'r') {
      event.preventDefault();
      toggleDecision(selectedDisplay.item.id, 'reject');
    } else if (key === 'n') {
      event.preventDefault();
      toggleDecision(selectedDisplay.item.id, 'research');
    } else if (key === 'u') {
      event.preventDefault();
      onUndoLastDecision();
    }
  };

  // Pressing the key of the already-active outcome clears the decision (returns to undecided).
  const toggleDecision = (targetId: string, action: DecisionAction): void => {
    const current = decisionByTargetId[targetId];
    const currentAction = current ? actionByOutcome[current.outcome] : undefined;

    if (currentAction === action) {
      onClearDecision(targetId);
    } else {
      onDecide(targetId, action);
    }
  };

  const toggleFacet = (facetKey: TriageFacetKey, value: string): void => {
    setFacetSelection((current) => {
      const selected = current[facetKey];
      const next = selected.includes(value)
        ? selected.filter((entry) => entry !== value)
        : [...selected, value];

      return { ...current, [facetKey]: next };
    });
  };

  const clearFilters = (): void => {
    setQuery('');
    setFacetSelection(emptyFacetSelection());
  };

  // Clicking a column header sorts by it; clicking the active column flips the direction.
  const handleSort = (key: TriageSortKey): void => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { key, direction: 'desc' },
    );
  };

  const saveView = (name: string): void => {
    const view: SavedTriageView = {
      id: `view-${Date.now()}`,
      name,
      query,
      sortKey: sort.key,
      facets: facetSelection,
    };
    const next = [...savedViews, view];

    setSavedViews(next);
    persistSavedViews(next);
  };

  const applyView = (id: string): void => {
    const view = savedViews.find((entry) => entry.id === id);

    if (!view) {
      return;
    }

    setQuery(view.query);
    setSort({ key: view.sortKey, direction: 'desc' });
    setFacetSelection({ ...emptyFacetSelection(), ...view.facets });
  };

  useEffect(() => {
    if (!pendingSavedViewId) {
      return;
    }

    const view = savedViews.find((entry) => entry.id === pendingSavedViewId);

    if (view) {
      setQuery(view.query);
      setSort({ key: view.sortKey, direction: 'desc' });
      setFacetSelection({ ...emptyFacetSelection(), ...view.facets });
    }

    onPendingSavedViewApplied?.();
  }, [pendingSavedViewId, savedViews, onPendingSavedViewApplied]);

  const deleteView = (id: string): void => {
    const next = savedViews.filter((entry) => entry.id !== id);

    setSavedViews(next);
    persistSavedViews(next);
  };

  const virtualRows = rowVirtualizer.getVirtualItems();
  const isVirtualized = virtualRows.length > 0;
  const rowEntries: Array<{
    display: (typeof filtered)[number];
    index: number;
    style?: React.CSSProperties;
  }> = isVirtualized
    ? virtualRows.flatMap((virtualRow) => {
        const display = filtered[virtualRow.index];

        return display
          ? [
              {
                display,
                index: virtualRow.index,
                style: {
                  position: 'absolute' as const,
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                },
              },
            ]
          : [];
      })
    : filtered.map((display, index) => ({ display, index }));

  return (
    <div className="exception-triage">
      <ExceptionFacets
        query={query}
        onQueryChange={setQuery}
        facetGroups={facetGroups}
        selection={facetSelection}
        onToggleFacet={toggleFacet}
        onClearFacets={clearFilters}
        hasActiveFilters={hasActiveFilters}
        totalShown={filtered.length}
        totalAll={exceptions.length}
        savedViews={savedViews}
        onSaveView={saveView}
        onApplyView={applyView}
        onDeleteView={deleteView}
      />

      <div className="exception-triage__list-pane">
        <div className="exception-triage__list-header">
          <p className="exception-triage__shortcut-legend">
            Shortcuts: <kbd>↑</kbd>/<kbd>↓</kbd> navigate · <kbd>A</kbd> accept · <kbd>R</kbd>{' '}
            reject · <kbd>N</kbd> needs research · <kbd>U</kbd> undo
          </p>
          {/* Position is shown, not announced: the rows are a listbox, so a screen reader already
              reports "N of M" on selection -- a live region here would double-announce it. */}
          {filtered.length > 0 ? (
            <p className="exception-triage__position">
              {selectedIndex >= 0
                ? `${selectedIndex + 1} of ${filtered.length}`
                : `${filtered.length} shown`}{' '}
              · {decidedCount} decided
            </p>
          ) : null}
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state-card table-empty-state" role="status" aria-live="polite">
            <span className="eyebrow">No matching exceptions</span>
            <h3>No exceptions match the current filters</h3>
            <p>Adjust the search text or facet filters to see matching exception items again.</p>
          </div>
        ) : (
          <div className="exception-triage__list" ref={listRef}>
            <ExceptionListHeader sort={sort} onSort={handleSort} />
            <div
              className="exception-triage__list-canvas"
              role="listbox"
              aria-label="Exceptions"
              style={isVirtualized ? { height: `${rowVirtualizer.getTotalSize()}px` } : undefined}
            >
              {rowEntries.map(({ display, index, style }) => {
                const decision = decisionByTargetId[display.item.id];
                const draftNote = noteDraftByExceptionId[display.item.id];
                const hasNote = Boolean((draftNote ?? decision?.notes ?? '').trim());

                return (
                  <ExceptionRow
                    key={display.item.id}
                    display={display}
                    optionId={`exception-option-${display.item.id}`}
                    isSelected={display.item.id === selectedId}
                    tabIndex={display.item.id === selectedId ? 0 : -1}
                    decisionAction={decision ? actionByOutcome[decision.outcome] : undefined}
                    isPending={pendingTargetId === display.item.id}
                    hasNote={hasNote}
                    posInSet={index + 1}
                    setSize={filtered.length}
                    onSelect={() => selectByIndex(index, { openDrawer: true, focus: false })}
                    onKeyDown={handleRowKeyDown}
                    style={style}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selectedDisplay && (isDesktop || isDrawerOpen) ? (
        <ExceptionEvidencePanel
          display={selectedDisplay}
          decision={decisionByTargetId[selectedDisplay.item.id]}
          isPending={pendingTargetId === selectedDisplay.item.id}
          error={decisionError}
          isDrawer={!isDesktop}
          lastChange={
            lastChange && lastChange.targetId === selectedDisplay.item.id ? lastChange : null
          }
          noteDraft={noteDraftByExceptionId[selectedDisplay.item.id]}
          onNoteDraftChange={(value) =>
            setNoteDraftByExceptionId((current) => ({
              ...current,
              [selectedDisplay.item.id]: value,
            }))
          }
          onClose={() => setIsDrawerOpen(false)}
          onDecide={(action, notes) => onDecide(selectedDisplay.item.id, action, notes)}
          onClear={() => onClearDecision(selectedDisplay.item.id)}
          onUndo={onUndoLastDecision}
          isStarred={starredIds?.includes(selectedDisplay.item.id) ?? false}
          onToggleStar={onToggleStar ? () => onToggleStar(selectedDisplay.item.id) : undefined}
        />
      ) : null}
    </div>
  );
}
