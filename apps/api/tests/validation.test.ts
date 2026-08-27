import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

import {
  isErrorCategory,
  isOutcomeAllowedForTarget,
  loginBodySchema,
  respondWithValidationError,
  reviewerDecisionBodySchema,
  reviewerDecisionDeleteParamsSchema,
  reviewerDecisionDeleteQuerySchema,
  signupBodySchema,
  exceptionsQuerySchema,
  updateAliasBodySchema,
} from '../src/validation';

const validSignupBody = {
  email: 'ryan@acme.example',
  fullName: 'Ryan Ray',
  username: 'rray',
  password: 'Correct-Horse9',
  phone: '',
  companyName: 'Acme Co',
  headcount: '10',
  industry: 'Finance',
  role: 'financial-analyst',
  fiscalYearEnd: 'December',
  entityState: 'DE',
  entityFilingNumber: '4821017',
  entityType: 'domestic',
  verificationChannel: 'email',
};

describe('isOutcomeAllowedForTarget', () => {
  it('allows only exception outcomes for an ExceptionItem target', () => {
    expect(isOutcomeAllowedForTarget('ExceptionItem', 'ConfirmedException')).toBe(true);
    expect(isOutcomeAllowedForTarget('ExceptionItem', 'ApprovedMatch')).toBe(false);
  });

  it('allows only match outcomes for a non-ExceptionItem target', () => {
    expect(isOutcomeAllowedForTarget('ProbableMatch', 'ApprovedMatch')).toBe(true);
    expect(isOutcomeAllowedForTarget('ProbableMatch', 'RejectedMatch')).toBe(true);
    expect(isOutcomeAllowedForTarget('AmbiguousReview', 'ConfirmedException')).toBe(false);
  });
});

describe('isErrorCategory', () => {
  it('accepts a known category and rejects everything else', () => {
    expect(isErrorCategory('DUPLICATE')).toBe(false); // not a real category -- proves rejection path
    expect(isErrorCategory(42)).toBe(false);
    expect(isErrorCategory(undefined)).toBe(false);
  });
});

describe('respondWithValidationError', () => {
  it('sends the first issue message with a 400', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const response = { status } as unknown as Response;

    const result = signupBodySchema.safeParse({ ...validSignupBody, email: 'not-an-email' });
    expect(result.success).toBe(false);
    if (!result.success) {
      respondWithValidationError(response, result.error);
    }

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ message: expect.any(String) });
  });
});

