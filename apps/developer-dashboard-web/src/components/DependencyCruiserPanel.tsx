import { useMemo, useState } from 'react';

import { DetailPanel, StatusPill, type Verdict } from './StatusPrimitives';

/** One module in the dependency graph -- mirrors apps/api's DependencyModule. */
export type DependencyModule = {
  name: string;
  folder: string;
  loc: number;
  deps: string[];
  fanIn: number;
  fanOut: number;
  instability: number;
  cyclic: boolean;
};

/** One dependency-cruiser rule violation -- mirrors apps/api's DependencyViolation. */
export type DependencyViolation = {
  id: string;
  sev: 'error' | 'warn' | 'info';
  from: string;
  to: string;
  note: string;
};

/** Whole-repo dependency scan payload -- mirrors apps/api's DependencyScan. */
export type DependencyScan = {
  scannedAt: string;
  modules: DependencyModule[];
  violations: DependencyViolation[];
};

/** Above this module count in the current scope, the NxN matrix stops being readable -- the
 *  design's own guidance is to default to a folder scope beyond it rather than render an
 *  unreadable grid. This repo has 255 internal modules across ~11 workspaces, so this limit is
 *  reached immediately at the "all" scope in practice. */
const MATRIX_READABLE_LIMIT = 40;

const shortName = (name: string): string => name.split('/').pop() ?? name;

const SEVERITY_TONE: Record<DependencyViolation['sev'], Verdict> = {
  error: 'fail',
  warn: 'warn',
  info: 'neutral',
};

type DepSortKey = 'name' | 'fanIn' | 'fanOut' | 'instability';
type DepView = 'table' | 'graph';

function InstabilityBar({ instability }: Readonly<{ instability: number }>) {
  const toneClass = instability > 0.7 ? 'bar__fill--warn' : instability > 0.35 ? 'bar__fill--moderate' : '';
  return (
    <span className="bar">
      <i className={toneClass} style={{ width: `${Math.round(Math.min(1, Math.max(0, instability)) * 100)}%` }} />
    </span>
  );
}

const statusFor = (module: DependencyModule, hasViolation: boolean): { label: string; tone: Verdict } => {
  if (module.cyclic) return { label: 'Cycle', tone: 'fail' };
  if (hasViolation) return { label: 'Rule', tone: 'warn' };
  if (module.fanIn === 0 && module.fanOut === 0) return { label: 'Orphan', tone: 'neutral' };
  return { label: 'Clean', tone: 'pass' };
};

/** Developer Dashboard "Code Health — Dependency Cruiser" section: fan-in/fan-out/instability per
 *  module in a sortable table, a dependency matrix graph view, folder-scope chips, and a
 *  rule-violations rail. Reads the "Dependencies" check's dependency-cruiser scan published by
 *  dashboard-status.yml -- there is no live re-scan, matching every other section on this
 *  dashboard. */
