import type {
  ErrorCategory,
  ReviewerDecisionOutcome,
  ReviewerDecisionTargetType,
} from '@recon/domain';
import {
  businessFields,
  errorCategories,
  severityLevels,
  transformKinds,
  approvableTypes,
  savedViewScopes,
  subledgerKinds,
  savedViewVisibilities,
  savedViewStatuses,
} from '@recon/domain';
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

/** POST /api/imports/runs body. Unlike reconciliationRunBodySchema above, invalid values here are
 * rejected (400) rather than dropped: this creates a real reconciliation_run row with NOT NULL
 * label/frequency/periodYear columns (changeset 0042), so a silently-dropped field would either
 * fail the insert with a raw DB error or persist a run the analyst didn't actually ask for. Fields
 * arrive as multipart/form-data strings (multer), hence the z.coerce on the numeric ones. */
/**
 * POST /api/accounts -- registering a bank account (A-D1, Issue #338). `accountIdentifier` is the
 * account number as the organization records it; `lastFour` is derived from it server-side and is
 * deliberately not accepted from the client, so the display tail can never disagree with the
 * identifier it is supposed to summarize.
 */
/** Saved views (Issue #458). `scope` and `visibility` mirror the domain unions rather than free
 * strings so an unknown value is a 400 here, not a CHECK-constraint 23514 from Postgres. `filters`
 * is the screen's own filter model and is deliberately unvalidated beyond "an object": the two
 * scopes carry different shapes, and pinning either here would mean editing the API every time a
 * facet is added to a screen. */
/** Bounded because the column is TEXT and nothing in Postgres caps it -- 120 matches the account
 * `displayName` cap, and this string has to fit a view picker. */
const savedViewNameSchema = z
  .string()
  .trim()
  .min(1, 'A view name is required.')
  .max(120, 'A view name must be 120 characters or fewer.');

export const createSavedViewBodySchema = z.object({
  name: savedViewNameSchema,
  scope: z.enum(savedViewScopes),
  filters: z.record(z.string(), z.unknown()).default({}),
  visibility: z.enum(savedViewVisibilities).optional(),
});

/** Every field optional -- PATCH semantics. `scope` is absent on purpose: it is what the saved
 * filters mean, so changing it would reinterpret the payload rather than edit it. */
export const updateSavedViewBodySchema = z.object({
  name: savedViewNameSchema.optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  visibility: z.enum(savedViewVisibilities).optional(),
  status: z.enum(savedViewStatuses).optional(),
});

/** Validated as a UUID before it reaches the store. Without this an unparseable path segment
 * reaches Postgres, which raises 22P02 -- and `classifyError` has no case for it, so a client-side
 * typo becomes a 500 *and* a captured exception rather than a 400. */
export const savedViewIdParamSchema = z.object({
  savedViewId: z.string().uuid('savedViewId must be a valid saved view id.'),
});

export const listSavedViewsQuerySchema = z.object({
  scope: z.enum(savedViewScopes).optional(),
  includeRetired: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

/** The prefix a subledger file's name carries. Bounded and pattern-checked because it must round
 * trip through a filename: `SUBLEDGER_ENTITY_ID_FILENAME_PATTERN` only matches an alphanumeric run
 * before the first "-" or "_", so an id containing anything else could never be matched to a file
 * that claims it. Rejecting it here beats registering an entity no import can ever reach. */
const subledgerEntityIdSchema = z
  .string()
  .trim()
  .min(1, 'An entity id is required.')
  .max(32, 'An entity id must be 32 characters or fewer.')
  .regex(/^[A-Za-z0-9]+$/, 'An entity id may contain only letters and digits.');

export const registerSubledgerEntityBodySchema = z.object({
  entityId: subledgerEntityIdSchema,
  displayName: z
    .string()
    .trim()
    .min(1, 'A display name is required.')
    .max(120, 'A display name must be 120 characters or fewer.'),
  ledgerSource: z.string().trim().max(120).nullish(),
  currencyCode: z.string().trim().length(3, 'currencyCode must be a 3-letter ISO code.').optional(),
});

/** PATCH. `entityId` and `kind` are absent on purpose — the first is what filenames claim, the
 * second is which registry the row lives in; changing either re-points history rather than editing
 * it (design 5a). */
export const updateSubledgerEntityBodySchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  ledgerSource: z.string().trim().max(120).nullish(),
  currencyCode: z.string().trim().length(3).optional(),
  isActive: z.boolean().optional(),
});

