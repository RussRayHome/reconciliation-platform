import type { ReactNode } from 'react';

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
