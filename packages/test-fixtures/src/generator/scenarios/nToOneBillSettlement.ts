/**
 * One payment clearing several vendor bills -- the defining AP cardinality.
 *
 * A single bank debit settles three payables at once. On the GL side that is three separate
 * bill-payment lines sharing a payee and a date; on the bank side it is one debit for the total.
 *
 * Why this scenario matters beyond its own assertion: with a `billId` on each GL line (WS1) the
 * engine resolves this **group-first** -- `GROUP BY billId -> SUM -> COMPARE`, deterministic and
 * O(1) per group. Without it, the only route is bounded subset-sum over a pruned pool, which is
 * slower, lower-precision, and prone to finding a *different* subset that happens to sum the
 * same. Running this scenario before and after WS1 is the cleanest available measurement of what
 * the canonical identifiers actually buy.
 *
 * The three amounts are chosen so no proper subset of them sums to the same total as any other
 * subset -- a decoy-free baseline. A separate scenario should later add a deliberate decoy set to
 * prove the engine picks the right subset and not merely a plausible one.
 */
import type { Fragment, Scenario, ScenarioContext } from '../types';

const BILLS = [
  { suffix: 'a', amount: 1_240.0, invoice: 'INV-88401' },
  { suffix: 'b', amount: 875.5, invoice: 'INV-88407' },
  { suffix: 'c', amount: 2_310.25, invoice: 'INV-88422' },
] as const;

export const nToOneBillSettlement = (): Scenario => ({
  id: 'n-to-one-bill-settlement',
  description: 'One bank debit settles three vendor bills posted as separate GL lines.',
  minPeriods: 1,
  build(context: ScenarioContext): Fragment {
    const p = context.keyPrefix;
    const vendor = 'Meridian Talent Partners';
    const dayOffset = 11;
    const totalCents = BILLS.reduce((sum, bill) => sum + Math.round(bill.amount * 100), 0);
    const total = totalCents / 100;

    return {
      bank: [
        {
          key: `${p}-payment`,
          period: 0,
          dayOffset,
          description: 'ACH MERIDIAN TALENT PARTNERS',
          reference: 'ACH-55120',
          debit: total,
        },
      ],
      gl: BILLS.map((bill) => ({
        key: `${p}-bill-${bill.suffix}`,
        period: 0,
        dayOffset,
        type: 'Bill Payment',
        num: bill.invoice,
        name: vendor,
        memo: `${vendor} ${bill.invoice}`,
        amount: -bill.amount,
      })),
      expect: [
        {
          kind: 'match',
          bank: [`${p}-payment`],
          gl: BILLS.map((bill) => `${p}-bill-${bill.suffix}`),
          cardinality: '1:N',
          note: `One ACH of ${total.toFixed(2)} settles three bills; group-first on a shared bill/vendor key once WS1 lands.`,
        },
      ],
    };
  },
});