export const subledgerKindParamSchema = z.object({
  kind: z.enum(subledgerKinds),
});

export const subledgerEntityParamsSchema = z.object({
  kind: z.enum(subledgerKinds),
  entityRowId: z.string().uuid('entityRowId must be a valid entity id.'),
});

export const registerAccountBodySchema = z.object({
  accountIdentifier: requiredTrimmedString('An account number is required.'),
  displayName: z.string().trim().max(120, 'displayName must be 120 characters or fewer.').optional(),
  institutionName: z
    .string()
    .trim()
    .max(120, 'institutionName must be 120 characters or fewer.')
    .optional(),
  currencyCode: z
    .string()
    .trim()
    .length(3, 'currencyCode must be a 3-letter ISO code.')
    .optional(),
  glCashAccountCode: z
    .string()
    .trim()
    .max(64, 'glCashAccountCode must be 64 characters or fewer.')
    .optional(),
});

/** PATCH /api/accounts/:id. `accountIdentifier` is absent on purpose -- editing it would silently
 * re-point every statement already assigned to the account (see UpdateReconciliationAccountInput). */
export const updateAccountBodySchema = z
  .object({
    displayName: z.string().trim().max(120, 'displayName must be 120 characters or fewer.').optional(),
    institutionName: z
      .string()
      .trim()
      .max(120, 'institutionName must be 120 characters or fewer.')
      .optional(),
    currencyCode: z.string().trim().length(3, 'currencyCode must be a 3-letter ISO code.').optional(),
    glCashAccountCode: z
      .string()
      .trim()
      .max(64, 'glCashAccountCode must be 64 characters or fewer.')
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'At least one field must be supplied.',
  });

/**
 * The per-file account assignment accompanying a bank upload (A-D1 step 2). Sent as a JSON string
 * in the multipart body because the rest of the payload is files -- one entry per `bankFiles`
 * upload, in the same order, so a file and its assignment cannot drift apart.
 *
 * `confirmed` is the operator's acknowledgement of a filename or last-four disagreement. It is
 * accepted only as an explicit `true`: A-D1 requires that a disagreement be confirmed or the file
 * reassigned, and a defaulted value would let a conflict pass silently.
 */
export const bankAccountAssignmentSchema = z.object({
  accountId: z.string().uuid('accountId must be a valid account id.'),
  confirmed: z.boolean().optional(),
});

export const bankAccountAssignmentsSchema = z
  .array(bankAccountAssignmentSchema)
  .min(1, 'Each bank file must be assigned to a registered account.');

export const importRunBodySchema = z.object({
  label: requiredTrimmedString('label is required.'),
  accountIdentifier: z.string().optional().catch(undefined),
  /** JSON-encoded {@link bankAccountAssignmentsSchema}. Multipart bodies carry only strings, so
   * this is decoded rather than received as structured JSON; a malformed string is reported as a
   * validation error rather than being silently treated as "no assignments supplied". */
  bankAccountAssignments: z
    .string()
    .transform((value, ctx) => {
      try {
        return bankAccountAssignmentsSchema.parse(JSON.parse(value));
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: 'bankAccountAssignments must be a JSON array of account assignments.',
        });
        return z.NEVER;
      }
    })
    .optional(),
  frequency: z.enum(['MONTHLY', 'ANNUAL'], {
    message: 'frequency must be MONTHLY or ANNUAL.',
  }),
  periodYear: z.coerce
    .number({ message: 'periodYear is required.' })
    .int('periodYear must be a whole number.'),
  periodMonth: z.coerce
    .number()
    .int('periodMonth must be a whole number.')
    .min(1, 'periodMonth must be between 1 and 12.')
    .max(12, 'periodMonth must be between 1 and 12.')
    .optional(),
});

/** POST /api/imports/runs/:id/import body (Phase 12, Screen 06). `skipInvalidRows` is required and
 * must be `true` -- there is no "import everything including invalid rows" mode (invalid rows
 * have no canonical_record to import in the first place), so the field exists to make the
 * caller's intent explicit and match the work plan's own T7.4 shape, not to select behavior. */
