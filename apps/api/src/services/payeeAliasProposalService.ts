import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { defaultReconciliationConfig } from '@recon/config';
import { buildComparisonTokens } from '@recon/core';
import type { MatchResult, NormalizedTransaction } from '@recon/domain';
import {
  findPayeeAliasByPattern,
  loadCanonicalTransactionsByIds,
  proposePayeeAlias,
  type CanonicalTransactionText,
} from '@recon/persistence';

/** The persistence surface the proposal touches, injectable so the decision logic is unit-testable
 * without a database. Defaults to the real store functions. */
export interface PayeeAliasProposalStore {
  findPayeeAliasByPattern: typeof findPayeeAliasByPattern;
  loadCanonicalTransactionsByIds: typeof loadCanonicalTransactionsByIds;
  proposePayeeAlias: typeof proposePayeeAlias;
}

export const defaultPayeeAliasProposalStore: PayeeAliasProposalStore = {
  findPayeeAliasByPattern,
  loadCanonicalTransactionsByIds,
  proposePayeeAlias,
};

export interface ProposeAliasFromConfirmedMatchInput {
  pool: Pool;
  organizationId: string;
  runId: string;
  match: MatchResult;
  submittedBy: string;
  /** The run's transactions if this process still holds them (in-memory repository); the
   * persisted canonical rows are the fallback, since another instance may have run the job. */
  inMemoryTransactions?: NormalizedTransaction[];
  store?: PayeeAliasProposalStore;
}

export type ProposeAliasOutcome =
  | { outcome: 'proposed'; aliasId: string; approvalRequestId: string; bankPattern: string; canonicalPayeeName: string }
  | { outcome: 'skipped'; reason: 'transactions-missing' | 'no-bank-text' | 'no-gl-payee' | 'no-tokens' | 'already-known'; detail?: string };

const textOf = (
  transaction: CanonicalTransactionText | NormalizedTransaction | undefined,
): CanonicalTransactionText | undefined =>
  transaction
    ? {
        id: transaction.id,
        source: transaction.source,
        description: transaction.description,
        merchantName: transaction.merchantName,
        payeeName: transaction.payeeName,
        normalizedComparisonTokens: transaction.normalizedComparisonTokens,
      }
    : undefined;

/** Issue #311 (PR B): turns a reviewer's confirmed probable match into a payee-alias PROPOSAL. The
 * reviewer has just said "this bank descriptor IS this GL payee"; that is exactly what an alias
 * encodes, so the pair is recorded as an inactive alias behind a `payeeAlias` approval request --
 * the reviewer proposes, an approver activates, and only then does the engine learn it. Every
 * early return is a deliberate skip, not an error: the decision itself has already been saved and
 * must never fail because a learning side effect could not be derived. */
export const proposeAliasFromConfirmedMatch = async ({
  pool,
  organizationId,
  runId,
  match,
  submittedBy,
  inMemoryTransactions,
  store = defaultPayeeAliasProposalStore,
}: ProposeAliasFromConfirmedMatchInput): Promise<ProposeAliasOutcome> => {
  const ids = [match.bankTransactionId, match.glTransactionId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (ids.length !== 2) {
    return { outcome: 'skipped', reason: 'transactions-missing', detail: 'match lacks a bank/gl id' };
  }

  let bank = textOf(inMemoryTransactions?.find((t) => t.id === match.bankTransactionId));
  let gl = textOf(inMemoryTransactions?.find((t) => t.id === match.glTransactionId));
  if (!bank || !gl) {
    const rows = await store.loadCanonicalTransactionsByIds(pool, organizationId, runId, ids);
    bank = bank ?? rows.find((row) => row.id === match.bankTransactionId);
    gl = gl ?? rows.find((row) => row.id === match.glTransactionId);
  }
  if (!bank || !gl) {
    return { outcome: 'skipped', reason: 'transactions-missing' };
  }

  const bankPattern = bank.description?.trim();
  if (!bankPattern) {
    return { outcome: 'skipped', reason: 'no-bank-text' };
  }
  // The GL side's payee name is the canonical name an alias points at; merchant name and the free
  // description are progressively weaker stand-ins, and a memo-only GL row proposes nothing.
  const canonicalPayeeName = (gl.payeeName ?? gl.merchantName)?.trim();
  if (!canonicalPayeeName) {
    return { outcome: 'skipped', reason: 'no-gl-payee' };
  }

  const normalizedTokens = buildComparisonTokens(
    [bankPattern],
    defaultReconciliationConfig.textNormalization,
  );
  if (normalizedTokens.length === 0) {
    return { outcome: 'skipped', reason: 'no-tokens' };
  }

  const existing = await store.findPayeeAliasByPattern(
    pool,
    organizationId,
    bankPattern,
    canonicalPayeeName,
  );
  if (existing) {
    return {
      outcome: 'skipped',
      reason: 'already-known',
      detail: `${existing.id} (${existing.isActive ? 'active' : 'inactive'})`,
    };
  }

  const { alias, approvalRequest } = await store.proposePayeeAlias(pool, organizationId, {
    accountIdentifier: undefined,
    bankPattern,
    canonicalPayeeName,
    normalizedTokens,
    submittedBy,
    approvalRequestId: randomUUID(),
  });
  return {
    outcome: 'proposed',
    aliasId: alias.id,
    approvalRequestId: approvalRequest.id,
    bankPattern,
    canonicalPayeeName,
  };
};
