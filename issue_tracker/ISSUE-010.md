# ISSUE-010: `transform` enum `.catch(undefined)` silently discards mapping rules

**Status:** Open · **Severity:** Follow-up · **Area:** Validation / Matching
**Location:** `apps/api/src/validation.ts:228`
**Source:** Silent-failure review, 2026-08-03

## Problem
`transform: z.enum(transformKinds).optional().catch(undefined)` — a client sending a misspelled or
renamed transform gets `201 Created` with the transform silently stripped. `app.ts:1968` then filters
it out of `transformationRules`, and every subsequent reconciliation normalizes that column wrongly,
producing plausible-looking but incorrect match results. Users will blame the matching engine.

## Fix
Drop the `.catch()`. `saveMappingProfileBodySchema` is already `safeParse`d with
`respondWithValidationError`, so an unknown transform becomes a 400 naming the field.
