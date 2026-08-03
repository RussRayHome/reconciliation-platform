import type { CanonicalField } from '@recon/domain';

/**
 * The canonical transaction schema the Create Mapping canvas targets, derived from
 * `BusinessField` — the same vocabulary `NormalizedTransaction`, `reconciliation_canonical_row`,
 * and the excel parser already use. Not persisted; this is fixed schema metadata, not user data.
 */
export const CANONICAL_FIELDS: CanonicalField[] = [
  { id: 'transactionDate', type: 'date', required: true, note: 'Posting or transaction date' },
  { id: 'description', type: 'text', required: true, note: 'Narrative or memo' },
  { id: 'amount', type: 'numeric', required: true, note: 'Signed transaction amount' },
  { id: 'accountIdentifier', type: 'text', required: true, note: 'Account key on both sides' },
  { id: 'postingDate', type: 'date', required: false, note: 'Bank posting date, if distinct' },
  { id: 'transactionType', type: 'text', required: false, note: 'Instrument or channel' },
  { id: 'checkNumber', type: 'text', required: false, note: 'Check number, if applicable' },
  { id: 'serialNumber', type: 'text', required: false, note: 'Serial number, if applicable' },
  { id: 'referenceNumber', type: 'text', required: false, note: 'Document or bank reference' },
  { id: 'merchantName', type: 'text', required: false, note: 'Merchant name, if available' },
  { id: 'payeeName', type: 'text', required: false, note: 'Payee name, if available' },
  { id: 'splitAmount', type: 'numeric', required: false, note: 'Line-level split amount' },
  { id: 'debit', type: 'numeric', required: false, note: 'Debit column, if split from credit' },
  { id: 'credit', type: 'numeric', required: false, note: 'Credit column, if split from debit' },
  { id: 'runningBalance', type: 'numeric', required: false, note: 'Balance after the entry' },
];
