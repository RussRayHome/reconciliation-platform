# ISSUE-011: `matchConfidence` coerces invalid input to 1.0

**Status:** Open · **Severity:** Follow-up · **Area:** Validation / Matching
**Location:** `apps/api/src/validation.ts:222`
**Source:** Silent-failure review, 2026-08-03. Pre-existing, not introduced by this branch.

## Problem
`matchConfidence: z.number().min(0).max(1).catch(1)` coerces any invalid confidence to **1.0** —
maximum confidence, the most dangerous possible default for a matching engine. A malformed value
becomes a maximally trusted match rather than a validation error.

## Fix
Drop the `.catch()` so an out-of-range or non-numeric value becomes a 400.
