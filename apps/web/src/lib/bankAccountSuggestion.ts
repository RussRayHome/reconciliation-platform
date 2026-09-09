import type { ReconciliationAccount } from '@recon/domain';
import { parseBankAccountLast4FromFilename } from '@recon/domain';

/**
 * Filename-based assignment suggestions (A-D1, Issue #338).
 *
 * A filename may *suggest* an account and nothing more: it cannot establish identity, override an
 * assignment, or select configuration. These helpers exist to keep that boundary in one place --
 * everything here narrows the operator's choice, nothing here makes it.
 */

/** Every active account a filename could plausibly refer to. All matches, deliberately: returning
 * only the first is what A-D1 forbids. */
export const candidatesForFilename = (
  filename: string,
  accounts: readonly ReconciliationAccount[],
): ReconciliationAccount[] => {
  const lastFour = parseBankAccountLast4FromFilename(filename);
  if (lastFour === null) return [];
  return accounts.filter((account) => account.isActive && account.lastFour === lastFour);
};

/**
 * The account to pre-select for a newly-staged file, or null to leave the operator to choose.
 *
 * A suggestion is offered only when exactly one active account matches. Two accounts sharing a
 * last four is a case A-D1 names outright -- "never choose the first match automatically" -- so an
 * ambiguous filename yields no pre-selection rather than a coin flip the operator has to notice
 * was wrong.
 */
export const suggestAccountIdForFilename = (
  filename: string,
  accounts: readonly ReconciliationAccount[],
): string | null => {
  const candidates = candidatesForFilename(filename, accounts);
  return candidates.length === 1 ? candidates[0]!.id : null;
};
