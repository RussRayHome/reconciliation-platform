# ISSUE-008: Mapping profile audit attribution is client-supplied

**Status:** Open · **Severity:** Ship with branch · **Area:** Audit / Integrity
**Location:** `apps/api/src/validation.ts:232`, used at `apps/api/src/app.ts:1948`
**Source:** Silent-failure review, 2026-08-03

## Problem
`organizationId` is correctly taken from `request.auth` with a comment explaining why. `createdBy` —
the audit field recording who authored a mapping version — is taken from the **request body**. Any
authenticated caller can attribute a mapping change to any name, with no error and no trace.

For a platform whose value proposition includes audit and compliance, a forgeable actor field is a
real integrity defect.

## Fix
Drop `createdBy` from `saveMappingProfileBodySchema` and use `request.auth!.username` at `app.ts:1971`.
