import { describe, expect, it } from 'vitest';

import { errorCategories } from './enums';
import {
  assertCarryEligibilityIsExhaustive,
  CARRY_ELIGIBLE_CATEGORIES,
  isCarryEligible,
  resolveCarryForwardDecision,
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

describe('resolveCarryForwardDecision', () => {
  it('returns ORG_NOT_ENABLED for a default (not yet onboarded) organization', () => {
    expect(resolveCarryForwardDecision({ envEnabled: true, orgEnabled: false })).toEqual({
      enabled: false,
      reason: 'ORG_NOT_ENABLED',
    });
  });

  it('returns ENV_DISABLED when the env kill switch is off, even when the org column is true', () => {
    expect(resolveCarryForwardDecision({ envEnabled: false, orgEnabled: true })).toEqual({
      enabled: false,
      reason: 'ENV_DISABLED',
    });
  });

  it('returns ENV_DISABLED (not ORG_NOT_ENABLED) when both are off -- the kill switch is checked first', () => {
    expect(resolveCarryForwardDecision({ envEnabled: false, orgEnabled: false })).toEqual({
      enabled: false,
      reason: 'ENV_DISABLED',
    });
  });

  it('returns enabled:true only when both the env switch and the org column allow it', () => {
    expect(resolveCarryForwardDecision({ envEnabled: true, orgEnabled: true })).toEqual({
      enabled: true,
    });
  });
});
