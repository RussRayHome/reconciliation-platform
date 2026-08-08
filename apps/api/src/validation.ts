import type {
  ErrorCategory,
  ReviewerDecisionOutcome,
  ReviewerDecisionTargetType,
} from '@recon/domain';
import { businessFields, errorCategories, severityLevels, transformKinds } from '@recon/domain';
import type { Response } from 'express';
import { z } from 'zod';

/** Sends the first validation issue as `{ message }` with a 400 status, matching the API's existing error shape. */
export const respondWithValidationError = (response: Response, error: z.ZodError): void => {
  response.status(400).json({ message: error.issues[0]?.message ?? 'Invalid request.' });
};

export const reviewerDecisionTargetTypes = new Set<ReviewerDecisionTargetType>([
  'ProbableMatch',
  'AmbiguousReview',
  'ExceptionItem',
]);

export const reviewerDecisionOutcomes = new Set<ReviewerDecisionOutcome>([
  'ApprovedMatch',
  'RejectedMatch',
  'ConfirmedException',
  'ReclassifiedException',
  'DismissedException',
  'ResearchException',
]);

export const isErrorCategory = (value: unknown): value is ErrorCategory =>
  typeof value === 'string' && errorCategories.includes(value as ErrorCategory);

export const isOutcomeAllowedForTarget = (
  targetType: ReviewerDecisionTargetType,
  outcome: ReviewerDecisionOutcome,
): boolean => {
  if (targetType === 'ExceptionItem') {
    return (
      outcome === 'ConfirmedException' ||
      outcome === 'ReclassifiedException' ||
      outcome === 'DismissedException' ||
      outcome === 'ResearchException'
    );
  }

  return outcome === 'ApprovedMatch' || outcome === 'RejectedMatch';
};

/** Coerces a non-string value to `''` and trims, so wrong-typed input fails the same checks as an empty string. */
const trimmedString = () =>
  z.preprocess((value) => (typeof value === 'string' ? value.trim() : ''), z.string());

/** Same as `trimmedString`, but a failed length check reports `message` instead of zod's default. */
const requiredTrimmedString = (message: string) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : ''),
    z.string().min(1, message),
  );

export const loginBodySchema = z.object({
  username: trimmedString().catch(''),
  password: z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string()).catch(''),
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Self-serve-selectable at signup only -- admin/superuser are not offered here, matching the
 * comment on `userRoles` in @recon/domain. */
const signupRoles = [
  'financial-analyst',
  'senior-analyst',
  'staff-accountant',
  'controller',
  'vp-finance',
  'cfo',
] as const;

const signupEntityTypes = ['domestic', 'foreign'] as const;
const signupVerificationChannels = ['email', 'sms'] as const;

/** The design doc's five password rules. Checked in order so the first unmet rule is what
 * surfaces via `respondWithValidationError`, which only ever reports the first issue. */
const passwordRules: Array<{ test: (value: string) => boolean; message: string }> = [
  { test: (value) => value.length >= 10, message: 'Password must be at least 10 characters.' },
  { test: (value) => /[A-Z]/.test(value), message: 'Password must include an uppercase letter.' },
  { test: (value) => /[a-z]/.test(value), message: 'Password must include a lowercase letter.' },
  { test: (value) => /[0-9]/.test(value), message: 'Password must include a number.' },
  { test: (value) => /[^A-Za-z0-9]/.test(value), message: 'Password must include a symbol.' },
];

export const signupBodySchema = z
  .object({
    email: requiredTrimmedString('A work email is required.'),
    fullName: requiredTrimmedString('Full name is required.'),
    username: requiredTrimmedString('Username is required.'),
    password: z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string()),
    phone: trimmedString().catch(''),
    companyName: requiredTrimmedString('Legal entity name is required.'),
    headcount: requiredTrimmedString('Headcount is required.'),
    industry: requiredTrimmedString('Industry is required.'),
    role: z.enum(signupRoles),
    fiscalYearEnd: requiredTrimmedString('Fiscal year end is required.'),
    entityState: requiredTrimmedString('State of record is required.'),
    entityFilingNumber: requiredTrimmedString('Filing or registration number is required.'),
    entityType: z.enum(signupEntityTypes),
    verificationChannel: z.enum(signupVerificationChannels).catch('email'),
  })
  .superRefine((body, ctx) => {
    if (!EMAIL_PATTERN.test(body.email)) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Enter a valid work email address.',
      });
    }

    if (body.username.includes('@')) {
      ctx.addIssue({
        code: 'custom',
        path: ['username'],
        message: 'Username cannot be an email address.',
      });
    } else if (body.username.length < 4) {
      ctx.addIssue({
        code: 'custom',
        path: ['username'],
        message: 'Username must be at least 4 characters.',
      });
    }

    const failedRule = passwordRules.find((rule) => !rule.test(body.password));
    if (failedRule) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: failedRule.message });
    }

    if (body.verificationChannel === 'sms' && body.phone.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['phone'],
        message: 'A mobile phone number is required to verify by text.',
      });
    }
  });

