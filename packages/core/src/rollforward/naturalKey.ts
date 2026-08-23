import type { NaturalKeyTier, NormalizedTransaction } from '@recon/domain';

export type { NaturalKeyTier };

export interface NaturalKeyResult {
  key: string;
  tier: NaturalKeyTier;
}

const normalizeReferenceNumber = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * Derives the tiered natural key that identifies a carried-forward open item across periods --
 * "what makes a carried check the *same* check next month" (Unreconciled Item Roll-Forward
 * plan, §3.4). Strongest signal first:
 *
 * 1. Check number, when present -- covers the bulk of carried items (205 of 441 GL rows in the
 *    real January fixture are check type) and is the most legally/practically meaningful
 *    identity available: a bank statement's description text for the same check can legitimately
 *    read differently between two months (abbreviation, added detail), but the check number does
 *    not change.
 * 2. Reference/document number + amount, when a check number isn't present but a reference
 *    number is -- the next-strongest structured identity.
 * 3. `contextFingerprint` (already computed per transaction -- see `buildContextFingerprint`,
 *    normalization/text.ts) as a fallback fingerprint for everything else. Confirmed
 *    deterministic and reusable as-is (C.1): its own inputs (source, date, signed amount, check
 *    number, reference number, normalized comparison text) carry no run- or job-specific value,
 *    so the same logical transaction hashes identically whichever run it appears in. This is a
 *    fingerprint, not a guaranteed identity -- it will occasionally fail to recognise the same
 *    item across a genuine description change, and (far more rarely) collide across two
 *    different items. Both failure modes are why Tier 3 exists as its own tier rather than being
 *    silently treated the same as Tier 1/2, and why a Tier-3 open item needs a manual link/unlink
 *    path (PR C.5) rather than being trusted unconditionally.
 *
 * `accountId` is the resolved `reconciliation_account.id`, not the raw free-text
 * `accountIdentifier` -- a natural key is only ever unique within one real bank account (§3.3).
 */
export const deriveNaturalKey = (
  transaction: NormalizedTransaction,
  accountId: string,
): NaturalKeyResult => {
  if (transaction.checkNumber) {
    return { key: `check:${accountId}:${transaction.checkNumber}`, tier: 1 };
  }

  if (transaction.referenceNumber && transaction.amount !== null) {
    return {
      key: `ref:${accountId}:${normalizeReferenceNumber(transaction.referenceNumber)}:${transaction.amount}`,
      tier: 2,
    };
  }

  return { key: `fp:${accountId}:${transaction.contextFingerprint}`, tier: 3 };
};
