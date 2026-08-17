import { useState, type ReactNode } from 'react';

/** Shared status-tone building blocks used across the Developer Dashboard's own "Testing &
 *  verification" panels and the Code Health sections (Complexity, Dependency Cruiser).
 *  DeveloperDashboard.tsx composes those sections in via import, so having it also export these
 *  primitives back to them created a real circular import -- caught by this very dashboard's own
 *  Dependency Cruiser check while building it. */

export type Verdict = 'pass' | 'fail' | 'warn' | 'neutral';

export function StatusPill({ verdict, label }: Readonly<{ verdict: Verdict; label: string }>) {
  return <span className={`status-pill status-pill--${verdict}`}>{label}</span>;
}

/** Shared shell for every "Testing & verification" section below the overview cards: a header
 *  (title + subtitle) and a collapse arrow on the right, so the whole section's body can be
 *  closed without losing its place -- useful once several sections are open at once and the page
 *  gets long. Collapsing unmounts the body rather than hiding it with CSS, so a collapsed
 *  section's own internal state (e.g. CoveragePanel's "show remaining files") resets on
 *  re-expand; deliberate, keeps this wrapper simple, and matches how the per-band
 *  Show/Hide toggles inside SecretIntegrityPanel already behave. */
export function DetailPanel({
  id,
  title,
  subtitle,
  children,
}: Readonly<{
  id: string;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}>) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="detail-panel" id={id}>
      <div className="detail-panel__head">
        <h3>{title}</h3>
        <div className="detail-panel__head-right">
          <span className="detail-panel__sub">{subtitle}</span>
          <button
            type="button"
            className="detail-panel__collapse-toggle"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
            onClick={() => setCollapsed((current) => !current)}
          >
            <svg
              className={`detail-panel__collapse-icon${collapsed ? ' detail-panel__collapse-icon--collapsed' : ''}`}
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 6L8 10L12 6"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      {collapsed ? null : children}
    </div>
  );
}
