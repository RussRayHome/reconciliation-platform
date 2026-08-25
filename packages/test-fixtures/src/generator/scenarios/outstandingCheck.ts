/**
 * Outstanding check -- the canonical cross-period open item, and the reason the generator is
 * multi-period rather than single-period.
 *
 * A check is written and posted to the GL in period 0 but does not present at the bank until
 * period 1. In period 0 it is a **bank-side** reconciling item: real, correct on the books, and
 * requiring no entry. It opens a `reconciliation_open_item` (changeset 0063) that must survive
 * into period 1 and clear there against the presenting bank debit.
 *
 * The `naturalKeyTier: 1` assertion is the part a hand-written fixture usually misses. Carry-
 * forward that works for the wrong reason is a latent defect: this item carries a check number on
 * both sides, so it must re-identify on tier 1. Resolving it via the tier-3 same-day/amount/token
 * fingerprint would still "pass" a naive carry-forward test while being wrong -- fingerprints
 * collide across periods in a way check numbers do not.
 */
import type { Fragment, Scenario, ScenarioContext } from '../types';

export const outstandingCheck = (): Scenario => ({
  id: 'outstanding-check',
  description:
    'Check posted to the GL in period 0, presents at the bank in period 1; opens and clears an open item.',
  minPeriods: 2,
  build(context: ScenarioContext): Fragment {
    const p = context.keyPrefix;
    const amount = 1_600;
    const checkNumber = '1052';

    return {
      bank: [
        {
          key: `${p}-presents-p1`,
          period: 1,
          dayOffset: 2,
          description: `CHECK ${checkNumber}`,
          checkNumber,
          debit: amount,
        },
      ],
      gl: [
        {
          key: `${p}-written-p0`,
          period: 0,
          dayOffset: 24,
          type: 'Check',
          num: checkNumber,
          name: 'Cascade Office Park',
          memo: 'Branch rent - Tacoma',
          amount: -amount,
        },
      ],
      expect: [
        {
          kind: 'exception',
          row: `${p}-written-p0`,
          category: 'OutstandingCheck',
          side: 'bank',
          note: 'Period 0: correct on the books, not yet at the bank. Timing only -- no entry.',
        },
        {
          kind: 'openItem',
          row: `${p}-written-p0`,
          category: 'OutstandingCheck',
          opensInPeriod: 0,
          clearsInPeriod: 1,
          naturalKeyTier: 1,
          note: 'Check number is present on both sides, so re-identification must be tier 1.',
        },
        {
          kind: 'match',
          bank: [`${p}-presents-p1`],
          gl: [`${p}-written-p0`],
          cardinality: '1:1',
          note: 'Clears in period 1 against the GL row from period 0 -- a cross-period match.',
        },
      ],
    };
  },
});
