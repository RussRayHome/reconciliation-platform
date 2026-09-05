import type { PayeeAlias, TextNormalizationConfig } from '@recon/domain';

import { buildComparisonTokens } from '../normalization/text';

/**
 * Built-in payee aliases (Issue #311, PR A).
 *
 * The alias table shipped fully wired and empty -- nothing populated it, so the only mechanism that
 * can bridge an abbreviation (`AMZN` -> Amazon) never fired. These defaults are the starter set. They
 * live in CODE, not in per-organization rows, which dissolves the per-tenant-vs-global question the
 * issue raised: defaults are global by being versioned here, and an organization's own rows are the
 * per-tenant layer on top. The service merges `[...organizationAliases, ...defaults]` so an
 * organization row always precedes a default of the same score (the lookup's tie-break keeps
 * list order on an exact tie), and `DEFAULT_PAYEE_ALIAS_CONFIDENCE` sits below an authored row's 1.0
 * so an organization alias also wins on effective similarity downstream.
 *
 * CURATION RULES -- the lookup scores by containment (#313), so a one-token pattern matches any
 * descriptor that contains it. That is exactly what makes a distinctive merchant token work and
 * exactly what makes a generic one dangerous. Every entry must be:
 *   - a merchant identifier a human would read as that merchant with no other context
 *     (`AMZN`, `DOORDASH`), never a banking term (`POS`, `DEBIT`, `FEE`) or a payment-rail word
 *     (`TRANSFER`, `DEPOSIT`) -- those would alias half the ledger to one payee;
 *   - not a common English word on its own (`TARGET` and `APPLE` are omitted; `SHELL` is qualified as `SHELL OIL`);
 *   - not a stop word of the default normalization config, which would be stripped from every
 *     descriptor and never match;
 *   - at least two characters, since the token comparison is exact-only below three.
 * defaultPayeeAliases.test.ts enforces the mechanical parts of that.
 *
 * Deliberately conservative: a missing default costs a probable-match review, a wrong default
 * mislabels a payee across every run. Add entries here, not to the table, when they hold for every
 * customer.
 */
export const DEFAULT_PAYEE_ALIAS_SEEDS: ReadonlyArray<{
  bankPattern: string;
  canonicalPayeeName: string;
}> = [
  { bankPattern: 'AMZN', canonicalPayeeName: 'Amazon' },
  { bankPattern: 'AMAZON', canonicalPayeeName: 'Amazon' },
  { bankPattern: 'SQ', canonicalPayeeName: 'Square' },
  { bankPattern: 'TST', canonicalPayeeName: 'Toast' },
  { bankPattern: 'PAYPAL', canonicalPayeeName: 'PayPal' },
  { bankPattern: 'VENMO', canonicalPayeeName: 'Venmo' },
  { bankPattern: 'ZELLE', canonicalPayeeName: 'Zelle' },
  { bankPattern: 'STRIPE', canonicalPayeeName: 'Stripe' },
  { bankPattern: 'UBER', canonicalPayeeName: 'Uber' },
  { bankPattern: 'LYFT', canonicalPayeeName: 'Lyft' },
  { bankPattern: 'DOORDASH', canonicalPayeeName: 'DoorDash' },
  { bankPattern: 'GRUBHUB', canonicalPayeeName: 'Grubhub' },
  { bankPattern: 'COSTCO', canonicalPayeeName: 'Costco' },
  { bankPattern: 'WALMART', canonicalPayeeName: 'Walmart' },
  { bankPattern: 'WAL MART', canonicalPayeeName: 'Walmart' },
  { bankPattern: 'HOMEDEPOT', canonicalPayeeName: 'Home Depot' },
  { bankPattern: 'HOME DEPOT', canonicalPayeeName: 'Home Depot' },
  { bankPattern: 'LOWES', canonicalPayeeName: "Lowe's" },
  { bankPattern: 'STARBUCKS', canonicalPayeeName: 'Starbucks' },
  { bankPattern: 'USPS', canonicalPayeeName: 'USPS' },
  { bankPattern: 'FEDEX', canonicalPayeeName: 'FedEx' },
  { bankPattern: 'COMCAST', canonicalPayeeName: 'Comcast' },
  { bankPattern: 'XFINITY', canonicalPayeeName: 'Comcast' },
  { bankPattern: 'VERIZON', canonicalPayeeName: 'Verizon' },
  { bankPattern: 'TMOBILE', canonicalPayeeName: 'T-Mobile' },
  { bankPattern: 'NETFLIX', canonicalPayeeName: 'Netflix' },
  { bankPattern: 'SPOTIFY', canonicalPayeeName: 'Spotify' },
  { bankPattern: 'GOOGLE', canonicalPayeeName: 'Google' },
  { bankPattern: 'MSFT', canonicalPayeeName: 'Microsoft' },
  { bankPattern: 'MICROSOFT', canonicalPayeeName: 'Microsoft' },
  { bankPattern: 'SHELL OIL', canonicalPayeeName: 'Shell' },
  { bankPattern: 'CHEVRON', canonicalPayeeName: 'Chevron' },
];

/** Below an authored row's 1.0, so an organization alias wins on effective similarity too. */
export const DEFAULT_PAYEE_ALIAS_CONFIDENCE = 0.9;

/**
 * Materialise the seeds as `PayeeAlias` rows for one run, tokenised with THAT run's text
 * normalization -- the same function the engine applies to every descriptor -- so a default can never
 * disagree with the engine about what its own pattern's tokens are. Ids are stable and namespaced so
 * evidence text and any future persistence can tell a default from an authored row.
 */
export const buildDefaultPayeeAliases = (config: TextNormalizationConfig): PayeeAlias[] =>
  DEFAULT_PAYEE_ALIAS_SEEDS.map((seed) => ({
    id: `default:${seed.bankPattern.toLowerCase().replace(/\s+/g, '-')}`,
    bankPattern: seed.bankPattern,
    canonicalPayeeName: seed.canonicalPayeeName,
    normalizedTokens: buildComparisonTokens([seed.bankPattern], config),
    sourceDirection: 'bank_to_gl' as const,
    matchConfidence: DEFAULT_PAYEE_ALIAS_CONFIDENCE,
    isActive: true,
  })).filter((alias) => alias.normalizedTokens.length > 0);
