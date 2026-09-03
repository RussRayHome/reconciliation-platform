import { describe, expect, it } from 'vitest';

import { assertClearedPartition } from './engine';

/**
 * G5 (#272). The assertion holds by construction inside the engine, so it is exercised directly
 * here — otherwise it would be a guard nothing ever proves can fire.
 */
describe('assertClearedPartition', () => {
  const population = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('accepts a clean partition', () => {
    expect(() =>
      assertClearedPartition(population, new Set(['a']), new Set(['b', 'c']), 'bank'),
    ).not.toThrow();
  });

  it('throws when a transaction is counted as BOTH cleared and unmatched', () => {
    expect(() =>
      assertClearedPartition(population, new Set(['a']), new Set(['a', 'b', 'c']), 'bank'),
    ).toThrow(/1 in BOTH \(a\)/);
  });

  it('throws when a transaction is counted as NEITHER', () => {
    expect(() =>
      assertClearedPartition(population, new Set(['a']), new Set(['b']), 'GL'),
    ).toThrow(/1 in NEITHER \(c\)/);
  });

  it('names the side so a failure says which population broke', () => {
    expect(() => assertClearedPartition(population, new Set(), new Set(), 'GL')).toThrow(
      /partition violated on the GL side/,
    );
  });

  it('accepts an empty population', () => {
    expect(() => assertClearedPartition([], new Set(), new Set(), 'bank')).not.toThrow();
  });
});