export function DependencyCruiserPanel({ scan }: Readonly<{ scan: DependencyScan | null | undefined }>) {
  const [folder, setFolder] = useState('all');
  const [view, setView] = useState<DepView>('table');
  const [sort, setSort] = useState<DepSortKey>('fanIn');
  const [hover, setHover] = useState<string | null>(null);

  const folders = useMemo(
    () => (scan ? ['all', ...Array.from(new Set(scan.modules.map((m) => m.folder))).sort()] : []),
    [scan],
  );

  const scoped = useMemo(
    () => (scan ? (folder === 'all' ? scan.modules : scan.modules.filter((m) => m.folder === folder)) : []),
    [scan, folder],
  );

  const violationsByModule = useMemo(() => {
    const map = new Map<string, DependencyViolation[]>();
    for (const violation of scan?.violations ?? []) {
      const list = map.get(violation.from) ?? [];
      list.push(violation);
      map.set(violation.from, list);
    }
    return map;
  }, [scan]);

  const rows = useMemo(() => {
    const sortKey = (m: DependencyModule): number | string =>
      sort === 'name' ? m.name.toLowerCase() : sort === 'instability' ? m.instability : m[sort];
    return [...scoped].sort((a, b) => {
      const x = sortKey(a);
      const y = sortKey(b);
      if (sort === 'name') return x < y ? -1 : x > y ? 1 : 0;
      return (y as number) - (x as number);
    });
  }, [scoped, sort]);

  if (!scan) {
    return (
      <div className="developer-dashboard__section-head" id="dependencies">
        <h2>Code health — Dependency Cruiser</h2>
        <span className="developer-dashboard__section-sub">No dependency scan available for this run.</span>
      </div>
    );
  }

  const cycleCount = scan.modules.filter((m) => m.cyclic).length;
  const orphanCount = scan.modules.filter((m) => m.fanIn === 0 && m.fanOut === 0).length;
  const edgeCount = scan.modules.reduce((sum, m) => sum + m.fanOut, 0);
  const errorCount = scan.violations.filter((v) => v.sev === 'error').length;

  const matrixModules = folder === 'all' ? [] : scoped;
  const showMatrix = view === 'graph' && matrixModules.length > 0 && matrixModules.length <= MATRIX_READABLE_LIMIT;
  const matrixIndex = new Map(matrixModules.map((m) => [m.name, m]));

  return (
    <div className="dependency">
      <div className="developer-dashboard__section-head" id="dependencies">
        <h2>Code health — Dependency Cruiser</h2>
        <span className="developer-dashboard__section-sub">
          Scanned {new Date(scan.scannedAt).toLocaleString('en-US', { hour12: false })} · dependency-cruiser
        </span>
      </div>

      <div className="overview-cards dependency__stats">
        <div className="overview-card">
          <div className="overview-card__head">
            <h3>Modules</h3>
          </div>
          <span className="overview-card__big">{scoped.length}</span>
          <span className="overview-card__stats">in scope</span>
        </div>
        <div className="overview-card">
          <div className="overview-card__head">
            <h3>Dependencies</h3>
          </div>
          <span className="overview-card__big">{edgeCount}</span>
          <span className="overview-card__stats">edges</span>
        </div>
        <div className="overview-card">
          <div className="overview-card__head">
            <h3>Circular</h3>
          </div>
          <span className="overview-card__big" style={{ color: cycleCount ? 'var(--negative)' : 'var(--accent)' }}>
            {cycleCount}
          </span>
          <span className="overview-card__stats">modules</span>
        </div>
        <div className="overview-card">
          <div className="overview-card__head">
            <h3>Rule breaks</h3>
          </div>
          <span className="overview-card__big" style={{ color: errorCount ? 'var(--negative)' : 'var(--severity-high)' }}>
            {scan.violations.length}
          </span>
          <span className="overview-card__stats">{errorCount} errors</span>
        </div>
        <div className="overview-card">
          <div className="overview-card__head">
            <h3>Orphans</h3>
          </div>
          <span className="overview-card__big" style={{ color: orphanCount ? 'var(--severity-high)' : 'var(--accent)' }}>
            {orphanCount}
          </span>
          <span className="overview-card__stats">unreferenced</span>
        </div>
      </div>

      <div className="dependency__grid">
        <div className="detail-panel">
          <div className="dependency__toolbar">
            <div className="dependency__chips">
              {folders.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`dependency__chip${folder === f ? ' dependency__chip--active' : ''}`}
                  onClick={() => {
                    setFolder(f);
                    setHover(null);
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="dependency__toolbar-right">
              <div className="dependency__view-switch">
                <button
                  type="button"
                  className={`dependency__view-button${view === 'table' ? ' dependency__view-button--active' : ''}`}
                  onClick={() => setView('table')}
                >
                  table
                </button>
                <button
                  type="button"
                  className={`dependency__view-button${view === 'graph' ? ' dependency__view-button--active' : ''}`}
                  onClick={() => setView('graph')}
                >
                  graph
                </button>
              </div>
              <span className="dependency__hover-label">
                {hover ?? 'hover a module to trace its edges'}
              </span>
            </div>
          </div>

          {view === 'table' ? (
            <>
              <div className="detail-panel__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th className="num">Loc</th>
                      <th className="num">
                        <button type="button" className="dependency__sort-button" onClick={() => setSort('fanIn')}>
                          Fan-in{sort === 'fanIn' ? ' ▾' : ''}
                        </button>
                      </th>
                      <th className="num">
                        <button type="button" className="dependency__sort-button" onClick={() => setSort('fanOut')}>
                          Fan-out{sort === 'fanOut' ? ' ▾' : ''}
                        </button>
                      </th>
                      <th className="num">
                        <button
                          type="button"
                          className="dependency__sort-button"
                          onClick={() => setSort('instability')}
                        >
                          Instab.{sort === 'instability' ? ' ▾' : ''}
                        </button>
                      </th>
                      <th />
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((module) => {
                      const violations = violationsByModule.get(module.name) ?? [];
                      const status = statusFor(module, violations.length > 0);
                      return (
                        <tr
                          key={module.name}
                          onMouseEnter={() => setHover(module.name)}
                          onMouseLeave={() => setHover(null)}
                        >
                          <td className="mono">{module.name}</td>
                          <td className="num">{module.loc.toLocaleString()}</td>
                          <td className="num">{module.fanIn}</td>
                          <td className="num">{module.fanOut}</td>
                          <td className="num">{module.instability.toFixed(2)}</td>
                          <td>
                            <InstabilityBar instability={module.instability} />
                          </td>
                          <td>
                            <StatusPill verdict={status.tone} label={status.label} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 ? <p className="detail-panel__empty">No modules in scope.</p> : null}
            </>
          ) : showMatrix ? (
            <div className="dependency__matrix-wrap">
              <div className="dependency__matrix-cols">
                <span className="dependency__matrix-gutter" />
                {matrixModules.map((m, i) => (
                  <span
                    key={m.name}
                    className="dependency__matrix-col-index"
                    style={{ color: hover === m.name ? 'var(--text-primary)' : undefined }}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                ))}
              </div>
              {matrixModules.map((rowModule, rowIndex) => (
                <div
                  key={rowModule.name}
                  className="dependency__matrix-row"
                  style={{ background: hover === rowModule.name ? 'var(--bg-raised)' : undefined }}
                  onMouseEnter={() => setHover(rowModule.name)}
                  onMouseLeave={() => setHover(null)}
                >
                  <span
                    className="dependency__matrix-gutter mono"
                    style={{ color: rowModule.cyclic ? 'var(--negative)' : hover === rowModule.name ? 'var(--text-primary)' : undefined }}
                  >
                    <span className="dependency__matrix-row-index">{String(rowIndex + 1).padStart(2, '0')}</span>
                    {shortName(rowModule.name)}
                  </span>
                  {matrixModules.map((colModule) => {
                    const has = rowModule.deps.includes(colModule.name);
                    const back = matrixIndex.get(colModule.name)?.deps.includes(rowModule.name) ?? false;
                    const cyc = has && back;
                    const isDiagonal = rowModule.name === colModule.name;
                    return (
                      <span
                        key={colModule.name}
                        className="dependency__matrix-cell"
                        title={has ? `${rowModule.name} → ${colModule.name}` : undefined}
                      >
                        <span
                          className="dependency__matrix-dot"
                          style={{
                            background: isDiagonal ? 'var(--line-strong)' : cyc ? 'var(--negative)' : has ? 'var(--bank)' : 'transparent',
                            opacity: cyc ? 1 : has ? 0.72 : 1,
                          }}
                        />
                      </span>
                    );
                  })}
                </div>
              ))}
              <div className="dependency__legend">
                <span>
                  <i className="dependency__legend-swatch" style={{ background: 'var(--bank)', opacity: 0.72 }} /> row imports
                  column
                </span>
                <span>
                  <i className="dependency__legend-swatch" style={{ background: 'var(--negative)' }} /> circular pair
                </span>
                <span>
                  <i className="dependency__legend-swatch" style={{ background: 'var(--line-strong)' }} /> self
                </span>
              </div>
            </div>
          ) : (
            <p className="detail-panel__empty">
              {folder === 'all'
                ? `Pick a folder above to view its matrix — "all" has ${scoped.length} modules, too many to render readably (limit ${MATRIX_READABLE_LIMIT}).`
                : `${scoped.length} modules in "${folder}", too many to render readably (limit ${MATRIX_READABLE_LIMIT}).`}
            </p>
          )}

          <div className="table-results-meta">
            <span>{scoped.length} modules</span>
            <span>{folder === 'all' ? 'whole service' : `${folder}/ only`}</span>
          </div>
        </div>

        <div className="dependency__rail">
          <DetailPanel id="dependency-violations" title="Rule violations" subtitle={`${scan.violations.length} total`}>
            {scan.violations.length === 0 ? (
              <p className="detail-panel__empty">No rule violations in the latest scan.</p>
            ) : (
              <div className="dependency__violations">
                {scan.violations.map((violation) => (
                  <div key={`${violation.id}:${violation.from}:${violation.to}`} className="dependency__violation">
                    <div className="dependency__violation-head">
                      <StatusPill verdict={SEVERITY_TONE[violation.sev]} label={violation.sev} />
                      <span className="mono">{violation.id}</span>
                    </div>
                    <div className="dependency__violation-from mono">{violation.from}</div>
                    <div className="dependency__violation-note">{violation.note}</div>
                  </div>
                ))}
              </div>
            )}
          </DetailPanel>

          <div className="detail-panel">
            <div className="detail-panel__head">
              <h3>Reading the metrics</h3>
            </div>
            <p className="detail-panel__empty">
              Fan-in is how many modules import this one; fan-out is how many it imports.
              Instability = fan-out / (fan-in + fan-out) — near 1 means volatile, near 0 means
              heavily depended upon and expensive to change.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
