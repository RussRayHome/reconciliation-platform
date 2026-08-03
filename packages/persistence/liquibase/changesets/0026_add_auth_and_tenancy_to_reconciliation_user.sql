--liquibase formatted sql

--changeset recon:0026-add_auth_and_tenancy_to_reconciliation_user splitStatements:false
-- ADR-0002 (auth) and ADR-0001 (tenancy) both land on reconciliation_user in one changeset, per
-- ADR-0002's own guidance: password_hash, role, and organization_id are cheaper to add once than
-- three times. Backfill choices follow the resolved ADR decisions (2026-08-03):
--   * password_hash: bcrypt via pgcrypto, hashed in place with no forced reset (DECIDE 3 = Option
--     B) -- every row seen in this table so far is the developer's own local/test login, not real
--     customer data, which is the condition the ADR named for skipping a forced reset.
--   * role: a single CHECK-constrained column (DECIDE 2 = Option A), backfilled to match the role
--     assignments already hardcoded in apps/web/src/App.tsx's usersByUsername map, so the
--     server-side value agrees with what the UI has been asserting all along. Any row that isn't
--     one of those known usernames falls back to 'financial-analyst', the least-privileged of the
--     four roles that can still reach the application.
--   * organization_id: single org per user, not a membership table (ADR-0001, decided 2026-08-03).
--     No real customer organization exists yet, so this migration attributes every existing user
--     to the same default organization that findOrCreateDefaultOrganization() (readModelStore.ts,
--     used by the mapping-profile save path) already creates on demand -- matched by name, not a
--     hardcoded id, so whichever of the two runs first does not create a second, orphaned org that
--     would put a user's own mapping profiles outside their own tenant once RLS lands. The column
--     is made NOT NULL immediately -- RLS policies written against it never have to special-case
--     NULL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── organization_id ─────────────────────────────────────────────────────────────────────────────
INSERT INTO reconciliation_organization (id, name)
VALUES (gen_random_uuid(), 'Default Organization')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE reconciliation_user
  ADD COLUMN organization_id UUID REFERENCES reconciliation_organization (id);

UPDATE reconciliation_user
SET organization_id = (SELECT id FROM reconciliation_organization WHERE name = 'Default Organization')
WHERE organization_id IS NULL;

ALTER TABLE reconciliation_user
  ALTER COLUMN organization_id SET NOT NULL;

-- ── role ─────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE reconciliation_user
  ADD COLUMN role TEXT
  CHECK (role IN ('developer', 'financial-analyst', 'admin', 'superuser'));

UPDATE reconciliation_user
SET role = CASE user_name
  WHEN 'rray' THEN 'superuser'
  WHEN 'rray2' THEN 'developer'
  WHEN 'rray3' THEN 'admin'
  WHEN 'bray' THEN 'financial-analyst'
  ELSE 'financial-analyst'
END
WHERE role IS NULL;

ALTER TABLE reconciliation_user
  ALTER COLUMN role SET NOT NULL;

-- ── password_hash ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE reconciliation_user
  ADD COLUMN password_hash TEXT;

UPDATE reconciliation_user
SET password_hash = crypt(password, gen_salt('bf'))
WHERE password_hash IS NULL;

ALTER TABLE reconciliation_user
  ALTER COLUMN password_hash SET NOT NULL;

ALTER TABLE reconciliation_user
  DROP COLUMN password;

-- The trigger tracked password changes via `password`; repoint it at `password_hash` so
-- `last_changed` keeps updating on credential rotation instead of silently breaking now that
-- `password` no longer exists.
CREATE OR REPLACE FUNCTION set_reconciliation_user_last_changed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.last_changed = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Restoring plaintext passwords is not possible once they're hashed, so the rollback below
-- forces every account to go through a password reset instead. It does not recreate the
-- password-changed trigger: Liquibase splits --rollback SQL on every semicolon regardless of
-- dollar-quoting (confirmed empirically -- this changeset's own splitStatements:false governs
-- the forward SQL only, not its rollback), so a plpgsql function body -- which always needs at
-- least one internal semicolon -- cannot survive as rollback SQL in this Liquibase version.
-- Losing the auto-updating last_changed-on-password-change trigger is an acceptable rollback gap
-- (fix forward), not a correctness risk, unlike a rollback that fails to run at all.
--rollback DROP TRIGGER IF EXISTS trg_reconciliation_user_password_changed ON reconciliation_user;
--rollback DROP FUNCTION IF EXISTS set_reconciliation_user_last_changed();
--rollback ALTER TABLE reconciliation_user ADD COLUMN password TEXT;
--rollback UPDATE reconciliation_user SET password = 'ROLLBACK_RESET_REQUIRED_' || substr(md5(random()::text), 1, 12);
--rollback ALTER TABLE reconciliation_user ALTER COLUMN password SET NOT NULL;
--rollback ALTER TABLE reconciliation_user DROP COLUMN password_hash;
--rollback ALTER TABLE reconciliation_user DROP COLUMN role;
--rollback ALTER TABLE reconciliation_user DROP COLUMN organization_id;