export type SignupBody = z.infer<typeof signupBodySchema>;

export const identityConfirmBodySchema = z.object({
  code: requiredTrimmedString('Enter the six-digit code.'),
});

/** Lets the signup form show a live Secretary of State result before the account exists (no
 * organization to check yet) -- purely advisory. `POST /api/auth/signup` re-verifies
 * fire-and-forget against the same provider once the org row exists, which is what actually sets
 * `entity_verification_status`; this endpoint never writes anything. */
export const entityVerificationCheckBodySchema = z.object({
  companyName: requiredTrimmedString('Legal entity name is required.'),
  entityState: requiredTrimmedString('State of record is required.'),
  entityFilingNumber: requiredTrimmedString('Filing or registration number is required.'),
  entityType: z.enum(signupEntityTypes),
});

export const reconciliationRunBodySchema = z.object({
  accountIdentifier: z.string().optional().catch(undefined),
  periodLabel: z.string().optional().catch(undefined),
  // Invalid values are dropped rather than rejected: the reconciliation still runs, just
  // without a frequency label, mirroring the pre-zod behavior for this optional field.
  reconciliationFrequency: z.enum(['Monthly', 'Annual']).optional().catch(undefined),
});

export const exceptionsQuerySchema = z
  .object({
    category: z.unknown().optional(),
    severity: z.unknown().optional(),
  })
  .superRefine((query, ctx) => {
    if (
      query.category !== undefined &&
      !(
        typeof query.category === 'string' &&
        (errorCategories as readonly string[]).includes(query.category)
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'Unknown exception category filter.',
      });
    }

    if (
      query.severity !== undefined &&
      !(
        typeof query.severity === 'string' &&
        (severityLevels as readonly string[]).includes(query.severity)
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['severity'],
        message: 'Unknown exception severity filter.',
      });
    }
  });

export const reviewerDecisionBodySchema = z
  .object({
    targetType: z.unknown().optional(),
    targetId: z.unknown().optional(),
    outcome: z.unknown().optional(),
    finalCategory: z.unknown().optional(),
    notes: z.unknown().optional(),
    reviewerId: z.unknown().optional(),
    reviewerName: z.unknown().optional(),
  })
  .superRefine((body, ctx) => {
    const targetTypeValid =
      typeof body.targetType === 'string' &&
      reviewerDecisionTargetTypes.has(body.targetType as ReviewerDecisionTargetType);
    if (!targetTypeValid) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetType'],
        message: 'A valid reviewer decision targetType is required.',
      });
    }

    const targetIdValid = typeof body.targetId === 'string' && body.targetId.trim().length > 0;
    if (!targetIdValid) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'A reviewer decision targetId is required.',
      });
    }

    const outcomeValid =
      typeof body.outcome === 'string' &&
      reviewerDecisionOutcomes.has(body.outcome as ReviewerDecisionOutcome);
    if (!outcomeValid) {
      ctx.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'A valid reviewer decision outcome is required.',
      });
    }

    if (!targetTypeValid || !outcomeValid) {
      return;
    }

    const targetType = body.targetType as ReviewerDecisionTargetType;
    const outcome = body.outcome as ReviewerDecisionOutcome;

    if (!isOutcomeAllowedForTarget(targetType, outcome)) {
      ctx.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Reviewer decision outcome is not valid for the specified target type.',
      });
      return;
    }

    if (outcome === 'ReclassifiedException' && !isErrorCategory(body.finalCategory)) {
      ctx.addIssue({
        code: 'custom',
        path: ['finalCategory'],
        message: 'A valid finalCategory is required when reclassifying an exception.',
      });
    }
  });

