/**
 * Composes scenario fragments into a multi-period dataset plus its answer key.
 *
 * Responsibilities the scenarios deliberately do NOT have, because none of them is knowable until
 * every fragment is in hand:
 *   - real calendar dates (scenarios declare a period + day offset)
 *   - bank `Sequence Number` (must be unique and ascending within each period's file)
 *   - bank `Balance` (a running total across the whole dataset, not per period)
 *   - row ordering (deterministic: date, then key)
 *
 * Column order matters -- the File Validation Engine runs a `checkColumnOrder` structural gate --
 * so rows are emitted strictly in `BANKING_HEADERS` / `GL_HEADERS` order, imported from
 * `@recon/core` rather than copied. Importing beats mirroring-plus-a-drift-test: a column added
 * to the real header breaks this file at compile time instead of at the next test run.
 */
import { BANKING_HEADERS, GL_HEADERS } from '@recon/core';

import { periodBounds, periodDate, type PeriodAnchor } from './periods';
import { createRng } from './rng';
import type { Expectation, Fragment, Scenario } from './types';


/** Where a scenario's named row actually landed once dates and ordering were assigned. */
export interface ResolvedRow {
  key: string;
  side: 'bank' | 'gl';
  period: number;
  /** 1-based position within that period's file, excluding the header row -- the same frame
   *  `NormalizedRecord.sourceLineNumber` uses, so scorer output points at a real line. */
  lineNumber: number;
  date: string;
  /** Signed, cash-impact frame, on both sides. */
  signedAmount: number;
}

export interface PeriodFiles {
  period: number;
  bounds: { start: string; end: string };
  bankRows: string[][];
  glRows: string[][];
}

export interface Dataset {
  seed: number;
  anchor: PeriodAnchor;
  periodCount: number;
  scenarioIds: string[];
  periods: PeriodFiles[];
  /** Row key -> where it landed. Plain object, not a Map, so a dataset serializes as-is. */
  rows: Record<string, ResolvedRow>;
  answerKey: Expectation[];
}

export interface ComposeOptions {
  seed: number;
  anchor: PeriodAnchor;
  periodCount: number;
  scenarios: Scenario[];
  /** Bank balance before the first period's first row. */
  openingBalance?: number;
}

const money = (value: number): string => value.toFixed(2);

/** Cents-safe accumulation -- summing dollars as floats drifts, and the balance column is one of
 *  the few places a fixture can silently disagree with itself. */
const addMoney = (a: number, b: number): number =>
  (Math.round(a * 100) + Math.round(b * 100)) / 100;

