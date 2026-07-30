import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

import { BentoModule } from './BentoModule';

/** True once `delayMs` has elapsed; gates skeletons so fast loads never flash them. */
function useDelayedVisible(delayMs = 120): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return visible;
}

/** Single shimmer bar sized to stand in for one piece of real content. */
export function SkeletonBar({
  width,
  height = '0.85rem',
}: Readonly<{ width?: CSSProperties['width']; height?: CSSProperties['height'] }>) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

/**
 * Accessible skeleton container: announces `label` to screen readers and only
 * paints the shimmer children after the 120ms anti-flash delay.
 */
export function SkeletonPanel({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  const showSkeleton = useDelayedVisible();

  return (
    <div className="skeleton-panel" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {showSkeleton ? children : null}
    </div>
  );
}

/** Stack of shimmer lines standing in for text or list rows. */
export function SkeletonLines({
  count,
  lineHeight = '0.85rem',
}: Readonly<{ count: number; lineHeight?: CSSProperties['height'] }>) {
  return (
    <div className="skeleton-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBar key={index} height={lineHeight} width={index === count - 1 ? '62%' : '100%'} />
      ))}
    </div>
  );
}

/** KPI well grid mirroring the real `.kpi-wells` layout. */
export function KpiWellsSkeleton({
  count,
  six = false,
}: Readonly<{ count: number; six?: boolean }>) {
  return (
    <div className={six ? 'kpi-wells kpi-wells--six' : 'kpi-wells'} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="kpi-well">
          <SkeletonBar width="55%" height="0.7rem" />
          <SkeletonBar width="70%" height="var(--kpi-font)" />
        </div>
      ))}
    </div>
  );
}

/** Table stand-in: a sunken header row followed by uniform body rows. */
export function TableSkeleton({ rows, columns }: Readonly<{ rows: number; columns: number }>) {
  const rowStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
  };

  return (
    <div className="skeleton-table" aria-hidden="true">
      <div className="skeleton-table__row skeleton-table__row--head" style={rowStyle}>
        {Array.from({ length: columns }, (_, index) => (
          <SkeletonBar key={index} height="0.7rem" width="70%" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="skeleton-table__row" style={rowStyle}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <SkeletonBar key={columnIndex} width={columnIndex === 0 ? '85%' : '60%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Exception triage stand-in: facet bar plus fixed-height virtualized-style rows. */
export function TriageSkeleton({ rows = 8 }: Readonly<{ rows?: number }>) {
  return (
    <div className="skeleton-triage" aria-hidden="true">
      <div className="skeleton-triage__facets">
        <SkeletonBar width="38%" height="var(--control-height)" />
        <SkeletonBar width="18%" height="var(--control-height)" />
        <SkeletonBar width="18%" height="var(--control-height)" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-triage__row">
          <SkeletonBar width="1rem" height="1rem" />
          <SkeletonBar width="34%" />
          <SkeletonBar width="18%" />
          <SkeletonBar width="12%" />
        </div>
      ))}
    </div>
  );
}

/** Bento summary dashboard stand-in — real modules and titles, shimmer content only. */
export function SummaryDashboardSkeleton() {
  return (
    <div className="bento-grid" aria-hidden="true">
      <BentoModule span={6} title="Verdict">
        <KpiWellsSkeleton count={4} />
      </BentoModule>
      <BentoModule span={3} title="Match quality">
        <SkeletonLines count={4} />
      </BentoModule>
      <BentoModule span={3} title="Materiality" accent>
        <SkeletonBar width="40%" height="2.25rem" />
        <SkeletonLines count={2} />
        <SkeletonBar width="60%" height="var(--control-height)" />
      </BentoModule>
      <BentoModule span={8} title="Exposure by category">
        <SkeletonLines count={6} />
      </BentoModule>
      <BentoModule span={4} title="Watchlist">
        <SkeletonLines count={3} />
      </BentoModule>
    </div>
  );
}
