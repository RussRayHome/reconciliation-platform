--liquibase formatted sql

--changeset recon:0024-standardize_id_and_created_at_columns
-- Brings every application table to the house convention: a UUID `id` and a
-- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
--
-- Liquibase's own `databasechangelog` / `databasechangeloglock` are intentionally excluded -- they
-- are owned by the migration tool and altering them corrupts its bookkeeping.
--
-- A NOTE ON PRIMARY KEYS
--
-- Four tables lacked `id` because their primary key was a meaningful natural key. The new `id` is
-- added as a UNIQUE surrogate and the existing primary key is retained rather than replaced:
--
--   reconciliation_job_summary        PK job_id          -- one summary per job
--   reconciliation_source_file_content PK source_file_id -- one preserved copy per source file
--   reconciliation_user              PK user_name        -- five FKs reference it
--   reconciliation_audit_event       PK event_id         -- BIGSERIAL, carries append order
--
-- Promoting `id` to primary key on the first two would silently permit a second summary per job and
-- a second content row per file, discarding invariants the schema currently enforces structurally.
-- On `reconciliation_user` it would require rewriting five foreign keys, and on
-- `reconciliation_audit_event` a random UUID cannot express the append ordering that `event_id`
-- provides. Adding `id` alongside satisfies the convention without trading away any of that.

-- ── id ───────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE reconciliation_job_summary
  ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE reconciliation_job_summary
  ADD CONSTRAINT reconciliation_job_summary_id_key UNIQUE (id);

ALTER TABLE reconciliation_source_file_content
  ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE reconciliation_source_file_content
  ADD CONSTRAINT reconciliation_source_file_content_id_key UNIQUE (id);

ALTER TABLE reconciliation_user
  ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE reconciliation_user
  ADD CONSTRAINT reconciliation_user_id_key UNIQUE (id);

ALTER TABLE reconciliation_audit_event
  ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE reconciliation_audit_event
  ADD CONSTRAINT reconciliation_audit_event_id_key UNIQUE (id);

-- ── created_at ───────────────────────────────────────────────────────────────────────────────────
-- Existing rows are backfilled from the closest timestamp each table already records, so the column
-- carries a truthful value rather than the migration's own clock:
--   reconciliation_import_approval      <- requested_at (when the approval was raised)
--   reconciliation_source_file_content  <- captured_at  (when the bytes were preserved)
--   reconciliation_user                 <- last_changed (best available; no creation time is kept)
ALTER TABLE reconciliation_import_approval
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE reconciliation_import_approval SET created_at = requested_at;

ALTER TABLE reconciliation_source_file_content
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE reconciliation_source_file_content SET created_at = captured_at;

ALTER TABLE reconciliation_user
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE reconciliation_user SET created_at = last_changed;

-- ── created_at defaults ──────────────────────────────────────────────────────────────────────────
-- Both columns are already NOT NULL but were declared without a default, so every writer had to
-- supply the timestamp explicitly. Adding NOW() matches every other table and makes an omitted
-- timestamp impossible rather than merely unlikely.
ALTER TABLE reconciliation_review_decision ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE reconciliation_review_observation ALTER COLUMN created_at SET DEFAULT NOW();

--rollback ALTER TABLE reconciliation_review_observation ALTER COLUMN created_at DROP DEFAULT;
--rollback ALTER TABLE reconciliation_review_decision ALTER COLUMN created_at DROP DEFAULT;
--rollback ALTER TABLE reconciliation_user DROP COLUMN IF EXISTS created_at;
--rollback ALTER TABLE reconciliation_source_file_content DROP COLUMN IF EXISTS created_at;
--rollback ALTER TABLE reconciliation_import_approval DROP COLUMN IF EXISTS created_at;
--rollback ALTER TABLE reconciliation_audit_event DROP CONSTRAINT IF EXISTS reconciliation_audit_event_id_key;
--rollback ALTER TABLE reconciliation_audit_event DROP COLUMN IF EXISTS id;
--rollback ALTER TABLE reconciliation_user DROP CONSTRAINT IF EXISTS reconciliation_user_id_key;
--rollback ALTER TABLE reconciliation_user DROP COLUMN IF EXISTS id;
--rollback ALTER TABLE reconciliation_source_file_content DROP CONSTRAINT IF EXISTS reconciliation_source_file_content_id_key;
--rollback ALTER TABLE reconciliation_source_file_content DROP COLUMN IF EXISTS id;
--rollback ALTER TABLE reconciliation_job_summary DROP CONSTRAINT IF EXISTS reconciliation_job_summary_id_key;
--rollback ALTER TABLE reconciliation_job_summary DROP COLUMN IF EXISTS id;
