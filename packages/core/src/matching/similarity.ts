const dayMs = 24 * 60 * 60 * 1000;

/**
 * Returns true when two nullable currency amounts are within `tolerance` of each other.
 * Either null operand is treated as "no amount available" and always returns false.
 */
export const currencyEquals = (
  left: number | null,
  right: number | null,
  tolerance: number,
): boolean => {
  if (left === null || right === null) {
    return false;
  }

  return Math.abs(left - right) <= tolerance;
};

/**
 * Returns the absolute difference between two nullable amounts.
 * Returns `Infinity` when either operand is null so that null-amount candidates always
 * sort below any real amount difference during scoring.
 */
export const amountDifference = (left: number | null, right: number | null): number => {
  if (left === null || right === null) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(left - right);
};

/**
 * Returns the absolute number of calendar days between two ISO date strings.
 * Returns null when either value is missing or unparseable — callers use null
 * to skip date-tolerance rules rather than treating the pair as a date match.
 */
export const dateDifferenceDays = (
  left: string | undefined,
  right: string | undefined,
): number | null => {
  if (!left || !right) {
    return null;
  }

  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.valueOf()) || Number.isNaN(rightDate.valueOf())) {
    return null;
  }

  return Math.round(Math.abs(leftDate.valueOf() - rightDate.valueOf()) / dayMs);
};

/**
 * Computes Sørensen–Dice similarity over two token sets, returning a score in [0, 1].
 * A score of 1.0 means the sets are identical; 0.0 means no tokens in common.
 * Empty inputs always return 0 to avoid division-by-zero.
 */
const CONCATENATION_MIN_JOINED_LENGTH = 6;
const CONCATENATION_MIN_PART_LENGTH = 3;
const alphabeticOnly = /^[A-Z]+$/;

/**
 * True when one side is a single token that is exactly the other side's tokens run together --
 * "OfficeDepot" against "Office Depot" (Issue #310).
 *
 * Normalization cannot fix this: splitting a run-together word needs a dictionary. Comparing joined
 * forms cannot either, because tokens are sorted and the original order is gone
 * ("DEPOTOFFICE" !== "OFFICEDEPOT"). So it is decided per pair -- but cheaply, which is what makes it
 * viable where a trigram swap was not (21x Dice, ~220 s at 6.6k x 6.6k):
 *
 *  1. shape check: exactly one token on one side, two or more on the other;
 *  2. arithmetic gate: the single token's length equals the sum of the others' lengths. Integer
 *     work, no allocation, and it rejects almost everything -- on realistic descriptors the shape
 *     check alone passes ~70% of pairs while this leaves ~4%;
 *  3. only then, verify by consuming the joined token from the front. Length agreement is a
 *     coincidence detector, not a decision: "OFFICEDEPOT" also tiles by length against
 *     ["1234","WALMART"] and ["574","OIL","SHELL"], and both die on the first character here.
 *
 * Letters only, deliberately. Reference tokens are numeric, and ["12","34"] would otherwise tile
 * "1234" and declare two unrelated check numbers identical.
 */
const isConcatenationOf = (joined: string, parts: string[]): boolean => {
  if (
    joined.length < CONCATENATION_MIN_JOINED_LENGTH ||
    parts.length < 2 ||
    !alphabeticOnly.test(joined)
  ) {
    return false;
  }

  let total = 0;
  for (const part of parts) {
    if (part.length < CONCATENATION_MIN_PART_LENGTH || !alphabeticOnly.test(part)) {
      return false;
    }
    total += part.length;
  }
  if (total !== joined.length) {
    return false;
  }

  const remaining = [...parts];
  let rest = joined;
  while (rest.length > 0) {
    const index = remaining.findIndex((part) => rest.startsWith(part));
    if (index === -1) {
      return false;
    }
    rest = rest.slice(remaining[index]!.length);
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
};

/** Exported for tests: the two sides are the same text, differing only in word spacing. */
export const isSpacingVariant = (left: string[], right: string[]): boolean =>
  (left.length === 1 && isConcatenationOf(left[0]!, right)) ||
  (right.length === 1 && isConcatenationOf(right[0]!, left));

export const tokenSimilarity = (left: string[], right: string[]): number => {
  if (!left.length || !right.length) {
    return 0;
  }

  // "OfficeDepot" and "Office Depot" are the same text; Dice sees zero shared tokens (#310).
  if (isSpacingVariant(left, right)) {
    return 1;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;

  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  });

  return (2 * intersection) / (leftSet.size + rightSet.size);
};

