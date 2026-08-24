/**
 * Bulk clean 1:1 traffic -- the filler every realistic dataset needs.
 *
 * Two jobs. It is the baseline population for the **recall guard** (T0.4): every pair here is a
 * true match with a known partner, so any drop in recall is unambiguous. And it is the volume
 * knob for the **perf harness** (T0.2): scale this scenario to 4,000 or 9,000 pairs and the
 * dataset reaches the plan's stated workload without becoming an all-clean synthetic set, since
 * the defect scenarios compose alongside it.
 */
import { createRng } from '../rng';
import type { Fragment, Scenario, ScenarioContext } from '../types';

const PAYEES = [
  'Sterling Screening',
  'Cascade Office Park',
  'Northline Telecom',
  'Bluepeak Insurance',
  'Harbor Point Utilities',
  'Redwood Legal Group',
  'Vantage Job Boards',
  'Ironside Facilities',
] as const;

export interface CleanPairsOptions {
  /** How many clean 1:1 pairs to emit per period. */
  pairsPerPeriod: number;
}

export const cleanPairs = (options: CleanPairsOptions): Scenario => ({
  id: 'clean-pairs',
  description: 'Clean 1:1 bank/GL pairs with matching amount, date, and payee text.',
  minPeriods: 1,
  build(context: ScenarioContext, rngSeed: number): Fragment {
    const rng = createRng(rngSeed).fork(context.seedLabel);
    const fragment: Fragment = { bank: [], gl: [], expect: [] };

    for (let period = 0; period < context.periodCount; period += 1) {
      for (let index = 0; index < options.pairsPerPeriod; index += 1) {
        const payee = rng.pick(PAYEES);
        // Integer cents throughout, converted to dollars only at the edge -- the plan's
        // money-as-integer-cents rule applies to the fixtures too, or the expected amounts
        // drift from what the engine computes.
        const cents = rng.int(2_500, 480_000);
        const amount = cents / 100;
        const dayOffset = rng.int(0, 27);
        const bankKey = `${context.keyPrefix}-b${period}-${index}`;
        const glKey = `${context.keyPrefix}-g${period}-${index}`;

        fragment.bank.push({
          key: bankKey,
          period,
          dayOffset,
          description: payee.toUpperCase(),
          debit: amount,
        });
        fragment.gl.push({
          key: glKey,
          period,
          dayOffset,
          type: 'Bill Payment',
          name: payee,
          memo: `${payee} invoice`,
          amount: -amount,
        });
        fragment.expect.push({
          kind: 'match',
          bank: [bankKey],
          gl: [glKey],
          cardinality: '1:1',
          note: 'Same amount, same date, same payee text -- must resolve in P1.',
        });
      }
    }

    return fragment;
  },
});
