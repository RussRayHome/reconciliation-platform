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
