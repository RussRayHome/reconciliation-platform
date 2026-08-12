import { useMemo, useState } from 'react';

import { DetailPanel, StatusPill, type Verdict } from './StatusPrimitives';

/** One function/method's complexity metrics -- mirrors apps/api's ComplexityMethod. escomplex has
 *  no nesting-depth or exit-point count, so those columns from the original design spec are
 *  omitted rather than estimated (per that spec's own guidance). */
export type ComplexityMethod = {
  name: string;
  cc: number;
  lines: number;
  params: number;
  startLine: number;
};

/** One node in the scan's directory tree -- mirrors apps/api's ComplexityNode. */
export type ComplexityNode =
  | { type: 'dir'; name: string; children: ComplexityNode[] }
  | { type: 'file'; name: string; lines: number; methods: ComplexityMethod[] };

/** Whole-repo complexity scan payload -- mirrors apps/api's ComplexityScan. */
export type ComplexityScan = {
  scannedAt: string;
  root: ComplexityNode;
};

const WARN_THRESHOLD = 11;
const CRIT_THRESHOLD = 21;

type Risk = 'low' | 'moderate' | 'high' | 'critical';

const RISK_TONE: Record<Risk, Verdict> = {
  low: 'pass',
  moderate: 'neutral',
  high: 'warn',
  critical: 'fail',
};

const RISK_LABEL: Record<Risk, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical',
};

/** Same 4-tier scale the design spec calls for, remapped onto this dashboard's existing
 *  status-pill tones instead of introducing new colors -- every badge/bar/count in this section
 *  resolves through this one function, so moving the thresholds moves everything together. */
const riskFor = (cc: number): { tier: Risk; tone: Verdict; label: string } => {
  const tier: Risk = cc >= CRIT_THRESHOLD ? 'critical' : cc >= WARN_THRESHOLD ? 'high' : cc >= 6 ? 'moderate' : 'low';
  return { tier, tone: RISK_TONE[tier], label: RISK_LABEL[tier] };
};

const RISK_BAR_CLASS: Record<Risk, string> = {
  low: '',
  moderate: 'bar__fill--moderate',
  high: 'bar__fill--warn',
  critical: 'bar__fill--bad',
};

type MethodEntry = { method: ComplexityMethod; filePath: string };

/** Recursively collects every method in a subtree with its owning file's path, for the
 *  distribution histogram and worst-offenders list (both scoped to the current drill path). */
const collectMethods = (node: ComplexityNode, prefix: string): MethodEntry[] => {
  if (node.type === 'file') {
    const filePath = prefix ? `${prefix}/${node.name}` : node.name;
    return node.methods.map((method) => ({ method, filePath }));
  }
  const nextPrefix = prefix ? `${prefix}/${node.name}` : node.name;
  return node.children.flatMap((child) => collectMethods(child, nextPrefix));
};

const countFiles = (node: ComplexityNode): number =>
  node.type === 'file' ? 1 : node.children.reduce((sum, child) => sum + countFiles(child), 0);

type ScopeAggregate = {
  files: number;
  methods: number;
  lines: number;
  maxCc: number;
  avgCc: number;
  overGate: number;
  entries: MethodEntry[];
};

const aggregate = (node: ComplexityNode, prefix: string): ScopeAggregate => {
  const entries = collectMethods(node, prefix);
  const ccs = entries.map((entry) => entry.method.cc);
  const lines =
    node.type === 'file' ? node.lines : entries.reduce((sum, entry) => sum + entry.method.lines, 0);

  return {
    files: countFiles(node),
    methods: entries.length,
    lines,
    maxCc: ccs.length ? Math.max(...ccs) : 0,
    avgCc: ccs.length ? ccs.reduce((sum, cc) => sum + cc, 0) / ccs.length : 0,
    overGate: ccs.filter((cc) => cc >= WARN_THRESHOLD).length,
    entries,
  };
};

const nodeAt = (root: ComplexityNode, path: string[]): ComplexityNode => {
  let current = root;
  for (const segment of path) {
    if (current.type !== 'dir') break;
    const next = current.children.find((child) => child.name === segment);
    if (!next) break;
    current = next;
  }
  return current;
};

type SortKey = 'name' | 'cc' | 0 | 1 | 2;
type SortDir = 'asc' | 'desc';

type Selected = { method: ComplexityMethod; filePath: string };

const BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
  { label: '1–5', lo: 1, hi: 5 },
  { label: '6–10', lo: 6, hi: 10 },
  { label: '11–20', lo: 11, hi: 20 },
  { label: '21+', lo: 21, hi: Number.POSITIVE_INFINITY },
];

function ComplexityBar({ cc, maxCc }: Readonly<{ cc: number; maxCc: number }>) {
  const pct = maxCc > 0 ? Math.round((cc / maxCc) * 100) : 0;
  const tier = riskFor(cc).tier;
  return (
    <span className="bar">
      <i className={RISK_BAR_CLASS[tier]} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  );
}

function MethodDetailPanel({
  selected,
  onClose,
}: Readonly<{ selected: Selected; onClose: () => void }>) {
  const { method, filePath } = selected;
  const risk = riskFor(method.cc);

  return (
    <div className="detail-panel detail-panel--accent" id="complexity-method-detail">
      <div className="detail-panel__head">
        <h3>Method detail</h3>
        <div className="detail-panel__head-right">
          <button type="button" className="detail-panel__expand" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <div className="mono complexity__detail-name">
        {method.name}()<div className="complexity__detail-path">{`${filePath}:${method.startLine}`}</div>
      </div>
      <div className="complexity__score-row">
        <span className="complexity__score" style={{ color: `var(--complexity-${risk.tier})` }}>
          {method.cc}
        </span>
        <StatusPill verdict={risk.tone} label={risk.label} />
      </div>
      <div className="complexity__tiles">
        <div className="complexity__tile">
          <span>Lines</span>
          <strong>{method.lines}</strong>
        </div>
        <div className="complexity__tile">
          <span>Params</span>
          <strong>{method.params}</strong>
        </div>
      </div>
      <p className="detail-panel__empty">
        {method.cc >= CRIT_THRESHOLD
          ? `Above the ${CRIT_THRESHOLD} gate — split the branch cascade before refactoring further.`
          : method.cc >= WARN_THRESHOLD
            ? `Approaching the gate. Reducing branching would drop this under ${WARN_THRESHOLD}.`
            : 'Within budget. No action needed.'}
      </p>
    </div>
  );
}

/** Developer Dashboard "Code Health — Cyclomatic Complexity" section: drill-down from service to
 *  directory to file to method, with sort/filter/at-risk toggle, a distribution histogram, a
 *  worst-offenders list, and a method detail panel. Reads the "Complexity" check's escomplex scan
 *  published by dashboard-status.yml -- there is no live re-scan, matching every other section on
 *  this dashboard. */
