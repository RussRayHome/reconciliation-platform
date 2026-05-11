import type { ReactNode } from 'react';

/**
 * A metric tile for the reconciliation summary dashboard.
 *
 * @param label   - Short descriptor rendered above the value (e.g. "Exact Matches").
 * @param value   - The primary metric to display prominently.
 * @param tone    - Colour treatment: `positive` = green, `warning` = amber, `critical` = red.
 * @param helper  - Optional sub-text rendered below the value (e.g. a percentage or context note).
 * @param icon    - Optional React node rendered in the card header (decorative; aria-hidden).
 * @param iconLabel - Tooltip text for the icon shell element.
 */
interface StatCardProps {
  label: string;
  value: string | number;
  tone?: 'default' | 'positive' | 'warning' | 'critical';
  helper?: string;
  icon?: ReactNode;
  iconLabel?: string;
}

export const StatCard = ({
  label,
  value,
  tone = 'default',
  helper,
  icon,
  iconLabel,
}: StatCardProps) => (
  <article className={`stat-card stat-card--${tone}`}>
    <div className="stat-card__header">
      <span className="stat-card__label">{label}</span>
      {icon ? (
        <span className="stat-card__icon-shell" title={iconLabel} aria-hidden="true">
          {icon}
        </span>
      ) : null}
    </div>
    <strong className="stat-card__value">{value}</strong>
    {helper ? <span className="stat-card__helper">{helper}</span> : null}
  </article>
);
