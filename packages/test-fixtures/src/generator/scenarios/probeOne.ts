/**
 * Probe-1 -- the stolen-member regression fixture (task T0.3, plan §2.15.2, defects D3/D4).
 *
 * Shape: one bank deposit of 300 that is genuinely the sum of two GL lines (100 + 200), plus an
 * unrelated second bank deposit of 200.
 *
 * The defect: `matching/engine.ts` emits an `ExactMatch` and `continue`s **before** the
 * grouped-reserved guard, so the unrelated bank 200 pairs off with the GL 200 first and steals it
 * out of the group. The 300 then has nothing left to group with and is reported missing.
 *
 * Correct behaviour, asserted below: the 300 resolves against 100 + 200 as one group, and the
 * unrelated 200 is the row left unmatched. **This scenario is expected to FAIL until WS2's global
 * assignment lands** -- commit it red (xfail) and let it flip green as the acceptance signal.
 */
import type { Fragment, Scenario, ScenarioContext } from '../types';

export const probeOne = (): Scenario => ({
  id: 'probe-one',
  description:
    'D3 stolen member: a 1:1 exact match must not steal a component out of a valid group.',
  minPeriods: 1,
  build(context: ScenarioContext): Fragment {
    const p = context.keyPrefix;

    return {
      bank: [
        { key: `${p}-grouped-300`, period: 0, dayOffset: 9, description: 'DEPOSIT BATCH 4471', credit: 300 },
        { key: `${p}-lone-200`, period: 0, dayOffset: 14, description: 'DEPOSIT WESTGATE CLINIC', credit: 200 },
      ],
      gl: [
        { key: `${p}-part-100`, period: 0, dayOffset: 9, type: 'Deposit', name: 'Fairmont Staffing', memo: 'Client receipt Fairmont', amount: 100 },
        { key: `${p}-part-200`, period: 0, dayOffset: 9, type: 'Deposit', name: 'Alder Health', memo: 'Client receipt Alder', amount: 200 },
      ],
      expect: [
        {
          kind: 'match',
          bank: [`${p}-grouped-300`],
          gl: [`${p}-part-100`, `${p}-part-200`],
          cardinality: '1:N',
          note: 'The 300 deposit is 100 + 200 pooled. The group must survive the 1:1 pass.',
        },
        {
          kind: 'exception',
          row: `${p}-lone-200`,
          category: 'MissingFromGL',
          side: 'book',
          note: 'The unrelated 200 is the row genuinely without a partner -- not the 300.',
        },
        {
          kind: 'noAutoClear',
          row: `${p}-lone-200`,
          reason:
            'Pairing this against the GL 200 is the D3 defect: it clears the wrong thing and breaks a valid group.',
        },
      ],
    };
  },
});
