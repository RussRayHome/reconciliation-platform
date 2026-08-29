# ISSUE-016: `docs:openapi:check` fails — generated OpenAPI doc is out of date

**Status:** Open · **Severity:** Carried over · **Area:** CI / Docs
**Location:** `generated/openapi.generated.json`
**Source:** 2026-08-03. **Confirmed pre-existing** — reproduced by stashing all local changes.

## Problem
`npm run docs:openapi:check` fails with "OpenAPI output is out of date." CI runs this in the
`docker-validate` job (`npm run typecheck && lint && docs:api:check && docs:openapi:check`), so the
branch is red on it.

## Fix
`npm run docs:openapi:generate` — but only once the API surface is settled, since it rewrites a
committed generated artifact. The file is in `.prettierignore` precisely so formatting never touches it.