/**
 * Computes the Szymkiewicz–Simpson overlap coefficient over two token sets: the intersection
 * divided by the SMALLER set's size, rather than tokenSimilarity's symmetric Dice denominator.
 * A short, clean token set (e.g. a terse GL memo) compared against a long, noisy one (e.g. a bank
 * ACH descriptor padded with routing numbers and reference IDs) doesn't get diluted here the way
 * it does under Dice — only used for scoring/evidence quality, never as a hard matching gate.
 */
export const overlapCoefficient = (left: string[], right: string[]): number => {
  if (!left.length || !right.length) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;

  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  });

  return intersection / Math.min(leftSet.size, rightSet.size);
};

/** Max Levenshtein edit distance tolerated as a "fuzzy match" for isFuzzyTokenMatch, as a
 * fraction of the longer token's length. */
const FUZZY_TOKEN_MAX_EDIT_DISTANCE_RATIO = 0.2;
/** Tokens shorter than this never fuzzy-match each other, even at 1 edit apart -- otherwise short
 * common tokens like state abbreviations ("CA" vs "GA") would collide. */
const FUZZY_TOKEN_MIN_LENGTH = 3;

const levenshteinDistance = (a: string, b: string): number => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, (_unused, rowIndex) =>
    Array.from({ length: cols }, (_alsoUnused, colIndex) => (rowIndex === 0 ? colIndex : 0)),
  );
  for (let row = 0; row < rows; row += 1) {
    distances[row]![0] = row;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitutionCost = a[row - 1] === b[col - 1] ? 0 : 1;
      distances[row]![col] = Math.min(
        distances[row - 1]![col]! + 1,
        distances[row]![col - 1]! + 1,
        distances[row - 1]![col - 1]! + substitutionCost,
      );
    }
  }

  return distances[rows - 1]![cols - 1]!;
};

/** True when two tokens are the same word up to minor spelling variance -- exact match, or an
 * edit distance within FUZZY_TOKEN_MAX_EDIT_DISTANCE_RATIO of the longer token's length. Tokens
 * shorter than FUZZY_TOKEN_MIN_LENGTH never fuzzy-match (only exact match), so e.g. "CA" and "GA"
 * are never treated as the same state by proximity alone. */
const isFuzzyTokenMatch = (a: string, b: string): boolean => {
  if (a === b) {
    return true;
  }
  if (a.length < FUZZY_TOKEN_MIN_LENGTH || b.length < FUZZY_TOKEN_MIN_LENGTH) {
    return false;
  }

  const longerLength = Math.max(a.length, b.length);
  const maxDistance = Math.floor(longerLength * FUZZY_TOKEN_MAX_EDIT_DISTANCE_RATIO);
  return levenshteinDistance(a, b) <= maxDistance;
};

/**
 * Fuzzy containment: the fraction of the SHORTER token set that has an exact or near-exact
 * (isFuzzyTokenMatch) counterpart anywhere in the longer set. Catches pluralization/truncation
 * variance that overlapCoefficient's exact-match-only comparison misses. This does string-distance
 * work per token pair, so it's materially more expensive than tokenSimilarity/overlapCoefficient --
 * callers should only invoke it on a small, already-filtered candidate pool, never eagerly over
 * every possible pair.
 */
export const fuzzyContainmentSimilarity = (left: string[], right: string[]): number => {
  if (!left.length || !right.length) {
    return 0;
  }

  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  const shorterUnique = [...new Set(shorter)];
  const longerUnique = [...new Set(longer)];

  const matchedCount = shorterUnique.filter((shortToken) =>
    longerUnique.some((longToken) => isFuzzyTokenMatch(shortToken, longToken)),
  ).length;

  return matchedCount / shorterUnique.length;
};

