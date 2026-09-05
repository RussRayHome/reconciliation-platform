import { describe, expect, it } from 'vitest';
import { defaultReconciliationConfig } from '@recon/config';

import type { NormalizedTransaction, PayeeAlias } from '@recon/domain';

import {
  DEFAULT_PAYEE_ALIAS_CONFIDENCE,
  DEFAULT_PAYEE_ALIAS_SEEDS,
  buildDefaultPayeeAliases,
} from './defaultPayeeAliases';
import { reconcileMatches } from './engine';
import { buildComparisonTokens } from '../normalization/text';

const textConfig = defaultReconciliationConfig.textNormalization;

const buildTransaction = (overrides: Partial<NormalizedTransaction>): NormalizedTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  runId: overrides.runId ?? 'test-run',
  rawRowId: overrides.rawRowId ?? `${overrides.id ?? 'row'}-raw`,
  sourceFileId: overrides.sourceFileId ?? `${overrides.source ?? 'bank'}-file`,
  source: overrides.source ?? 'bank',
  spreadsheetFileName: overrides.spreadsheetFileName ?? 'test.xlsx',
  worksheetName: overrides.worksheetName ?? 'Sheet1',
  lineNumber: overrides.lineNumber ?? 1,
  transactionDate: overrides.transactionDate,
  postingDate: overrides.postingDate,
  transactionType: overrides.transactionType,
  checkNumber: overrides.checkNumber,
  serialNumber: overrides.serialNumber,
  referenceNumber: overrides.referenceNumber,
  description: overrides.description,
  payeeName: overrides.payeeName,
  amount: overrides.amount ?? 0,
  splitAmount: overrides.splitAmount ?? null,
  debit: overrides.debit ?? null,
  credit: overrides.credit ?? null,
  runningBalance: overrides.runningBalance ?? null,
  normalizedComparisonText: overrides.normalizedComparisonText ?? '',
  normalizedComparisonTokens: overrides.normalizedComparisonTokens ?? [],
  normalizedReferenceTokens: overrides.normalizedReferenceTokens ?? [],
  rawSourceValues: overrides.rawSourceValues ?? {},
  dataQualityIssues: overrides.dataQualityIssues ?? [],
  isExcluded: overrides.isExcluded ?? false,
  exclusionReason: overrides.exclusionReason,
  isZeroAmount: overrides.isZeroAmount ?? false,
  contextFingerprint: overrides.contextFingerprint ?? `${overrides.id ?? 'row'}-fingerprint`,
  accountIdentifier: overrides.accountIdentifier,
  reviewerNotes: overrides.reviewerNotes,
  isCarriedForward: overrides.isCarriedForward,
  carriedFromOpenItemId: overrides.carriedFromOpenItemId,
});


// Words that would alias a large share of any ledger to a single payee. The curation rules in the
// module forbid them; this keeps the list honest as it grows.
const GENERIC_BANKING_TOKENS = new Set([
  'POS', 'DEBIT', 'CREDIT', 'CARD', 'FEE', 'FEES', 'TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'WIRE',
  'CHECK', 'CHK', 'ATM', 'ONLINE', 'PAYMENT', 'PURCHASE', 'ACH', 'AUTOPAY', 'RECURRING', 'BILL',
  'PAY', 'INV', 'INVOICE', 'REF', 'TXN', 'US', 'USA', 'COM', 'WWW', 'THE', 'AND', 'INC', 'LLC',
]);

