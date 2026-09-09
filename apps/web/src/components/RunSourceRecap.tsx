import { sourceTabs, type SourceTabId } from '../lib/sourceTabs';

/**
 * The persistent "IN THIS RUN" strip beneath the source tab panel (README 1a).
 *
 * It exists because the tab strip only shows one panel at a time: without a recap, a user on the
 * AR tab cannot see whether they ever attached the GL workbook, and the only feedback that the run
 * is short of something is the Submit button's reason at the bottom of the screen.
 *
 * Reads the same counts the tab meta lines read, so the strip and the recap cannot disagree.
 */
export function RunSourceRecap({
  attachedBySource,
}: Readonly<{ attachedBySource: Record<SourceTabId, number> }>) {
  return (
    <div className="run-source-recap">
      <p className="run-source-recap__label">In this run</p>
      <ul className="run-source-recap__list">
        {sourceTabs.map((tab) => {
          const count = attachedBySource[tab.id];
          return (
            <li
              key={tab.id}
              className={
                count > 0 ? 'run-source-recap__item' : 'run-source-recap__item run-source-recap__item--empty'
              }
            >
              <span
                className="run-source-recap__dot"
                style={count > 0 ? { background: `var(${tab.hueToken})` } : undefined}
              />
              {/* "none", not "0": a zero reads as a shortfall on a type the run may not need at
                  all. Same reasoning as the rail's badge rule and the tab meta lines. */}
              {`${tab.label} · ${count > 0 ? count : 'none'}`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
