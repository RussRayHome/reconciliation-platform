/**
 * Calendar math for the generator. Periods are calendar months, because that is the
 * reconciliation period the platform actually models (`reconciliation_run_account` carries
 * `period_year` / `period_month`).
 *
 * Everything here is pure integer arithmetic over an explicit anchor. Nothing reads the system
 * clock: an argument-less `new Date()` would make the fixtures differ by the day they were
 * generated, which defeats the whole point of a deterministic recall guard.
 */

/** Anchor for period 0, as a calendar month. */
export interface PeriodAnchor {
  year: number;
  /** 1-12. */
  month: number;
}

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export const daysInMonth = (year: number, month: number): number =>
  month === 2 && isLeapYear(year) ? 29 : (DAYS_PER_MONTH[month - 1] as number);

/** The calendar month `offset` periods after the anchor. */
export const periodMonth = (anchor: PeriodAnchor, offset: number): PeriodAnchor => {
  const zeroBased = anchor.month - 1 + offset;
  const year = anchor.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  return { year, month };
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * ISO date for a day inside a period. `dayOffset` is 0-based from the 1st; offsets past the end
 * of the month clamp to the last day rather than spilling into the next period -- a scenario
 * that says "day 30" means "late in the period", and silently moving it into the next period
 * would corrupt that scenario's own period expectations.
 */
export const periodDate = (
  anchor: PeriodAnchor,
  period: number,
  dayOffset: number,
): string => {
  const { year, month } = periodMonth(anchor, period);
  const lastDay = daysInMonth(year, month);
  const day = Math.min(Math.max(dayOffset, 0) + 1, lastDay);
  return `${year}-${pad2(month)}-${pad2(day)}`;
};

/** Inclusive ISO date bounds of a period -- the declared period_start / period_end a run
 *  asserts against (changeset 0061). */
export const periodBounds = (
  anchor: PeriodAnchor,
  period: number,
): { start: string; end: string } => {
  const { year, month } = periodMonth(anchor, period);
  return {
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
  };
};
