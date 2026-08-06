--liquibase formatted sql

--changeset recon:0034-add_signup_verification_columns
-- Self-serve signup (previously placeholder-only, see App.tsx) creates the account as soon as
-- credentials + company fields validate, then leaves two checks pending against the now-existing
-- account: entity verification (Secretary of State, via an outside source -- see
-- entityVerificationService.ts) on the organization, and identity confirmation (email/SMS code) on
-- the user. Both start 'pending' and must reach 'verified' before mapping creation is allowed.
--
-- Widens the role check constraint from the three roles left after changeset 0033 to the full
-- six-role business hierarchy (financial-analyst through cfo) plus the unchanged admin/superuser.
-- Purely additive -- every existing role value stays valid, no backfill needed.
ALTER TABLE reconciliation_user
  DROP CONSTRAINT reconciliation_user_role_check;

ALTER TABLE reconciliation_user
  ADD CONSTRAINT reconciliation_user_role_check
  CHECK (role IN (
    'financial-analyst',
    'senior-analyst',
    'staff-accountant',
    'controller',
    'vp-finance',
    'cfo',
    'admin',
    'superuser'
  ));

-- email/phone are new -- existing dev-seeded rows (create-users.psql) have neither, so both stay
-- nullable. UNIQUE on a nullable column is fine here: Postgres does not treat multiple NULLs as
-- equal, so no partial index is needed to allow many not-yet-collected emails to coexist.
ALTER TABLE reconciliation_user
  ADD COLUMN email TEXT UNIQUE,
  ADD COLUMN phone TEXT;

ALTER TABLE reconciliation_user
  ADD COLUMN identity_verification_status TEXT
    NOT NULL DEFAULT 'pending'
    CHECK (identity_verification_status IN ('pending', 'verified')),
  ADD COLUMN identity_verification_code_hash TEXT,
  ADD COLUMN identity_verification_code_expires_at TIMESTAMPTZ;

-- entity_type/entity_state/entity_filing_number are collected once, at signup, and are not
-- re-editable through this schema -- they describe the Secretary of State record being checked,
-- not a mutable profile field.
ALTER TABLE reconciliation_organization
  ADD COLUMN entity_state TEXT,
  ADD COLUMN entity_filing_number TEXT,
  ADD COLUMN entity_type TEXT CHECK (entity_type IN ('domestic', 'foreign')),
  ADD COLUMN entity_verification_status TEXT
    NOT NULL DEFAULT 'pending'
    CHECK (entity_verification_status IN ('pending', 'verified', 'failed'));

--rollback ALTER TABLE reconciliation_organization DROP COLUMN entity_verification_status;
--rollback ALTER TABLE reconciliation_organization DROP COLUMN entity_type;
--rollback ALTER TABLE reconciliation_organization DROP COLUMN entity_filing_number;
--rollback ALTER TABLE reconciliation_organization DROP COLUMN entity_state;
--rollback ALTER TABLE reconciliation_user DROP COLUMN identity_verification_code_expires_at;
--rollback ALTER TABLE reconciliation_user DROP COLUMN identity_verification_code_hash;
--rollback ALTER TABLE reconciliation_user DROP COLUMN identity_verification_status;
--rollback ALTER TABLE reconciliation_user DROP COLUMN phone;
--rollback ALTER TABLE reconciliation_user DROP COLUMN email;
--rollback ALTER TABLE reconciliation_user DROP CONSTRAINT reconciliation_user_role_check;
--rollback ALTER TABLE reconciliation_user ADD CONSTRAINT reconciliation_user_role_check CHECK (role IN ('financial-analyst', 'admin', 'superuser'));
