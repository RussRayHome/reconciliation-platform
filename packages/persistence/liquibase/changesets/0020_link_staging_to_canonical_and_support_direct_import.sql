--liquibase formatted sql

--changeset recon:0020-link_staging_to_canonical_and_support_direct_import
-- Closes the two structural gaps that stop changesets 0011-0018 from forming a usable
-- import -> stage -> map -> approve -> canonical pipeline.
--
-- Gap 1 -- direct (unmapped) import is impossible. reconciliation_staged_transaction.
-- mapping_profile_version_id is NOT NULL, so a file imported verbatim (headers taken as-is, no
-- mapping profile) cannot be staged at all. Relaxed below and paired with an explicit ingestion_mode
-- so the two legal shapes are enforced by the database rather than by convention.
--
-- Gap 2 -- staging and canonical are disconnected. reconciliation_staged_transaction has a
-- 'PROMOTED' status but nothing records what it was promoted into, and reconciliation_canonical_row
-- has no reference back to the staged row (or therefore to the approval that cleared it). Approving
-- an import and storing a canonical transaction are currently unrelated events, so "which approval
-- authorized this canonical row?" is unanswerable. The FK added below makes that a single join.

-- ── Ingestion mode on the source file ────────────────────────────────────────────────────────────
-- DIRECT: parsed with the built-in column configuration, no mapping profile. The original bytes are
--         preserved in reconciliation_source_file_content (changeset 0019), which is the reference
--         copy when a direct import turns out to have been parsed wrongly.
-- MAPPED: normalized through a specific reconciliation_mapping_profile_version.
-- Existing rows are backfilled to DIRECT because that is what they factually were: every import to
-- date ran through the built-in parser with zero mapping profiles in existence.
ALTER TABLE reconciliation_source_file
  ADD COLUMN ingestion_mode TEXT NOT NULL DEFAULT 'DIRECT'
  CONSTRAINT reconciliation_source_file_ingestion_mode_check
  CHECK (ingestion_mode IN ('DIRECT', 'MAPPED'));

-- ── Direct import support on the staging table ───────────────────────────────────────────────────
ALTER TABLE reconciliation_staged_transaction
  ALTER COLUMN mapping_profile_version_id DROP NOT NULL;

ALTER TABLE reconciliation_staged_transaction
  ADD COLUMN ingestion_mode TEXT NOT NULL DEFAULT 'DIRECT'
  CONSTRAINT reconciliation_staged_transaction_ingestion_mode_check
  CHECK (ingestion_mode IN ('DIRECT', 'MAPPED'));

-- Denormalized from reconciliation_source_file.ingestion_mode at insert time, matching the
-- denormalization style already used for reconciliation_validation_result.severity (changeset 0016).
-- Carrying it here is what makes the pairing invariant expressible as a CHECK: a MAPPED row must
-- name the profile version that produced it, and a DIRECT row must not pretend one exists.
ALTER TABLE reconciliation_staged_transaction
  ADD CONSTRAINT reconciliation_staged_transaction_mapping_pairing_check
  CHECK (
    (ingestion_mode = 'MAPPED' AND mapping_profile_version_id IS NOT NULL)
    OR
    (ingestion_mode = 'DIRECT' AND mapping_profile_version_id IS NULL)
  );

-- ── Promotion audit ──────────────────────────────────────────────────────────────────────────────
-- The 'PROMOTED' status already existed with nothing recording who promoted the row or when. Without
-- these columns a promoted staging row is indistinguishable from one whose status was set by hand.
ALTER TABLE reconciliation_staged_transaction
  ADD COLUMN promoted_at TIMESTAMPTZ;

ALTER TABLE reconciliation_staged_transaction
  ADD COLUMN promoted_by TEXT;

ALTER TABLE reconciliation_staged_transaction
  ADD CONSTRAINT reconciliation_staged_transaction_promoted_by_fk
  FOREIGN KEY (promoted_by) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT;

-- Status and audit columns cannot drift apart: PROMOTED implies a recorded timestamp, and a
-- timestamp implies the status. Anything else is a bug that would otherwise persist silently.
ALTER TABLE reconciliation_staged_transaction
  ADD CONSTRAINT reconciliation_staged_transaction_promotion_audit_check
  CHECK ((status = 'PROMOTED') = (promoted_at IS NOT NULL));

-- ── The missing link: canonical row -> staged transaction ────────────────────────────────────────
-- Nullable because the 8,888 canonical rows that already exist were produced by the direct pipeline
-- that predates staging; they keep their lineage through raw_row_id. New rows promoted through
-- staging populate this, which transitively reaches the mapping profile version, the validation
-- results, and the import approval that authorized the file.
--
-- ON DELETE SET NULL rather than RESTRICT: reconciliation_job cascades to both raw_row (and thence
-- to staged_transaction) and canonical_row, and the order in which those cascades fire is not
-- guaranteed. RESTRICT could abort a legitimate job deletion; SET NULL guarantees the canonical
-- record -- the accounting record of consequence -- outlives the staging scaffolding around it.
ALTER TABLE reconciliation_canonical_row
  ADD COLUMN staged_transaction_id UUID;

ALTER TABLE reconciliation_canonical_row
  ADD CONSTRAINT reconciliation_canonical_row_staged_transaction_fk
  FOREIGN KEY (staged_transaction_id) REFERENCES reconciliation_staged_transaction(id) ON DELETE SET NULL;

-- One canonical row per staged transaction. Postgres allows unlimited NULLs under a UNIQUE
-- constraint, which is exactly what the legacy rows need, so this enforces 1:1 only where a link
-- actually exists and blocks a staged row being promoted twice.
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_canonical_row_staged_transaction_key
  ON reconciliation_canonical_row (staged_transaction_id)
  WHERE staged_transaction_id IS NOT NULL;

--rollback DROP INDEX IF EXISTS reconciliation_canonical_row_staged_transaction_key;
--rollback ALTER TABLE reconciliation_canonical_row DROP CONSTRAINT IF EXISTS reconciliation_canonical_row_staged_transaction_fk;
--rollback ALTER TABLE reconciliation_canonical_row DROP COLUMN IF EXISTS staged_transaction_id;
--rollback ALTER TABLE reconciliation_staged_transaction DROP CONSTRAINT IF EXISTS reconciliation_staged_transaction_promotion_audit_check;
--rollback ALTER TABLE reconciliation_staged_transaction DROP CONSTRAINT IF EXISTS reconciliation_staged_transaction_promoted_by_fk;
--rollback ALTER TABLE reconciliation_staged_transaction DROP COLUMN IF EXISTS promoted_by;
--rollback ALTER TABLE reconciliation_staged_transaction DROP COLUMN IF EXISTS promoted_at;
--rollback ALTER TABLE reconciliation_staged_transaction DROP CONSTRAINT IF EXISTS reconciliation_staged_transaction_mapping_pairing_check;
--rollback ALTER TABLE reconciliation_staged_transaction DROP COLUMN IF EXISTS ingestion_mode;
-- Direct-import staging rows have no mapping profile version to point at, and the pre-0020 schema
-- has no way to represent them, so rolling back necessarily discards them. Deleting is the only
-- honest option: back-filling a placeholder UUID would violate the mapping_profile_version FK, and
-- inventing a real profile version would fabricate audit history.
--rollback DELETE FROM reconciliation_staged_transaction WHERE mapping_profile_version_id IS NULL;
--rollback ALTER TABLE reconciliation_staged_transaction ALTER COLUMN mapping_profile_version_id SET NOT NULL;
--rollback ALTER TABLE reconciliation_source_file DROP COLUMN IF EXISTS ingestion_mode;