export function ComplexityPanel({ scan }: Readonly<{ scan: ComplexityScan | null | undefined }>) {
  const [path, setPath] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('cc');
  const [dir, setDir] = useState<SortDir>('desc');
  const [query, setQuery] = useState('');
  const [riskyOnly, setRiskyOnly] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);

  const node = scan ? nodeAt(scan.root, path) : null;
  const scope = useMemo(() => (node ? aggregate(node, path.slice(0, -1).join('/')) : null), [node, path]);
  const isFile = node?.type === 'file';

  const rows = useMemo(() => {
    if (!node) return [];
    const q = query.trim().toLowerCase();

    type Row = {
      key: string;
      name: string;
      tag: string;
      cc: number;
      cells: Array<number | string>;
      onActivate: () => void;
    };

    let built: Row[];
    if (node.type === 'file') {
      built = node.methods.map((method) => ({
        key: method.name,
        name: `${method.name}()`,
        tag: `L${method.startLine}`,
        cc: method.cc,
        cells: [method.lines, method.params],
        onActivate: () => setSelected({ method, filePath: path.join('/') }),
      }));
    } else {
      built = node.children.map((child) => {
        const childAgg = aggregate(child, path.join('/'));
        return {
          key: child.name,
          name: child.name,
          tag: child.type === 'file' ? `L${child.lines}` : '',
          cc: childAgg.maxCc,
          cells: [
            child.type === 'dir' ? childAgg.files : '—',
            childAgg.methods,
            childAgg.lines.toLocaleString(),
          ],
          onActivate: () => setPath((current) => [...current, child.name]),
        };
      });
    }

    let filtered = q ? built.filter((row) => row.name.toLowerCase().includes(q)) : built;
    if (riskyOnly) filtered = filtered.filter((row) => row.cc >= WARN_THRESHOLD);

    const keyOf = (row: Row): string | number =>
      sort === 'name' ? row.name.toLowerCase() : sort === 'cc' ? row.cc : Number(row.cells[sort]) || 0;
    const sorted = [...filtered].sort((a, b) => {
      const x = keyOf(a);
      const y = keyOf(b);
      const cmp = x > y ? 1 : x < y ? -1 : 0;
      return dir === 'desc' ? -cmp : cmp;
    });

    return sorted;
  }, [node, path, query, riskyOnly, sort, dir]);

  if (!scan || !node || !scope) {
    return (
      <div className="developer-dashboard__section-head" id="complexity">
        <h2>Code health — Cyclomatic Complexity</h2>
        <span className="developer-dashboard__section-sub">No complexity scan available for this run.</span>
      </div>
    );
  }

  const maxRowCc = Math.max(1, ...rows.map((row) => row.cc));
  const crumbs = [{ label: 'reconciliation-platform', targetLen: 0 }, ...path.map((segment, i) => ({ label: segment, targetLen: i + 1 }))];

  const bucketMax = Math.max(1, ...BUCKETS.map((b) => scope.entries.filter((e) => e.method.cc >= b.lo && e.method.cc <= b.hi).length));
  const buckets = BUCKETS.map((b) => {
    const count = scope.entries.filter((e) => e.method.cc >= b.lo && e.method.cc <= b.hi).length;
    return { ...b, count, pct: Math.round((count / bucketMax) * 100) };
  });

  const hotspots = [...scope.entries].sort((a, b) => b.method.cc - a.method.cc).slice(0, 6);

  const headerDefs: Array<{ key: SortKey | null; label: string }> = isFile
    ? [
        { key: 'name', label: 'Method' },
        { key: 0, label: 'Lines' },
        { key: 1, label: 'Params' },
        { key: 'cc', label: 'CC' },
        { key: null, label: 'Risk' },
        { key: null, label: '' },
      ]
    : [
        { key: 'name', label: 'Path' },
        { key: 0, label: 'Files' },
        { key: 1, label: 'Methods' },
        { key: 2, label: 'Lines' },
        { key: 'cc', label: 'Max CC' },
        { key: null, label: 'Risk' },
        { key: null, label: '' },
      ];

  return (
    <>
      <div className="developer-dashboard__section-head" id="complexity">
        <h2>Code health — Cyclomatic Complexity</h2>
        <span className="developer-dashboard__section-sub">
          Scanned {new Date(scan.scannedAt).toLocaleString('en-US', { hour12: false })} · escomplex
        </span>
      </div>

      <div className="overview-cards complexity__stats">
        <div className="overview-card">
          <div className="overview-card__head">
            <h3>Avg complexity</h3>
          </div>
          <span className="overview-card__big">{scope.avgCc.toFixed(1)}</span>
          <span className="overview-card__stats">per function</span>
        </div>
        <div className="overview-card">
          <div className="overview-card__head">
            <h3>Peak</h3>
          </div>
          <span className="overview-card__big" style={{ color: `var(--complexity-${riskFor(scope.maxCc).tier})` }}>
            {scope.maxCc}
          </span>
          <span className="overview-card__stats">max cc</span>
        </div>
        <div className="overview-card">
          <div className="overview-card__head">
            <h3>Over gate</h3>
          </div>
          <span className="overview-card__big">{scope.overGate}</span>
          <span className="overview-card__stats">of {scope.methods} functions</span>
        </div>
        <div className="overview-card">
          <div className="overview-card__head">
            <h3>In scope</h3>
          </div>
          <span className="overview-card__big">{scope.files}</span>
          <span className="overview-card__stats">{scope.lines.toLocaleString()} loc</span>
        </div>
      </div>

      <div className="complexity__grid">
        <div className="complexity__main">
        <div className="detail-panel">
          <div className="complexity__toolbar">
            <div className="complexity__breadcrumb">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${crumb.targetLen}`}>
                  <button
                    type="button"
                    className="complexity__crumb"
                    onClick={() => {
                      setPath((current) => current.slice(0, crumb.targetLen));
                      setSelected(null);
                    }}
                  >
                    {crumb.label}
                  </button>
                  {index < crumbs.length - 1 ? <span className="complexity__crumb-sep">/</span> : null}
                </span>
              ))}
            </div>
            <div className="complexity__toolbar-controls">
              <input
                type="text"
                className="complexity__filter"
                placeholder="filter…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className={`complexity__risky-toggle${riskyOnly ? ' complexity__risky-toggle--active' : ''}`}
                onClick={() => setRiskyOnly((current) => !current)}
              >
                at-risk only
              </button>
            </div>
          </div>

          <div className="detail-panel__table-wrap">
            <table>
              <thead>
                <tr>
                  {headerDefs.map((header) => (
                    <th key={header.label} className={header.key !== 'name' && header.key !== null ? 'num' : undefined}>
                      {header.key === null ? (
                        header.label
                      ) : (
                        <button
                          type="button"
                          className="complexity__sort-button"
                          onClick={() => {
                            setDir(sort === header.key && dir === 'desc' ? 'asc' : 'desc');
                            setSort(header.key as SortKey);
                          }}
                        >
                          {header.label}
                          {sort === header.key ? (dir === 'desc' ? ' ▾' : ' ▴') : ''}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const risk = riskFor(row.cc);
                  return (
                    <tr key={row.key} onClick={row.onActivate} className="complexity__row">
                      <td className="mono">
                        {row.name} <span className="complexity__tag">{row.tag}</span>
                      </td>
                      {row.cells.map((cell, index) => (
                        <td key={`${row.key}-cell-${index}`} className="num">
                          {cell}
                        </td>
                      ))}
                      <td className="num" style={{ color: `var(--complexity-${risk.tier})` }}>
                        {row.cc}
                      </td>
                      <td>
                        <StatusPill verdict={risk.tone} label={risk.label} />
                      </td>
                      <td>
                        <ComplexityBar cc={row.cc} maxCc={maxRowCc} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? <p className="detail-panel__empty">No matches at this level.</p> : null}
          <div className="table-results-meta">
            <span>
              {rows.length} {isFile ? 'methods' : 'entries'}
            </span>
            <span>{isFile ? 'method level' : path.length ? 'directory level' : 'service level'}</span>
          </div>
        </div>

        <DetailPanel id="complexity-hotspots" title="Worst offenders" subtitle="Top 6 by cc">
          {hotspots.length === 0 ? (
            <p className="detail-panel__empty">No functions in scope.</p>
          ) : (
            <div className="detail-panel__table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Function</th>
                    <th>File</th>
                    <th className="num">CC</th>
                    <th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {hotspots.map((entry) => {
                    const risk = riskFor(entry.method.cc);
                    return (
                      <tr
                        key={`${entry.filePath}:${entry.method.name}:${entry.method.startLine}`}
                        className="complexity__row"
                        onClick={() => {
                          setPath(entry.filePath.split('/'));
                          setSelected({ method: entry.method, filePath: entry.filePath });
                        }}
                      >
                        <td className="mono">{entry.method.name}()</td>
                        <td className="mono complexity__hotspot-file">{entry.filePath}</td>
                        <td className="num" style={{ color: `var(--complexity-${risk.tier})` }}>
                          {entry.method.cc}
                        </td>
                        <td>
                          <StatusPill verdict={risk.tone} label={risk.label} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DetailPanel>
        </div>

        <div className="complexity__rail">
          {selected ? <MethodDetailPanel selected={selected} onClose={() => setSelected(null)} /> : null}

          <DetailPanel id="complexity-distribution" title="Distribution in scope" subtitle={`${scope.methods} functions`}>
            <div className="complexity__buckets">
              {buckets.map((bucket) => (
                <div key={bucket.label} className="complexity__bucket-row">
                  <span className="complexity__bucket-label">{bucket.label}</span>
                  <span className="bar complexity__bucket-bar">
                    <i style={{ width: `${bucket.pct}%` }} />
                  </span>
                  <span className="complexity__bucket-count">{bucket.count}</span>
                </div>
              ))}
            </div>
          </DetailPanel>

          <DetailPanel id="complexity-legend" title="Thresholds" subtitle="">
            <div className="complexity__legend">
              {(['low', 'moderate', 'high', 'critical'] as const).map((tier) => {
                const ranges: Record<Risk, string> = {
                  low: '1–5',
                  moderate: `6–${WARN_THRESHOLD - 1}`,
                  high: `${WARN_THRESHOLD}–${CRIT_THRESHOLD - 1}`,
                  critical: `${CRIT_THRESHOLD}+`,
                };
                return (
                  <div key={tier} className="complexity__legend-row">
                    <span className="complexity__legend-swatch" style={{ background: `var(--complexity-${tier})` }} />
                    <span>{tier}</span>
                    <span className="complexity__legend-range">{ranges[tier]}</span>
                  </div>
                );
              })}
            </div>
          </DetailPanel>
        </div>
      </div>
    </>
  );
}
