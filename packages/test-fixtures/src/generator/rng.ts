/**
 * Seeded, deterministic pseudo-random number generation for the scenario generator.
 *
 * The engine core bans `Math.random()` and argument-less `new Date()` (plan §1.2 invariant 2,
 * and the CI gate in the shift-left review §3). The generator is held to the same standard for a
 * different reason: a fixture set that differs between runs cannot serve as a recall guard,
 * because a failure could always be blamed on the data rather than the code. Same seed in, same
 * bytes out -- always.
 *
 * mulberry32: 32-bit state, uniform enough for spreading dates and amounts across a period, and
 * short enough to audit by eye. It is deliberately NOT cryptographic; nothing here needs that.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [minInclusive, maxInclusive]. */
  int(minInclusive: number, maxInclusive: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(values: readonly T[]): T;
  /** A fresh independent stream, derived from this one's seed and a label. Lets each scenario
   *  draw from its own stream so adding a scenario never shifts another scenario's numbers. */
  fork(label: string): Rng;
}

/** FNV-1a over a string -- turns a scenario label into a stable 32-bit seed contribution. */
const hashLabel = (label: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (minInclusive: number, maxInclusive: number): number => {
    if (maxInclusive < minInclusive) {
      throw new RangeError(`int(${minInclusive}, ${maxInclusive}): max is below min`);
    }
    return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
  };

  const pick = <T,>(values: readonly T[]): T => {
    if (values.length === 0) {
      throw new RangeError('pick() called on an empty array');
    }
    return values[int(0, values.length - 1)] as T;
  };

  const fork = (label: string): Rng => createRng((seed ^ hashLabel(label)) >>> 0);

  return { next, int, pick, fork };
};