export const compose = (options: ComposeOptions): Dataset => {
  const { seed, anchor, periodCount, scenarios } = options;
  const openingBalance = options.openingBalance ?? 100_000;

  if (periodCount < 1) {
    throw new RangeError(`periodCount must be at least 1; got ${periodCount}`);
  }

  const fragments: Fragment[] = [];
  const seenIds = new Set<string>();

  for (const scenario of scenarios) {
    if (seenIds.has(scenario.id)) {
      throw new Error(
        `Duplicate scenario id "${scenario.id}". Ids are used as key prefixes, so they must be unique within a dataset.`,
      );
    }
    seenIds.add(scenario.id);

    if (scenario.minPeriods > periodCount) {
      // Refusing beats silently emitting a carry-forward that has nowhere to carry to.
      throw new Error(
        `Scenario "${scenario.id}" needs at least ${scenario.minPeriods} periods; dataset has ${periodCount}.`,
      );
    }

    fragments.push(
      scenario.build(
        { keyPrefix: scenario.id, seedLabel: scenario.id, periodCount },
        seed,
      ),
    );
  }

  // One namespace for every row key across both sides -- an expectation names a key, not a side,
  // so a bank row and a GL row sharing a key would make the answer key ambiguous.
  const rows: Record<string, ResolvedRow> = {};
  const claimKey = (key: string): void => {
    if (rows[key]) {
      throw new Error(`Duplicate row key "${key}" -- row keys must be unique across the dataset.`);
    }
  };

  interface PendingBank {
    key: string;
    date: string;
    description: string;
    checkNumber: string;
    reference: string;
    debit: number | null;
    credit: number | null;
  }
  interface PendingGl {
    key: string;
    date: string;
    type: string;
    num: string;
    name: string;
    memo: string;
    amount: number;
  }

  const bankByPeriod: PendingBank[][] = Array.from({ length: periodCount }, () => []);
  const glByPeriod: PendingGl[][] = Array.from({ length: periodCount }, () => []);

  for (const fragment of fragments) {
    for (const spec of fragment.bank) {
      claimKey(spec.key);
      const hasDebit = spec.debit !== undefined;
      const hasCredit = spec.credit !== undefined;
      if (hasDebit === hasCredit) {
        throw new Error(
          `Bank row "${spec.key}" must set exactly one of debit/credit (got debit=${String(spec.debit)}, credit=${String(spec.credit)}).`,
        );
      }
      rows[spec.key] = {
        key: spec.key,
        side: 'bank',
        period: spec.period,
        lineNumber: 0, // assigned after ordering
        date: periodDate(anchor, spec.period, spec.dayOffset),
        signedAmount: hasDebit ? -(spec.debit as number) : (spec.credit as number),
      };
      bankByPeriod[spec.period]?.push({
        key: spec.key,
        date: rows[spec.key]!.date,
        description: spec.description,
        checkNumber: spec.checkNumber ?? '',
        reference: spec.reference ?? '',
        debit: hasDebit ? (spec.debit as number) : null,
        credit: hasCredit ? (spec.credit as number) : null,
      });
    }

    for (const spec of fragment.gl) {
      claimKey(spec.key);
      rows[spec.key] = {
        key: spec.key,
        side: 'gl',
        period: spec.period,
        lineNumber: 0,
        date: periodDate(anchor, spec.period, spec.dayOffset),
        signedAmount: spec.amount,
      };
      glByPeriod[spec.period]?.push({
        key: spec.key,
        date: rows[spec.key]!.date,
        type: spec.type,
        num: spec.num ?? '',
        name: spec.name ?? '',
        memo: spec.memo,
        amount: spec.amount,
      });
    }
  }

  // Deterministic ordering: date first (realistic), then key (stable tie-break). Never insertion
  // order -- that would make row numbers depend on scenario registration order.
  const byDateThenKey = <T extends { date: string; key: string }>(a: T, b: T): number =>
    a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date);

  let balance = openingBalance;
  const periods: PeriodFiles[] = [];

  for (let period = 0; period < periodCount; period += 1) {
    const bankPending = [...(bankByPeriod[period] ?? [])].sort(byDateThenKey);
    const glPending = [...(glByPeriod[period] ?? [])].sort(byDateThenKey);

    const bankRows: string[][] = [[...BANKING_HEADERS]];
    bankPending.forEach((row, index) => {
      const lineNumber = index + 1;
      rows[row.key]!.lineNumber = lineNumber;
      balance = addMoney(balance, row.credit ?? -(row.debit ?? 0));
      bankRows.push([
        row.date,
        row.description,
        String(lineNumber),
        row.checkNumber,
        row.reference,
        row.debit === null ? '' : money(row.debit),
        row.credit === null ? '' : money(row.credit),
        money(balance),
      ]);
    });

    const glRows: string[][] = [[...GL_HEADERS]];
    glPending.forEach((row, index) => {
      rows[row.key]!.lineNumber = index + 1;
      glRows.push([row.date, row.type, row.num, row.name, row.memo, money(row.amount)]);
    });

    periods.push({ period, bounds: periodBounds(anchor, period), bankRows, glRows });
  }

  const answerKey = fragments.flatMap((fragment) => fragment.expect);

  // Every expectation must name a row that exists. A typo'd key would otherwise make the scorer
  // silently skip an assertion, which is the one failure mode a test harness must never have.
  for (const expectation of answerKey) {
    const referenced =
      expectation.kind === 'match'
        ? [...expectation.bank, ...expectation.gl]
        : [expectation.row];
    for (const key of referenced) {
      if (!rows[key]) {
        throw new Error(
          `Answer key references unknown row "${key}" in a "${expectation.kind}" expectation.`,
        );
      }
    }
  }

  // Touch the RNG once with the dataset-level seed so the seed is provably part of the output
  // contract even for datasets built entirely from deterministic scenarios.
  createRng(seed).next();

  return {
    seed,
    anchor,
    periodCount,
    scenarioIds: scenarios.map((scenario) => scenario.id),
    periods,
    rows,
    answerKey,
  };
};
