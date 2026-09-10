import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useRef } from 'react';

import { SemanticIcon, type SemanticIconName } from './SemanticIcon';

/** One selectable tab within a roving-tabindex tab list. */
export type RovingTabItem<TId extends string> = {
  id: TId;
  label: string;
  description?: string;
  icon?: SemanticIconName;
  /** CSS custom property holding this tab's hue, e.g. `--bank`. Exposed to CSS as
   * `--roving-tab-accent` so a strip can colour each segment by what it represents. Optional
   * because only the import strip is colour-coded -- the Review segmented control is not. */
  accentToken?: string;
};

/**
 * Accessible tab list with roving tabindex plus Arrow/Home/End handling, reused
 * for both the top-level workspace tabs and the Review stage segmented control.
 */
export function RovingTabList<TId extends string>({
  items,
  activeId,
  onSelect,
  ariaLabel,
  tabIdPrefix,
  panelIdPrefix,
  listClassName,
  tabClassName,
  activeTabClassName,
  renderContent,
}: Readonly<{
  items: ReadonlyArray<RovingTabItem<TId>>;
  activeId: TId;
  onSelect: (id: TId) => void;
  ariaLabel: string;
  tabIdPrefix: string;
  panelIdPrefix: string;
  listClassName: string;
  tabClassName: string;
  activeTabClassName: string;
  renderContent?: (item: RovingTabItem<TId>) => React.ReactNode;
}>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = items.findIndex((item) => item.id === activeId);

  const focusAndSelectTab = (index: number): void => {
    const boundedIndex = (index + items.length) % items.length;
    const nextTab = items[boundedIndex];

    if (!nextTab) {
      return;
    }

    onSelect(nextTab.id);
    tabRefs.current[boundedIndex]?.focus();
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusAndSelectTab(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusAndSelectTab(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAndSelectTab(0);
        break;
      case 'End':
        event.preventDefault();
        focusAndSelectTab(items.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      className={listClassName}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          type="button"
          role="tab"
          id={`${tabIdPrefix}-${item.id}`}
          className={item.id === activeId ? activeTabClassName : tabClassName}
          aria-selected={item.id === activeId}
          aria-controls={`${panelIdPrefix}-${item.id}`}
          tabIndex={activeIndex === index ? 0 : -1}
          style={
            item.accentToken
              ? ({ '--roving-tab-accent': `var(${item.accentToken})` } as CSSProperties)
              : undefined
          }
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => handleTabKeyDown(event, index)}
        >
          {renderContent ? (
            renderContent(item)
          ) : (
            <span className="roving-tab__label-row">
              {item.icon ? (
                <span className="roving-tab__icon-shell" aria-hidden="true">
                  <SemanticIcon name={item.icon} className="roving-tab__icon" />
                </span>
              ) : null}
              <span className="roving-tab__label-text">{item.label}</span>
              {item.description ? <small>{item.description}</small> : null}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
