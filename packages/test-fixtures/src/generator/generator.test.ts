import { BANKING_HEADERS, GL_HEADERS } from '@recon/core';
import { describe, expect, it } from 'vitest';

import { compose } from './compose';
import { periodDate } from './periods';
import { createRng } from './rng';
import { cleanPairs } from './scenarios/cleanPairs';
import { nToOneBillSettlement } from './scenarios/nToOneBillSettlement';
import { outstandingCheck } from './scenarios/outstandingCheck';
import { probeOne } from './scenarios/probeOne';

const ANCHOR = { year: 2026, month: 1 } as const;

const baseOptions = {
  anchor: ANCHOR,
  periodCount: 2,
  scenarios: [cleanPairs({ pairsPerPeriod: 6 }), outstandingCheck(), nToOneBillSettlement()],
};

describe('generator determinism', () => {
  it('produces byte-identical datasets for the same seed', () => {
    const first = compose({ ...baseOptions, seed: 1234, scenarios: [...baseOptions.scenarios] });
    const second = compose({ ...baseOptions, seed: 1234, scenarios: [...baseOptions.scenarios] });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('produces different data for a different seed', () => {
    const a = compose({ ...baseOptions, seed: 1, scenarios: [...baseOptions.scenarios] });
    const b = compose({ ...baseOptions, seed: 2, scenarios: [...baseOptions.scenarios] });
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
  });

  it('gives each scenario an independent stream, so adding one does not shift another', () => {
    const withoutProbe = compose({ ...baseOptions, seed: 99, scenarios: [cleanPairs({ pairsPerPeriod: 4 })] });
    const withProbe = compose({
      ...baseOptions,
      seed: 99,
      scenarios: [cleanPairs({ pairsPerPeriod: 4 }), probeOne()],
    });
    const cleanRowsOf = (dataset: ReturnType<typeof compose>) =>
      Object.values(dataset.rows)
        .filter((row) => row.key.startsWith('clean-pairs-'))
        .map((row) => `${row.key}:${row.signedAmount}`)
        .sort();
    expect(cleanRowsOf(withProbe)).toEqual(cleanRowsOf(withoutProbe));
  });
});

describe('emitted files', () => {
  const dataset = compose({ ...baseOptions, seed: 7 });

  it('emits headers in the real column order the structural gate checks', () => {
    for (const period of dataset.periods) {
      expect(period.bankRows[0]).toEqual([...BANKING_HEADERS]);
      expect(period.glRows[0]).toEqual([...GL_HEADERS]);
    }
  });

  it('assigns unique ascending sequence numbers within each period', () => {
    for (const period of dataset.periods) {
      const sequences = period.bankRows.slice(1).map((row) => Number(row[2]));
      expect(sequences).toEqual(sequences.map((_, index) => index + 1));
    }
  });

  it('sets exactly one of debit/credit on every bank row', () => {
    for (const period of dataset.periods) {
      for (const row of period.bankRows.slice(1)) {
        const hasDebit = row[5] !== '';
        const hasCredit = row[6] !== '';
        expect(hasDebit).not.toBe(hasCredit);
      }
    }
  });

  it('keeps every row inside its declared period bounds', () => {
    for (const period of dataset.periods) {
      for (const row of [...period.bankRows.slice(1), ...period.glRows.slice(1)]) {
        expect(row[0]! >= period.bounds.start).toBe(true);
        expect(row[0]! <= period.bounds.end).toBe(true);
      }
    }
  });

  it('points every resolved row at its real line number in the emitted file', () => {
    for (const row of Object.values(dataset.rows)) {
      const file = dataset.periods[row.period]!;
      const emitted = (row.side === 'bank' ? file.bankRows : file.glRows)[row.lineNumber];
      expect(emitted?.[0]).toBe(row.date);
    }
  });
});

describe('answer key integrity', () => {
  it('rejects an expectation naming a row that does not exist', () => {
    const broken = {
      id: 'broken',
      description: 'names a row it never built',
      minPeriods: 1,
      build: () => ({
        bank: [],
        gl: [],
        expect: [
          { kind: 'exception' as const, row: 'nope', category: 'MissingFromGL' as const, side: 'book' as const, note: '' },
        ],
      }),
    };
    expect(() => compose({ ...baseOptions, seed: 1, scenarios: [broken] })).toThrow(/unknown row "nope"/);
  });

  it('rejects duplicate scenario ids', () => {
    expect(() =>
      compose({ ...baseOptions, seed: 1, scenarios: [probeOne(), probeOne()] }),
    ).toThrow(/Duplicate scenario id/);
  });

  it('refuses a scenario that needs more periods than the dataset has', () => {
    expect(() =>
      compose({ ...baseOptions, periodCount: 1, seed: 1, scenarios: [outstandingCheck()] }),
    ).toThrow(/needs at least 2 periods/);
  });
});

describe('cross-period scenarios', () => {
  const dataset = compose({ ...baseOptions, seed: 42 });

  it('writes the outstanding check in period 0 and presents it in period 1', () => {
    expect(dataset.rows['outstanding-check-written-p0']!.period).toBe(0);
    expect(dataset.rows['outstanding-check-presents-p1']!.period).toBe(1);
  });

  it('carries a tier-1 open item, because the check number is present on both sides', () => {
    const openItem = dataset.answerKey.find((entry) => entry.kind === 'openItem');
    expect(openItem).toMatchObject({
      category: 'OutstandingCheck',
      opensInPeriod: 0,
      clearsInPeriod: 1,
      naturalKeyTier: 1,
    });
  });
});

describe('probe-1 (T0.3)', () => {
  const dataset = compose({ anchor: ANCHOR, periodCount: 1, seed: 5, scenarios: [probeOne()] });

  it('expects the 300 to group against 100 + 200, not to be reported missing', () => {
    const match = dataset.answerKey.find((entry) => entry.kind === 'match');
    expect(match).toMatchObject({ cardinality: '1:N' });
    expect(match && 'gl' in match ? match.gl : []).toHaveLength(2);
  });

  it('marks the unrelated 200 as the row that must never be auto-cleared', () => {
    const guard = dataset.answerKey.find((entry) => entry.kind === 'noAutoClear');
    expect(guard).toMatchObject({ row: 'probe-one-lone-200' });
  });
});

describe('AP bill settlement', () => {
  it('nets three bills to one bank debit', () => {
    const dataset = compose({ anchor: ANCHOR, periodCount: 1, seed: 3, scenarios: [nToOneBillSettlement()] });
    const bankTotal = -dataset.rows['n-to-one-bill-settlement-payment']!.signedAmount;
    const glTotal = ['a', 'b', 'c'].reduce(
      (sum, suffix) =>
        sum + Math.round(-dataset.rows[`n-to-one-bill-settlement-bill-${suffix}`]!.signedAmount * 100),
      0,
    );
    expect(Math.round(bankTotal * 100)).toBe(glTotal);
  });
});

describe('supporting utilities', () => {
  it('clamps a day offset past month end to the last day of that period', () => {
    expect(periodDate({ year: 2026, month: 2 }, 0, 30)).toBe('2026-02-28');
    expect(periodDate({ year: 2024, month: 2 }, 0, 30)).toBe('2024-02-29');
  });

  it('rolls the period anchor across a year boundary', () => {
    expect(periodDate({ year: 2026, month: 11 }, 3, 0)).toBe('2027-02-01');
  });

  it('derives independent streams per label', () => {
    const rng = createRng(11);
    expect(rng.fork('a').next()).not.toBe(rng.fork('b').next());
    expect(createRng(11).fork('a').next()).toBe(createRng(11).fork('a').next());
  });
});
