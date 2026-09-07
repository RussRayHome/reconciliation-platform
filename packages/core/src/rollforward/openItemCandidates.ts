import {
  isCarryEligible,
  type ExceptionItem,
  type NormalizedTransaction,
  type OpenItemCandidate,
} from '@recon/domain';

import { deriveNaturalKey } from './naturalKey';

export interface BuildOpenItemCandidatesResult {
  candidates: OpenItemCandidate[];
  /** Carry-eligible exceptions whose `relatedTransactionIds` didn't resolve to a transaction in
   * `normalizedTransactions` -- should not happen in practice (every classified exception traces
   * back to a real transaction in the same run), tracked rather than silently dropped so a caller
   * can log it as a real anomaly if the count is ever non-zero. */
  skippedNoTransaction: number;
  /** Carry-eligible exceptions whose underlying transaction has no `accountIdentifier` -- an open
   * item can't be attributed to an account it doesn't know. */
  skippedNoAccountIdentifier: number;
  /** Carry-eligible exceptions whose underlying transaction has neither a `transactionDate` nor a
   * `postingDate`, or a null `amount` -- reconciliation_open_item requires both NOT NULL. */
  skippedMissingRequiredField: number;
}

/**
 * Reduces this run's carry-eligible exceptions (per `isCarryEligible`, `@recon/domain`'s
 * `CARRY_ELIGIBLE_CATEGORIES`) into `OpenItemCandidate`s -- everything PR C.4's persistence-layer
 * projection (`PostgresOpenItemStore.projectOpenItems`) needs *except* the resolved
 * `reconciliation_account.id`. Since A-D1 (Issue #338) that id is exactly what
 * `NormalizedTransaction.accountIdentifier` carries, so the candidate needs no further resolution
 * -- the persistence layer only asserts the account is one this organization registered.
 *
 * One candidate per carry-eligible exception, keyed to its first related transaction --
 * `relatedTransactionIds` is expected to carry exactly one id for every category this function
 * cares about (OutstandingCheck, StaleOutstandingCheck, DepositInTransit, MissingFromBank,
 * MissingFromGL, TimingDifference, IntercompanyMismatch, NSFReturnedDeposit, AmountMismatch), not
 * a many-transaction grouped result.
 */
export const buildOpenItemCandidates = (
  exceptions: ExceptionItem[],
  normalizedTransactions: NormalizedTransaction[],
): BuildOpenItemCandidatesResult => {
  const transactionById = new Map(
    normalizedTransactions.map((transaction) => [transaction.id, transaction]),
  );

  const candidates: OpenItemCandidate[] = [];
  let skippedNoTransaction = 0;
  let skippedNoAccountIdentifier = 0;
  let skippedMissingRequiredField = 0;

  for (const exception of exceptions) {
    if (!isCarryEligible(exception.category)) {
      continue;
    }

    const transactionId = exception.relatedTransactionIds[0];
    const transaction = transactionId ? transactionById.get(transactionId) : undefined;
    if (!transaction) {
      skippedNoTransaction += 1;
      continue;
    }

    if (!transaction.accountIdentifier) {
      skippedNoAccountIdentifier += 1;
      continue;
    }

    const originalTransactionDate = transaction.transactionDate ?? transaction.postingDate;
    if (!originalTransactionDate || transaction.amount === null) {
      skippedMissingRequiredField += 1;
      continue;
    }

    // Natural key is scoped per real bank account (§3.3). Since A-D1, accountIdentifier already is
    // the registered reconciliation_account.id, so the key is scoped to the account itself rather
    // than to text that merely stands for it -- two accounts sharing a last four can no longer
    // collide into one natural key.
    const { key, tier } = deriveNaturalKey(transaction, transaction.accountIdentifier);

    candidates.push({
      accountIdentifier: transaction.accountIdentifier,
      sourceSystem: transaction.source,
      category: exception.category,
      naturalKey: key,
      naturalKeyTier: tier,
      originalTransactionDate,
      amount: transaction.amount,
      checkNumber: transaction.checkNumber,
      referenceNumber: transaction.referenceNumber,
      descriptionSnapshot: transaction.description,
    });
  }

  return { candidates, skippedNoTransaction, skippedNoAccountIdentifier, skippedMissingRequiredField };
};
