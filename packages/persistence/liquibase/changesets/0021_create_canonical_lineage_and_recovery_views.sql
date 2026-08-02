--liquibase formatted sql

--changeset recon:0021-create_canonical_lineage_and_recovery_views
-- Two read-only views that make the preserved bytes and the pipeline linkage usable by a human
-- under incident conditions. Both are plain views (no materialization): they are consulted rarely,
-- correctness matters more than speed, and a stale materialized view during an incident would be
-- actively misleading.

-- ── Recovery view ────────────────────────────────────────────────────────────────────────────────
-- Answers the question an operator actually asks when the application is failing: "which uploads can
-- I still get back, and are they intact?" Deliberately omits the `content` column so that SELECT *
-- against this view can never pull file bodies over the wire -- callers fetch bytes explicitly, by
-- id, from reconciliation_source_file_content once this view has told them the row is VERIFIED.
--
-- recovery_status compares what registration recorded against what preservation actually stored:
--   MISSING       -- no preserved bytes (every row predating changeset 0019, and any upload whose
--                    content write failed); the original file is gone.
--   HASH_MISMATCH -- bytes exist but do not match the sha256 recorded at registration. Treat the
--                    preserved copy as suspect: something rewrote it, or registration recorded the
--                    hash of a different payload.
--   SIZE_MISMATCH -- length disagrees while the hash matches; effectively impossible given the
--                    octet_length CHECK on the content table, so its appearance means the
--                    registration-side size_bytes is the untrustworthy value.
--   VERIFIED      -- preserved bytes agree with registration on both hash and length.
CREATE OR REPLACE VIEW reconciliation_source_file_recovery AS
SELECT
  source_file.id AS source_file_id,
  source_file.job_id,
  source_file.organization_id,
  source_file.source_system,
  source_file.source_format,
  source_file.file_name,
  source_file.ingestion_mode,
  source_file.approval_status,
  source_file.uploaded_by,
  source_file.uploaded_at,
  content.original_file_name,
  content.original_mime_type,
  source_file.sha256 AS registered_sha256,
  content.sha256 AS preserved_sha256,
  source_file.size_bytes AS registered_byte_size,
  content.byte_size AS preserved_byte_size,
  (content.source_file_id IS NOT NULL) AS content_preserved,
  CASE
    WHEN content.source_file_id IS NULL THEN 'MISSING'
    WHEN content.sha256 IS DISTINCT FROM source_file.sha256 THEN 'HASH_MISMATCH'
    WHEN content.byte_size IS DISTINCT FROM source_file.size_bytes THEN 'SIZE_MISMATCH'
    ELSE 'VERIFIED'
  END AS recovery_status,
  content.captured_at,
  content.retention_expires_at
FROM reconciliation_source_file AS source_file
LEFT JOIN reconciliation_source_file_content AS content
  ON content.source_file_id = source_file.id;

-- ── Lineage view ─────────────────────────────────────────────────────────────────────────────────
-- The full provenance chain for one canonical transaction, flattened to a single row: which file it
-- came from, whether that file was approved and by whom, which mapping profile version normalized it
-- (NULL for direct imports), who promoted it out of staging, and whether the original bytes are
-- still recoverable.
--
-- Every join is LEFT: canonical rows produced by the pre-staging pipeline have no staged transaction
-- and no approval, and this view must show them rather than silently drop them -- 8,888 such rows
-- exist today and they are the bulk of the accounting record.
CREATE OR REPLACE VIEW reconciliation_canonical_lineage AS
SELECT
  canonical.id AS canonical_row_id,
  canonical.job_id,
  canonical.source_system,
  canonical.line_number,
  canonical.transaction_date,
  canonical.amount,
  canonical.raw_row_id,
  canonical.source_file_id,
  source_file.file_name,
  source_file.ingestion_mode,
  staged.id AS staged_transaction_id,
  staged.status AS staged_status,
  staged.promoted_at,
  staged.promoted_by,
  mapping_version.id AS mapping_profile_version_id,
  mapping_version.version_number AS mapping_profile_version_number,
  mapping_profile.name AS mapping_profile_name,
  approval.id AS import_approval_id,
  approval.status AS import_approval_status,
  approval.approved_by,
  approval.decided_at AS import_approved_at,
  (content.source_file_id IS NOT NULL) AS original_bytes_preserved
FROM reconciliation_canonical_row AS canonical
LEFT JOIN reconciliation_source_file AS source_file
  ON source_file.id = canonical.source_file_id
LEFT JOIN reconciliation_staged_transaction AS staged
  ON staged.id = canonical.staged_transaction_id
LEFT JOIN reconciliation_mapping_profile_version AS mapping_version
  ON mapping_version.id = staged.mapping_profile_version_id
LEFT JOIN reconciliation_mapping_profile AS mapping_profile
  ON mapping_profile.id = mapping_version.profile_id
LEFT JOIN reconciliation_import_approval AS approval
  ON approval.source_file_id = canonical.source_file_id
LEFT JOIN reconciliation_source_file_content AS content
  ON content.source_file_id = canonical.source_file_id;

--rollback DROP VIEW IF EXISTS reconciliation_canonical_lineage;
--rollback DROP VIEW IF EXISTS reconciliation_source_file_recovery;
