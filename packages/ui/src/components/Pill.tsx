import type { PropsWithChildren } from 'react';

interface PillProps extends PropsWithChildren {
  tone?: 'neutral' | 'positive' | 'warning' | 'critical';
}

export const Pill = ({ tone = 'neutral', children }: PillProps) => (
  <span className={`pill pill--${tone}`}>{children}</span>
);
