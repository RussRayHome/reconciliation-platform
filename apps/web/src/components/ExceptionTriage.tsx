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
import { actionByOutcome, type DecisionAction } from '../hooks/useReviewerDecisions';
import {
  buildFacetOptions,
  emptyFacetSelection,
  matchesFacets,
  matchesQuery,
  SAVED_VIEWS_STORAGE_KEY,
  sortDisplays,
  toExceptionDisplay,
  type SavedTriageView,
  type TriageFacetKey,
  type TriageFacetSelection,
  type TriageSortKey,
} from '../lib/exceptionTriage';

const facetGroupMeta: ReadonlyArray<{ key: TriageFacetKey; label: string }> = [
  { key: 'severity', label: 'Severity' },
  { key: 'category', label: 'Category' },
  { key: 'source', label: 'Source' },
  { key: 'rule', label: 'Rule' },
  { key: 'amountBand', label: 'Amount band' },
];

const loadSavedViews = (): SavedTriageView[] => {
  try {
    const raw = globalThis.localStorage?.getItem(SAVED_VIEWS_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;

    return Array.isArray(parsed) ? (parsed as SavedTriageView[]) : [];
  } catch {
    return [];
  }
};

const persistSavedViews = (views: SavedTriageView[]): void => {
  try {
    globalThis.localStorage?.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Ignore storage failures so saved views still work in-memory for the session.
  }
};

/** Master–detail exception triage: dense virtualized list, evidence detail, and in-place decisions. */
export function ExceptionTriage({
  exceptions,
  decisionByTargetId,
  pendingTargetId,
  decisionError,
  onDecide,
}: Readonly<{
  exceptions: ExceptionItem[];
  decisionByTargetId: Record<string, ReviewerDecision>;
  pendingTargetId: string | null;
  decisionError: string | null;
  onDecide: (targetId: string, action: DecisionAction, notes?: string) => void;
}>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<TriageSortKey>('severity');
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

    return sortDisplays(matched, sortKey);
  }, [allDisplays, facetSelection, normalizedQuery, sortKey]);

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
    estimateSize: () => 40,
    overscan: 12,
  });

  const selectedIndex = filtered.findIndex((display) => display.item.id === selectedId);
  const selectedDisplay = selectedIndex >= 0 ? filtered[selectedIndex] : undefined;

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

    if (key === 'arrowdown' || key === 'j') {
      event.preventDefault();
      selectByIndex(selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, filtered.length - 1), {
        openDrawer: false,
        focus: true,
      });
      return;
    }

    if (key === 'arrowup' || key === 'k') {
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
      onDecide(selectedDisplay.item.id, 'accept');
    } else if (key === 'r') {
      event.preventDefault();
      onDecide(selectedDisplay.item.id, 'reject');
    } else if (key === 'n') {
      event.preventDefault();
      onDecide(selectedDisplay.item.id, 'research');
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

  const saveView = (name: string): void => {
    const view: SavedTriageView = {
      id: `view-${Date.now()}`,
      name,
      query,
      sortKey,
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
    setSortKey(view.sortKey);
    setFacetSelection({ ...emptyFacetSelection(), ...view.facets });
  };

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
        sortKey={sortKey}
        onSortChange={setSortKey}
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
        <p className="exception-triage__shortcut-legend">
          Shortcuts: <kbd>J</kbd>/<kbd>K</kbd> navigate · <kbd>A</kbd> accept · <kbd>R</kbd> reject
          · <kbd>N</kbd> needs research
        </p>
        {filtered.length === 0 ? (
          <div className="empty-state-card table-empty-state" role="status" aria-live="polite">
            <span className="eyebrow">No matching exceptions</span>
            <h3>No exceptions match the current filters</h3>
            <p>Adjust the search text or facet filters to see matching exception items again.</p>
          </div>
        ) : (
          <div className="exception-triage__list" aria-label="Exceptions" ref={listRef}>
            <div
              className="exception-triage__list-canvas"
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
          noteDraft={noteDraftByExceptionId[selectedDisplay.item.id]}
          onNoteDraftChange={(value) =>
            setNoteDraftByExceptionId((current) => ({
              ...current,
              [selectedDisplay.item.id]: value,
            }))
          }
          onClose={() => setIsDrawerOpen(false)}
          onDecide={(action, notes) => onDecide(selectedDisplay.item.id, action, notes)}
        />
      ) : null}
    </div>
  );
}
