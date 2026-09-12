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
 * @param hue   - UI-4: source-hue left edge for the Runs home KPI wells. Carries the same five
 *                hues as the import strip and exception evidence, so a colour means one thing
 *                across the product ([OBJECT] rule 26).
 */
interface StatCardProps {
  label: string;
  value: string | number;
  tone?: 'default' | 'positive' | 'warning' | 'critical';
  helper?: string;
  icon?: ReactNode;
  iconLabel?: string;
  hue?: 'bank' | 'gl' | 'ap' | 'ar' | 'payroll';
}

export const StatCard = ({
  label,
  value,
  tone = 'default',
  helper,
  icon,
  iconLabel,
  hue,
}: StatCardProps) => (
  <article
    className={hue ? `stat-card stat-card--${tone} stat-card--hue-${hue}` : `stat-card stat-card--${tone}`}
  >
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