export const reviewerDecisionDeleteParamsSchema = z
  .object({
    id: z.string().min(1),
    targetId: z.string(),
  })
  .superRefine((params, ctx) => {
    if (params.targetId.trim().length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'A reviewer decision targetId is required.',
      });
    }
  });

export const reviewerDecisionDeleteQuerySchema = z
  .object({ targetType: z.unknown().optional() })
  .superRefine((query, ctx) => {
    const valid =
      typeof query.targetType === 'string' &&
      reviewerDecisionTargetTypes.has(query.targetType as ReviewerDecisionTargetType);
    if (!valid) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetType'],
        message: 'A valid reviewer decision targetType is required.',
      });
    }
  });

export const aliasesQuerySchema = z.object({
  accountIdentifier: z.string().optional().catch(undefined),
});

const optionalNormalizedTokens = z
  .array(z.unknown())
  .optional()
  .transform((tokens) =>
    (tokens ?? []).filter((token): token is string => typeof token === 'string'),
  );

export const createAliasBodySchema = z.object({
  bankPattern: requiredTrimmedString('bankPattern is required.'),
  canonicalPayeeName: requiredTrimmedString('canonicalPayeeName is required.'),
  normalizedTokens: optionalNormalizedTokens,
  accountIdentifier: z.string().optional().catch(undefined),
  sourceDirection: z.enum(['bidirectional', 'bank_to_gl']).catch('bank_to_gl'),
  // `.optional().default(1)` (not `.catch(1)`): an omitted value still defaults sensibly, but a
  // present-and-invalid one now rejects with 400 instead of silently becoming maximum confidence
  // (ISSUE-011).
  matchConfidence: z.number().min(0).max(1).optional().default(1),
});

const mappingProfilePairSchema = z.object({
  col: requiredTrimmedString('col is required.'),
  db: z.enum(businessFields),
  transform: z.enum(transformKinds).optional(),
});

export const saveMappingProfileBodySchema = z.object({
  name: requiredTrimmedString('name is required.'),
  gl: z.array(mappingProfilePairSchema),
  bank: z.array(mappingProfilePairSchema),
});

/**
 * Shape-only: keys are checked against the real set of tunable `MatchingConfig` fields at the
 * route handler in app.ts (via `RULES_CATALOG.metrics`), not here — this schema stays free of
 * `@recon/core` so validation.ts keeps importing only `@recon/domain`.
 */
export const matchingConfigVersionDraftBodySchema = z.object({
  varianceOverrides: z.record(z.string(), z.number()),
  pendingApprovalOwner: z
    .string()
    .transform((value) => value.trim())
    .optional(),
});

export const publishMatchingConfigVersionBodySchema = z.object({
  effectiveAt: z.string().datetime().optional(),
});

export const updateAliasBodySchema = z.object({
  bankPattern: z
    .string()
    .transform((value) => value.trim())
    .optional()
    .catch(undefined),
  canonicalPayeeName: z
    .string()
    .transform((value) => value.trim())
    .optional()
    .catch(undefined),
  normalizedTokens: z
    .array(z.unknown())
    .optional()
    .transform((tokens) =>
      tokens ? tokens.filter((token): token is string => typeof token === 'string') : undefined,
    ),
  sourceDirection: z.enum(['bidirectional', 'bank_to_gl']).optional().catch(undefined),
  matchConfidence: z.number().min(0).max(1).optional().catch(undefined),
});
