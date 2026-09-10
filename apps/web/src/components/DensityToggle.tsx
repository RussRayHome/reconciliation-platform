import type { Density } from '../hooks/useDensity';

/**
 * The comfortable/compact display-density control.
 *
 * Extracted from `RunBar` by UI-3 (#402) so it can sit with the table it affects rather than in the
 * run bar at the top of every screen. Nothing about its behaviour changed — `useDensity` still owns
 * the value and its per-user persistence; only where it renders moved.
 *
 * A recessed track with one sliding thumb (R3 X5), so it reads as a single control rather than two
 * independent buttons. `radio`/`radiogroup` is the accurate role for a mutually-exclusive choice;
 * `aria-pressed` would describe a pair of toggles.
 */
export function DensityToggle({
  density,
  onChangeDensity,
  className,
}: Readonly<{
  density: Density;
  onChangeDensity: (density: Density) => void;
  /** Lets a host add placement styles without this component knowing where it is. */
  className?: string;
}>) {
  return (
    <div
      className={className ? `density-toggle ${className}` : 'density-toggle'}
      role="radiogroup"
      aria-label="Display density"
      data-density={density}
    >
      <span className="density-toggle__thumb" aria-hidden="true" />
      <button
        type="button"
        role="radio"
        className="density-toggle__option"
        aria-checked={density === 'comfortable'}
        onClick={() => onChangeDensity('comfortable')}
      >
        Comfortable
      </button>
      <button
        type="button"
        role="radio"
        className="density-toggle__option"
        aria-checked={density === 'compact'}
        onClick={() => onChangeDensity('compact')}
      >
        Compact
      </button>
    </div>
  );
}