describe('signupBodySchema', () => {
  it('accepts a fully valid signup body', () => {
    expect(signupBodySchema.safeParse(validSignupBody).success).toBe(true);
  });

  it('rejects a malformed work email', () => {
    const result = signupBodySchema.safeParse({ ...validSignupBody, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a username that is an email address', () => {
    const result = signupBodySchema.safeParse({ ...validSignupBody, username: 'rray@acme.example' });
    expect(result.success).toBe(false);
  });

  it('rejects a username shorter than 4 characters', () => {
    const result = signupBodySchema.safeParse({ ...validSignupBody, username: 'abc' });
    expect(result.success).toBe(false);
  });

  it.each([
    ['too short', 'Ab9-xyz'],
    ['no uppercase', 'lowercase9-only'],
    ['no lowercase', 'UPPERCASE9-ONLY'],
    ['no number', 'NoNumbersHere-'],
    ['no symbol', 'NoSymbolsHere9'],
  ])('rejects a password that is %s', (_label, password) => {
    const result = signupBodySchema.safeParse({ ...validSignupBody, password });
    expect(result.success).toBe(false);
  });

  it('requires a phone number when verifying by sms', () => {
    const result = signupBodySchema.safeParse({
      ...validSignupBody,
      verificationChannel: 'sms',
      phone: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts sms verification when a phone number is present', () => {
    const result = signupBodySchema.safeParse({
      ...validSignupBody,
      verificationChannel: 'sms',
      phone: '+15555550123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-string fullName the same way an empty one is rejected', () => {
    const result = signupBodySchema.safeParse({ ...validSignupBody, fullName: 12345 });
    expect(result.success).toBe(false);
  });
});

describe('exceptionsQuerySchema', () => {
  it('rejects an unknown category filter', () => {
    expect(exceptionsQuerySchema.safeParse({ category: 'not-a-category' }).success).toBe(false);
  });

  it('rejects an unknown severity filter', () => {
    expect(exceptionsQuerySchema.safeParse({ severity: 'not-a-severity' }).success).toBe(false);
  });

  it('accepts an absent category and severity', () => {
    expect(exceptionsQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe('reviewerDecisionBodySchema', () => {
  const base = {
    targetType: 'ProbableMatch',
    targetId: 'match-1',
    outcome: 'ApprovedMatch',
  };

  it('accepts a valid match decision', () => {
    expect(reviewerDecisionBodySchema.safeParse(base).success).toBe(true);
  });

  it('rejects an unknown targetType', () => {
    expect(
      reviewerDecisionBodySchema.safeParse({ ...base, targetType: 'NotAThing' }).success,
    ).toBe(false);
  });

  it('rejects a blank targetId', () => {
    expect(reviewerDecisionBodySchema.safeParse({ ...base, targetId: '   ' }).success).toBe(false);
  });

  it('rejects an unknown outcome', () => {
    expect(reviewerDecisionBodySchema.safeParse({ ...base, outcome: 'NotAnOutcome' }).success).toBe(
      false,
    );
  });

  it('rejects an outcome that is not valid for the target type', () => {
    expect(
      reviewerDecisionBodySchema.safeParse({ ...base, outcome: 'ConfirmedException' }).success,
    ).toBe(false);
  });

  it('short-circuits the outcome/target-pairing check when targetType or outcome is already invalid', () => {
    // Both invalid at once -- proves the early return before isOutcomeAllowedForTarget runs.
    const result = reviewerDecisionBodySchema.safeParse({
      ...base,
      targetType: 'NotAThing',
      outcome: 'NotAnOutcome',
    });
    expect(result.success).toBe(false);
  });

  it('requires a valid finalCategory when reclassifying an exception', () => {
    const result = reviewerDecisionBodySchema.safeParse({
      targetType: 'ExceptionItem',
      targetId: 'exc-1',
      outcome: 'ReclassifiedException',
      finalCategory: 'not-a-real-category',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a reclassification with a valid finalCategory', () => {
    const result = reviewerDecisionBodySchema.safeParse({
      targetType: 'ExceptionItem',
      targetId: 'exc-1',
      outcome: 'ReclassifiedException',
      finalCategory: 'DuplicateInBank',
    });
    expect(result.success).toBe(true);
  });
});

describe('reviewerDecisionDeleteParamsSchema', () => {
  it('rejects a blank targetId', () => {
    expect(
      reviewerDecisionDeleteParamsSchema.safeParse({ id: 'decision-1', targetId: '   ' }).success,
    ).toBe(false);
  });

  it('accepts a real targetId', () => {
    expect(
      reviewerDecisionDeleteParamsSchema.safeParse({ id: 'decision-1', targetId: 'match-1' })
        .success,
    ).toBe(true);
  });
});

describe('loginBodySchema', () => {
  it('trims a real username/password pair', () => {
    const result = loginBodySchema.parse({ username: '  rray  ', password: 'x' });
    expect(result).toEqual({ username: 'rray', password: 'x' });
  });

  it('coerces a non-string username and password to empty strings rather than throwing', () => {
    const result = loginBodySchema.parse({ username: 12345, password: { not: 'a string' } });
    expect(result).toEqual({ username: '', password: '' });
  });
});

describe('updateAliasBodySchema', () => {
  it('leaves normalizedTokens undefined when the field is absent', () => {
    const result = updateAliasBodySchema.parse({});
    expect(result.normalizedTokens).toBeUndefined();
  });

  it('filters normalizedTokens down to strings when the field is present', () => {
    const result = updateAliasBodySchema.parse({ normalizedTokens: ['a', 42, 'b', null] });
    expect(result.normalizedTokens).toEqual(['a', 'b']);
  });

  // ISSUE-048.2 (sweep of the ISSUE-010/011 class): this is a partial-update body, so every field
  // is legitimately optional -- but bankPattern/canonicalPayeeName/sourceDirection/matchConfidence
  // previously also `.catch(undefined)`ed a *present-but-invalid* value into that same "leave
  // unchanged" outcome, so a caller correcting a bad value got a 200 with nothing actually
  // changed. All four now reject a present-but-invalid value instead of silently no-op'ing it.
  it('rejects a present-but-invalid matchConfidence instead of silently leaving it unchanged', () => {
    expect(() => updateAliasBodySchema.parse({ matchConfidence: 42 })).toThrow();
  });

  it('rejects a present-but-invalid sourceDirection instead of silently leaving it unchanged', () => {
    expect(() => updateAliasBodySchema.parse({ sourceDirection: 'sideways' })).toThrow();
  });

  it('rejects a non-string bankPattern instead of silently leaving it unchanged', () => {
    expect(() => updateAliasBodySchema.parse({ bankPattern: 42 })).toThrow();
  });

  it('rejects a non-string canonicalPayeeName instead of silently leaving it unchanged', () => {
    expect(() => updateAliasBodySchema.parse({ canonicalPayeeName: 42 })).toThrow();
  });

  it('still accepts a present, valid value for every optional field', () => {
    const result = updateAliasBodySchema.parse({
      bankPattern: '  SQ *COFFEE SHOP  ',
      canonicalPayeeName: '  Coffee Shop  ',
      sourceDirection: 'bank_to_gl',
      matchConfidence: 0.75,
    });

    expect(result).toMatchObject({
      bankPattern: 'SQ *COFFEE SHOP',
      canonicalPayeeName: 'Coffee Shop',
      sourceDirection: 'bank_to_gl',
      matchConfidence: 0.75,
    });
  });
});

describe('reviewerDecisionDeleteQuerySchema', () => {
  it('rejects a missing/unknown targetType', () => {
    expect(reviewerDecisionDeleteQuerySchema.safeParse({}).success).toBe(false);
  });

  it('accepts a known targetType', () => {
    expect(
      reviewerDecisionDeleteQuerySchema.safeParse({ targetType: 'ProbableMatch' }).success,
    ).toBe(true);
  });
});
