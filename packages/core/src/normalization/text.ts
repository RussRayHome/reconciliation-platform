import { createHash } from 'node:crypto';

import type { TextNormalizationConfig } from '@recon/domain';

const punctuationPattern = /[^A-Z0-9\s]/g;

/**
 * A hyphen between two LETTERS, which is a spelling variant of one word (Issue #310).
 *
 * `punctuationPattern` turns every non-alphanumeric into a space, so "WAL-MART" became the two
 * tokens WAL and MART and scored 0.33 against "WALMART". Joining them scores 0.80.
 *
 * Letters on BOTH sides is the deliberately narrow rule. An earlier draft allowed alphanumerics and
 * regressed a real fixture: bank "WIRE VENDOR ALPHA INV-993" matched GL "Invoice 993 payment"
 * through the shared token 993, and joining INV-993 into INV993 destroyed it, so the pair stopped
 * linking and its AmountMismatch exception disappeared. A hyphen next to digits separates parts that
 * carry meaning on their own ("INV-993", "2025-03-04"); a hyphen between letters does not.
 * Separator hyphens ("ACME - INVOICE 4471") keep their spaces and never match this.
 */
const intraWordHyphenPattern = /(?<=[A-Z])-(?=[A-Z])/g;

/**
 * Applies text normalization rules from `config` to a raw string value.
 * Steps are applied in order: uppercase → strip punctuation → collapse whitespace → remove stop words.
 * Returns an empty string for null/undefined input.
 */
export const normalizeText = (
  value: string | undefined,
  config: TextNormalizationConfig,
): string => {
  if (!value) {
    return '';
  }

  let output = value;
  if (config.uppercase) {
    output = output.toUpperCase();
  }

  if (config.stripPunctuation) {
    // Join before splitting: the hyphen has to be removed while its neighbours are still visible.
    output = output.replace(intraWordHyphenPattern, '').replace(punctuationPattern, ' ');
  }

  if (config.collapseWhitespace) {
    output = output.replace(/\s+/g, ' ').trim();
  }

  if (config.removeStopWords) {
    const stopWords = new Set(config.stopWords.map((word) => word.toUpperCase()));
    output = output
      .split(' ')
      .filter((token) => token && !stopWords.has(token))
      .join(' ');
  }

  return output.trim();
};

/**
 * Normalizes each value in `values`, splits on whitespace, deduplicates, and returns a
 * sorted token array used for token-similarity scoring during matching.
 * Empty and undefined values are silently skipped.
 */
export const buildComparisonTokens = (
  values: Array<string | undefined>,
  config: TextNormalizationConfig,
): string[] => {
  const tokenSet = new Set<string>();

  values
    .map((value) => normalizeText(value, config))
    .filter(Boolean)
    .forEach((value) => {
      value.split(' ').forEach((token) => {
        if (token) {
          tokenSet.add(token);
        }
      });
    });

  return [...tokenSet].sort();
};

/** Shared duplicate-detection fingerprint, extracted from `normalization/transactions.ts` (Issue
 * #137) so both the old normalization pathway and the new File Validation adapter
 * (`fileValidation/toNormalizedTransactions.ts`) compute it identically. */
export const buildContextFingerprint = (
  parts: Array<string | number | undefined | null>,
): string =>
  createHash('sha1')
    .update(parts.filter((part) => part !== undefined && part !== null).join('|'))
    .digest('hex');