describe('default payee aliases (Issue #311)', () => {
  const defaults = buildDefaultPayeeAliases(textConfig);

  it('materialises every seed with at least one token under the default normalization', () => {
    expect(defaults).toHaveLength(DEFAULT_PAYEE_ALIAS_SEEDS.length);
    for (const alias of defaults) {
      expect(alias.normalizedTokens.length).toBeGreaterThan(0);
    }
  });

  it('never relies on a stop word, a generic banking token, or a token under two characters', () => {
    const stopWords = new Set(textConfig.stopWords.map((word) => word.toUpperCase()));
    for (const alias of defaults) {
      for (const token of alias.normalizedTokens) {
        expect(stopWords.has(token), `${alias.bankPattern}: '${token}' is a stop word`).toBe(false);
        expect(GENERIC_BANKING_TOKENS.has(token), `${alias.bankPattern}: '${token}' is generic`).toBe(false);
        expect(token.length, `${alias.bankPattern}: '${token}' too short`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('gives every default a unique, namespaced id and a confidence below an authored row', () => {
    const ids = defaults.map((alias) => alias.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const alias of defaults) {
      expect(alias.id.startsWith('default:')).toBe(true);
      expect(alias.matchConfidence).toBe(DEFAULT_PAYEE_ALIAS_CONFIDENCE);
      expect(alias.matchConfidence).toBeLessThan(1);
    }
  });

  // Mirrors engine.test.ts's fixture builder; tokens come from the engine's own tokenizer so the
  // pair looks exactly like normalized input would.
  const tx = (overrides: Partial<NormalizedTransaction> & { description: string }): NormalizedTransaction =>
    buildTransaction({
      ...overrides,
      normalizedComparisonTokens: buildComparisonTokens([overrides.description], textConfig),
    });
  const pair = (bankDescription: string, glDescription: string) => [
    tx({ id: 'b', source: 'bank', lineNumber: 1, transactionDate: '2026-03-10', description: bankDescription, amount: -42.5 }),
    tx({ id: 'g', source: 'gl', lineNumber: 2, transactionDate: '2026-03-10', description: glDescription, amount: -42.5 }),
  ];

  it('bridges an abbreviation with no organization alias at all', () => {
    const result = reconcileMatches(pair('SQ *COFFEE SHOP 4471', 'Square'), defaultReconciliationConfig.matching, defaults);
    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.ruleName).toBe('Historical Pattern Match');
  });

  // Real GL exports carry Name + Memo, so the GL comparison text is rarely the bare payee. Before
  // the GL side used containment, [SQUARE] vs [SQUARE, COFFEE] scored 2/3 * 0.9 = 0.60 and the
  // alias never fired outside fixtures with a one-word GL description.
  it('bridges when the GL row carries a memo beside the payee name', () => {
    const result = reconcileMatches(pair('SQ *COFFEE SHOP 4471', 'Square Coffee'), defaultReconciliationConfig.matching, defaults);
    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.ruleName).toBe('Historical Pattern Match');
  });

  it('containment on the GL side cannot bridge a pair whose amounts differ', () => {
    const result = reconcileMatches(
      [
        tx({ id: 'b', source: 'bank', lineNumber: 1, transactionDate: '2026-03-10', description: 'SQ *COFFEE SHOP 4471', amount: -42.5 }),
        tx({ id: 'g', source: 'gl', lineNumber: 2, transactionDate: '2026-03-10', description: 'Square Coffee', amount: -99 }),
      ],
      defaultReconciliationConfig.matching,
      defaults,
    );
    expect(result.matchResults.map((m) => m.ruleName)).not.toContain('Historical Pattern Match');
  });

  it("lets an organization's own alias win over a default for the same pattern", () => {
    const organizationAlias: PayeeAlias = {
      id: 'org-1',
      bankPattern: 'SQ',
      canonicalPayeeName: 'Square Payments',
      normalizedTokens: ['SQ'],
      sourceDirection: 'bank_to_gl',
      matchConfidence: 1,
      isActive: true,
    };
    // Organization rows first, then defaults -- the order the service uses.
    const result = reconcileMatches(
      pair('SQ *COFFEE SHOP 4471', 'Square Payments'),
      defaultReconciliationConfig.matching,
      [organizationAlias, ...defaults],
    );
    expect(result.matchResults).toHaveLength(1);
    expect(result.matchResults[0]?.evidence.join(' ')).toContain('Square Payments');
  });
});
