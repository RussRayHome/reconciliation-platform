import type { ReactNode } from 'react';

type BentoSpan = 3 | 4 | 6 | 8 | 12;

/** Dashboard module wrapper: surface background, hairline border, 12px radius, hover border lift. */
export function BentoModule({
  title,
  span,
  accent = false,
  ariaLabel,
  children,
}: Readonly<{
  title?: string;
  span: BentoSpan;
  accent?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}>) {
  const classes = ['bento-module', `bento-module--span-${span}`];

  if (accent) {
    classes.push('bento-module--accent');
  }

  return (
    <section className={classes.join(' ')} aria-label={ariaLabel ?? title}>
      {title ? <h3 className="bento-module__title">{title}</h3> : null}
      {children}
    </section>
  );
}