export const importRunPartialImportBodySchema = z.object({
  skipInvalidRows: z.boolean({ message: 'skipInvalidRows is required.' }),
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

/** Query filters for GET /api/imports/runs/:id/issues (Phase 8 review drilldown). code has no
 * fixed enum to check against (it's an open-ended validation_rule_version.rule_code), so it's
 * only checked for being a non-empty string, same permissiveness as reviewerId/notes below. */
export const runIssuesQuerySchema = z
  .object({
    severity: z.unknown().optional(),
    code: z.unknown().optional(),
    limit: z.unknown().optional(),
    offset: z.unknown().optional(),
  })
  .superRefine((query, ctx) => {
    if (query.severity !== undefined && !['ERROR', 'WARNING'].includes(query.severity as string)) {
      ctx.addIssue({
        code: 'custom',
        path: ['severity'],
        message: 'Unknown validation issue severity filter.',
      });
    }

    if (query.code !== undefined && (typeof query.code !== 'string' || query.code.trim() === '')) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: 'code filter must not be empty.' });
    }
  });

/** Query filters for GET /api/imports/runs/:id/records (Phase 8 review drilldown). */
export const runRecordsQuerySchema = z
  .object({
    sourceType: z.unknown().optional(),
    importFileId: z.unknown().optional(),
    limit: z.unknown().optional(),
    offset: z.unknown().optional(),
  })
  .superRefine((query, ctx) => {
    if (query.sourceType !== undefined && !['BANK', 'GL'].includes(query.sourceType as string)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceType'],
        message: 'Unknown canonical record sourceType filter.',
      });
    }

    if (
      query.importFileId !== undefined &&
      (typeof query.importFileId !== 'string' || query.importFileId.trim() === '')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['importFileId'],
        message: 'importFileId filter must not be empty.',
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

const approvalTabs = ['pending', 'approved', 'rejected', 'mine'] as const;

export const approvalsQuerySchema = z.object({
  type: z.enum(approvableTypes).catch('import'),
  tab: z.enum(approvalTabs).catch('pending'),
});

export const approvalDecisionBodySchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'OVERRIDDEN']),
  rationale: z
    .string()
    .transform((value) => value.trim())
    .optional(),
});

/** Unreconciled Item Roll-Forward PR E.4. dispositionCode is required -- a write-off must always
 * say why, even though no fixed code list exists yet (the plan's own §8 leaves the approval
 * policy, including any controlled vocabulary, as an open decision). dispositionNote is optional
 * free text for the specifics a fixed code can't capture. */
/** Query filters for GET /api/reconciliation/runs (PR F.1). All optional -- accountId narrows to
 * one account's history, periodYear/periodMonth narrow to one specific period; callers combine
 * them however they need (e.g. the Verdict module's prior-period lookup passes all three). */
export const listReconciliationRunsQuerySchema = z.object({
  accountId: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1))
    .optional(),
  periodYear: z.coerce.number().int().optional(),
  periodMonth: z.coerce.number().int().min(1).max(12).optional(),
});

/** Query filters for GET /api/reconciliation/open-items (PR F.4). status matches
 * reconciliation_open_item's own CHECK constraint (changeset 0063). */
export const listOpenItemsScheduleQuerySchema = z.object({
  accountId: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1))
    .optional(),
  status: z.enum(['OPEN', 'CLEARED', 'WRITTEN_OFF', 'ADJUSTED', 'VOIDED', 'SUPERSEDED']).optional(),
});

export const writeOffOpenItemBodySchema = z.object({
  dispositionCode: z.string().trim().min(1, 'dispositionCode is required.'),
  dispositionNote: z
    .string()
    .transform((value) => value.trim())
    .optional(),
});

// ISSUE-048.2: this is a partial-update (PUT) body -- an omitted field means "leave unchanged,"
// so every field here is legitimately `.optional()`. It previously also `.catch(undefined)`ed a
// *present-but-invalid* value into the same "leave unchanged" outcome, which is the ISSUE-010/011
// class of bug in a different shape: the caller gets a 200 believing their update applied (e.g.
// correcting a bad matchConfidence on a row the fuzzy-matching pass reads) when nothing changed.
// Dropping `.catch()` makes a present-but-invalid value 400 naming the field, same as
// createAliasBodySchema already does for matchConfidence (ISSUE-011).
export const updateAliasBodySchema = z.object({
  bankPattern: z
    .string()
    .transform((value) => value.trim())
    .optional(),
  canonicalPayeeName: z
    .string()
    .transform((value) => value.trim())
    .optional(),
  normalizedTokens: z
    .array(z.unknown())
    .optional()
    .transform((tokens) =>
      tokens ? tokens.filter((token): token is string => typeof token === 'string') : undefined,
    ),
  sourceDirection: z.enum(['bidirectional', 'bank_to_gl']).optional(),
  matchConfidence: z.number().min(0).max(1).optional(),
});
