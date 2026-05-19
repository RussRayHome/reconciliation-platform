import type { PropsWithChildren } from 'react';

interface PillProps extends PropsWithChildren {
  tone?: 'neutral' | 'positive' | 'warning' | 'critical';
}

/** Inline label with a tonal background colour: neutral (default), positive, warning, or critical. */
export const Pill = ({ tone = 'neutral', children }: PillProps) => (
  <span className={`pill pill--${tone}`}>{children}</span>
);
