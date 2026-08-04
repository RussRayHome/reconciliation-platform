# ISSUE-006: `DATABASE_URL` defaults to the migration role

**Status:** Open · **Severity:** Ship with branch · **Area:** Deployment / Tenancy
**Location:** `compose.yaml:18`, `compose.dev.yaml:78`, `compose.stage.yaml:50`
**Source:** Silent-failure review, 2026-08-03

## Problem
All three compose files default `DATABASE_URL` to `recon_app` rather than the runtime role. If
`API_DATABASE_URL` is unset — missing env file, `docker compose up` without `--env-file`, a pipeline
that forgets it — the API connects as the migration/owner role. `compose.yaml:106` itself states that
`API_DATABASE_URL` should point at `app_user` (changeset 0031).

**Correction to the original review:** it claimed `recon_app` is a superuser and therefore silently
disables RLS. That is wrong — `recon_app` is created `NOSUPERUSER` at
`scripts/db/dev-stage/create-users.psql:31`. Line 46 (`SUPERUSER`) is a different role, `rray`. The
fix below is still worth doing, but the severity is lower than first reported.

## Fix
1. Use the required form: `DATABASE_URL: ${API_DATABASE_URL:?...}` — `compose.yaml:110` already does
   this for `POSTGRES_PASSWORD`, so the mechanism is present.
2. Add a startup assertion on `pg_roles.rolsuper` / `rolbypassrls` for `current_user`. Confirmed: no
   such check exists anywhere in the TypeScript today.
