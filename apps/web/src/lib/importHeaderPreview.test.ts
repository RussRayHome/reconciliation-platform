import { describe, expect, it } from 'vitest';

import type { CanonicalField } from '@recon/domain';

import { computeHeaderPreview } from './importHeaderPreview';

const field = (id: CanonicalField['id'], required: boolean): CanonicalField => ({
  id,
  type: 'text',
  required,
  note: '',
});

const CANONICAL_FIELDS: CanonicalField[] = [
  field('transactionDate', true),
  field('amount', true),
  field('description', false),
];

describe('computeHeaderPreview (Issue #250)', () => {
  it('reports no unmatched fields when every required column is present verbatim', () => {
    const result = computeHeaderPreview(['Transaction Date', 'Amount', 'Description'], CANONICAL_FIELDS);
    expect(result.unmatchedRequiredFields).toEqual([]);
  });

  it('flags a required field with no plausible match anywhere in the header', () => {
    const result = computeHeaderPreview(['Transaction Date', 'Description'], CANONICAL_FIELDS);
    expect(result.unmatchedRequiredFields).toEqual([field('amount', true)]);
  });

  it('does not flag a renamed column that fuzzy-matches within the existing bounded distance', () => {
    // "Amoutn" is a one-transposition typo of "amount" -- well within suggestMapping's existing
    // MAX_SUGGESTION_DISTANCE_RATIO, the same threshold the Create Mapping canvas already accepts.
    const result = computeHeaderPreview(['Transaction Date', 'Amoutn'], CANONICAL_FIELDS);
    expect(result.unmatchedRequiredFields).toEqual([]);
  });

  it('never flags a non-required field, even when nothing in the header plausibly matches it', () => {
    const result = computeHeaderPreview(['Transaction Date', 'Amount'], CANONICAL_FIELDS);
    expect(result.unmatchedRequiredFields).toEqual([]);
  });

  it('ignores an extra column with no canonical counterpart', () => {
    const result = computeHeaderPreview(
      ['Transaction Date', 'Amount', 'Some Internal Batch Code'],
      CANONICAL_FIELDS,
    );
    expect(result.unmatchedRequiredFields).toEqual([]);
  });

  it('flags every required field when the header is completely unrelated', () => {
    const result = computeHeaderPreview(['Foo', 'Bar', 'Baz'], CANONICAL_FIELDS);
    expect(result.unmatchedRequiredFields).toEqual([field('transactionDate', true), field('amount', true)]);
  });
});
