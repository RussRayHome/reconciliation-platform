import type { PropsWithChildren, ReactNode } from 'react';

interface SectionCardProps extends PropsWithChildren {
  title: string;
  description?: string;
  actions?: ReactNode;
}

/** Titled content card with an optional description and action slot, used to group related UI sections. */
export const SectionCard = ({ title, description, actions, children }: SectionCardProps) => (
  <section className="section-card">
    <div className="section-card__header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="section-card__actions">{actions}</div> : null}
    </div>
    <div className="section-card__body">{children}</div>
  </section>
);