/**
 * Directional containment: what fraction of `pattern` is present in `text`.
 *
 * Issue #313. `fuzzyContainmentSimilarity` above picks its denominator by LENGTH -- whichever array
 * is shorter -- which is the right question when comparing two descriptors of equal standing. A
 * payee-alias lookup is not that comparison: the pattern and the descriptor have different roles,
 * and the only question worth asking is whether the pattern appears in the descriptor. When an
 * alias pattern happens to be the longer of the two, length-based selection silently inverts it.
 *
 * A symmetric metric is the wrong shape here for a second reason: Dice penalises the pattern for
 * tokens the descriptor carries that the pattern never meant to cover -- `PMTS`, `US`, an auth
 * code. So `AMZN MKTP` scores 0.40 against `AMZN MKTPLACE PMTS` and misses the alias threshold,
 * while containment scores it 0.50 and hits.
 *
 * Tokens are compared with `isFuzzyTokenMatch`, the same predicate `fuzzyContainmentSimilarity`
 * uses, so spelling variance is tolerated identically by both.
 */
export const patternContainmentSimilarity = (pattern: string[], text: string[]): number => {
  if (!pattern.length || !text.length) {
    return 0;
  }

  const patternUnique = [...new Set(pattern)];
  const textUnique = [...new Set(text)];

  const matched = patternUnique.filter((patternToken) =>
    textUnique.some((textToken) => isFuzzyTokenMatch(patternToken, textToken)),
  ).length;

  return matched / patternUnique.length;
};

/**
 * Trigram (3-gram) Jaccard similarity -- the same algorithm PostgreSQL's `pg_trgm` uses, so a
 * future move of this comparison into SQL would agree with it rather than quietly re-scoring.
 *
 * Issue #310. Added because every other signal here compares whole TOKENS, and so is blind to
 * token-boundary differences that a human reads straight through. Measured against real bank
 * descriptors:
 *
 *   WALMART STORE 1234 / WAL-MART #1234   dice 0.33  overlap 0.33  fuzzy 0.33  ->  trigram 0.50
 *   Office Depot       / OfficeDepot      dice 0.00  overlap 0.00  fuzzy 0.00  ->  trigram 0.67
 *
 * A hyphen or a missing space re-tokenizes the string and drops the token-based signals to nearly
 * nothing. Trigrams ignore token boundaries entirely, so they recover exactly the case the others
 * cannot. They do NOT recover abbreviations (AMAZON / AMZN scores 0.21) -- that is what the payee
 * alias table exists for, and no string-distance metric can bridge it.
 *
 * Each word is padded with two leading spaces and one trailing space before slicing, matching
 * pg_trgm, so short words still produce grams and word starts are weighted.
 */
export const trigramSimilarity = (left: string[], right: string[]): number => {
  const grams = (tokens: string[]): Set<string> => {
    const out = new Set<string>();
    for (const token of tokens) {
      const padded = `  ${token} `;
      for (let index = 0; index < padded.length - 2; index += 1) {
        out.add(padded.slice(index, index + 3));
      }
    }
    return out;
  };

  const leftGrams = grams(left);
  const rightGrams = grams(right);
  if (!leftGrams.size || !rightGrams.size) {
    return 0;
  }

  let shared = 0;
  leftGrams.forEach((gram) => {
    if (rightGrams.has(gram)) {
      shared += 1;
    }
  });

  return shared / (leftGrams.size + rightGrams.size - shared);
};

/** Combined description-similarity signal, used only where a caller needs the strongest available
 * evidence of relatedness for scoring/evidence text -- never as a hard matching gate. */
export interface DescriptionSimilarity {
  dice: number;
  overlap: number;
  fuzzyOverlap: number;
  /** Trigram Jaccard -- the only signal here that is blind to token boundaries (Issue #310). */
  trigram: number;
  /** The strongest of the four signals above. */
  best: number;
}

export const describeTokenSimilarity = (left: string[], right: string[]): DescriptionSimilarity => {
  const dice = tokenSimilarity(left, right);
  const overlap = overlapCoefficient(left, right);
  const fuzzyOverlap = fuzzyContainmentSimilarity(left, right);
  const trigram = trigramSimilarity(left, right);

  return {
    dice,
    overlap,
    fuzzyOverlap,
    trigram,
    best: Math.max(dice, overlap, fuzzyOverlap, trigram),
  };
};
