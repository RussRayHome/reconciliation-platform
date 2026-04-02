interface StatCardProps {
  label: string;
  value: string | number;
  tone?: 'default' | 'positive' | 'warning' | 'critical';
  helper?: string;
}

export const StatCard = ({ label, value, tone = 'default', helper }: StatCardProps) => (
  <article className={`stat-card stat-card--${tone}`}>
    <span className="stat-card__label">{label}</span>
    <strong className="stat-card__value">{value}</strong>
    {helper ? <span className="stat-card__helper">{helper}</span> : null}
  </article>
);
