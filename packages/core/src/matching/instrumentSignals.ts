import type { NormalizedTransaction } from '@recon/domain';

/** Word-boundary regexes for each keyword, built once -- a raw substring check (e.g.
 * `.includes('wire')`) false-positives on any word that happens to contain the letters in
 * sequence, such as "wireless", "hardwire", or "rewired", misclassifying unrelated transactions
 * as wire transfers. Mirrors the technique in `exceptionClassifierStages.ts`'s
 * `ACH_RETURN_KEYWORD_PATTERNS`. Keywords are expected in upper case; callers upper-case the text
 * they test against instead of relying on a regex `i` flag, so both sides agree on one case. */
export const buildWordBoundaryPatterns = (keywords: string[]): RegExp[] =>
  keywords.map((keyword) => new RegExp(`\\b${keyword}\\b`));

const CARD_KEYWORDS = [
  'CREDIT CARD',
  'CREDITCARD',
  'CREDIT CARD PMT',
  'CC PMT',
  'CARD PAYMENT',
  'CARD PMT',
  'MERCHANT SERVICES',
  'MERCH FEE',
  'BANKCARD',
];

const WIRE_KEYWORDS = ['WIRE', 'FEDWIRE', 'SWIFT', 'CORRESPONDENT', 'WIRE REF', 'WIRE TRANSFER'];

const CARD_PATTERNS = buildWordBoundaryPatterns(CARD_KEYWORDS);
const WIRE_PATTERNS = buildWordBoundaryPatterns(WIRE_KEYWORDS);

const narrativeText = (transaction: NormalizedTransaction): string =>
  [transaction.description, transaction.merchantName, transaction.payeeName]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toUpperCase();

const matchesAnyPattern = (patterns: RegExp[], text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));

/** True when either the structured GL transaction type or the bank/GL narrative text (description,
 * merchant name, payee name) carries card-payment evidence. Checks the structured field first --
 * `transactionType` is clean and 100% populated on the GL side of real data -- and falls back to
 * the narrative text second, since bank-side descriptions vary by institution and carry no
 * structured type at all. */
export const isCardLikeTransaction = (transaction: NormalizedTransaction): boolean => {
  const transactionType = (transaction.transactionType ?? '').toUpperCase();
  if (matchesAnyPattern(CARD_PATTERNS, transactionType)) {
    return true;
  }
  return matchesAnyPattern(CARD_PATTERNS, narrativeText(transaction));
};

/** True when either the structured GL transaction type or the bank/GL narrative text carries
 * wire-transfer evidence. See `isCardLikeTransaction` for the structured-field-first rationale. */
export const isWireLikeTransaction = (transaction: NormalizedTransaction): boolean => {
  const transactionType = (transaction.transactionType ?? '').toUpperCase();
  if (matchesAnyPattern(WIRE_PATTERNS, transactionType)) {
    return true;
  }
  return matchesAnyPattern(WIRE_PATTERNS, narrativeText(transaction));
};
