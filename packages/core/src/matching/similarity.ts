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
export const tokenSimilarity = (left: string[], right: string[]): number => {
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

/** Combined description-similarity signal, used only where a caller needs the strongest available
 * evidence of relatedness for scoring/evidence text -- never as a hard matching gate. */
export interface DescriptionSimilarity {
  dice: number;
  overlap: number;
  fuzzyOverlap: number;
  /** The strongest of the three signals above. */
  best: number;
}

export const describeTokenSimilarity = (left: string[], right: string[]): DescriptionSimilarity => {
  const dice = tokenSimilarity(left, right);
  const overlap = overlapCoefficient(left, right);
  const fuzzyOverlap = fuzzyContainmentSimilarity(left, right);

  return {
    dice,
    overlap,
    fuzzyOverlap,
    best: Math.max(dice, overlap, fuzzyOverlap),
  };
};
