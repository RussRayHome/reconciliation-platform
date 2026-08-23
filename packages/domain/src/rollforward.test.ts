import { describe, expect, it } from 'vitest';

import { errorCategories } from './enums';
import {
  assertCarryEligibilityIsExhaustive,
  CARRY_ELIGIBLE_CATEGORIES,
  isCarryEligible,
} from './rollforward';

describe('CARRY_ELIGIBLE_CATEGORIES', () => {
  it('covers every errorCategories value exactly once', () => {
    expect(assertCarryEligibilityIsExhaustive).not.toThrow();
    expect(Object.keys(CARRY_ELIGIBLE_CATEGORIES).sort()).toEqual([...errorCategories].sort());
  });

  it("carries the plan's explicit list of timing differences and genuine unreconciled items", () => {
    for (const category of [
      'OutstandingCheck',
      'StaleOutstandingCheck',
      'DepositInTransit',
      'MissingFromBank',
      'MissingFromGL',
      'TimingDifference',
      'IntercompanyMismatch',
      'NSFReturnedDeposit',
      'AmountMismatch',
    ] as const) {
      expect(isCarryEligible(category), category).toBe(true);
    }
  });

  it("never carries the plan's explicit list of data-quality and review artifacts", () => {
    for (const category of [
      'DuplicateInBank',
      'DuplicateInGL',
      'InvalidOrMissingData',
      'WeakDescriptionMatch',
      'DescriptionMerchantVariance',
      'AmbiguousMatchRequiringReview',
      'LikelyMiscoding',
    ] as const) {
      expect(isCarryEligible(category), category).toBe(false);
    }
  });

  it('carries exactly 9 categories -- every other errorCategories value is never-carry', () => {
    const carried = errorCategories.filter((category) => isCarryEligible(category));
    expect(carried).toHaveLength(9);
  });
});
