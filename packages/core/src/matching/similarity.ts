const dayMs = 24 * 60 * 60 * 1000;

export const currencyEquals = (left: number | null, right: number | null, tolerance: number): boolean => {
  if (left === null || right === null) {
    return false;
  }

  return Math.abs(left - right) <= tolerance;
};

export const amountDifference = (left: number | null, right: number | null): number => {
  if (left === null || right === null) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(left - right);
};

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
