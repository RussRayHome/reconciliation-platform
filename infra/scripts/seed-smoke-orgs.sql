-- =============================================================================
-- PRODUCTION-SAFE. Unlike scripts/db/dev-stage/create-users.psql (explicitly dev/stage only --
-- creates a superuser role with a hardcoded password), this script creates no Postgres roles and
-- grants no elevated privileges. It seeds exactly two clearly-namespaced organizations and one
-- user each, entirely through the application's own least-privilege data model
-- (reconciliation_organization / reconciliation_user) -- nothing a real customer would ever see.
--
-- Why this exists: there is no self-service signup today (see create-users.psql's own header,
-- and docs/adr/... for the still-open product decisions around real org onboarding). infra's
-- post-deploy smoke test (scripts/smoke-test.ts) needs two organizations to prove row-level
-- security actually isolates them under the live deployment's real app_user credentials -- this
-- is the narrow, production-safe seed that makes that check possible without waiting on a full
-- account-creation feature.
--
-- Idempotent: safe to run multiple times, and safe to re-run against a freshly-restored DR
-- standby (a snapshot restore already carries these rows if they existed on the primary).
--
-- The password below is intentionally low-stakes, not a secret worth protecting: these accounts
-- can only ever see the two dummy organizations' own smoke-test data, nothing belonging to a real
-- customer. It must match SMOKE_TEST_PASSWORD in scripts/smoke-test.ts -- keep the two in sync.
--
-- How to run:
--   psql "$API_DATABASE_URL_AS_RECON_APP" -f infra/scripts/seed-smoke-orgs.sql
-- (Must run as recon_app, the owner role -- app_user has no INSERT grant on
-- reconciliation_organization by design; see changeset 0031.)
-- =============================================================================

\echo 'Seeding smoke-test organizations and users...'

INSERT INTO reconciliation_organization
  (id, name, status, entity_verification_status)
VALUES
  (gen_random_uuid(), 'zz-smoke-test-org-a', 'ACTIVE', 'verified'),
  (gen_random_uuid(), 'zz-smoke-test-org-b', 'ACTIVE', 'verified')
ON CONFLICT (name) DO UPDATE
  SET status = EXCLUDED.status,
      entity_verification_status = EXCLUDED.entity_verification_status;

INSERT INTO reconciliation_user
  (id, user_name, first_name, last_name, password_hash, role, organization_id, identity_verification_status)
SELECT
  gen_random_uuid(), v.user_name, 'Smoke', 'Test', crypt(v.plain_password, gen_salt('bf')), 'admin', org.id, 'verified'
FROM (VALUES
  ('zz-smoke-a', 'Sm0ke-Test-Only-P@ss', 'zz-smoke-test-org-a'),
  ('zz-smoke-b', 'Sm0ke-Test-Only-P@ss', 'zz-smoke-test-org-b')
) AS v(user_name, plain_password, org_name)
JOIN reconciliation_organization org ON org.name = v.org_name
ON CONFLICT (user_name) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      organization_id = EXCLUDED.organization_id,
      identity_verification_status = 'verified';

\echo 'Done. Seeded zz-smoke-a (org zz-smoke-test-org-a) and zz-smoke-b (org zz-smoke-test-org-b).'
