--liquibase formatted sql

--changeset recon:0019-create_reconciliation_source_file_content_table
-- Durable byte-for-byte preservation of every uploaded source file.
--
-- Why this table exists: `reconciliation_source_file.storage_uri` was designed as a pointer to an
-- object store that was never wired up -- as of this changeset all 302 registered source files have
-- a NULL storage_uri, and the API parses `file.buffer` (multer.memoryStorage) then discards it. The
-- original workbook is therefore unrecoverable the moment a request ends. If parsing, mapping, or
-- matching is later found to be wrong, there is nothing to re-run against, and an auditor asking
-- "show me the file the analyst actually uploaded" cannot be answered.
--
-- Why a separate table instead of a BYTEA column on reconciliation_source_file: that table is on the
-- hot read path (approval queue, job load, `SELECT *` in the lifecycle store). A sibling table makes
-- it structurally impossible to drag file bodies into those queries, and lets content be purged on a
-- retention schedule while the metadata row -- which carries the audit trail -- is kept forever.
--
-- Why BYTEA rather than an object store: total source volume today is 2.3 MB across 302 files
-- (7.8 KB average), and MAX_UPLOAD_MB caps a single file at 10 MB. At this scale BYTEA keeps the
-- bytes in the same transaction and the same backup as the metadata that describes them, with no
-- second system to operate and no orphaned-blob reconciliation. Revisit if volume approaches the
-- ~1 GB per-field TOAST ceiling or if aggregate size starts to dominate backup windows.
CREATE TABLE IF NOT EXISTS reconciliation_source_file_content (
  -- PK *is* the FK: exactly one content row per source file, enforced structurally.
  source_file_id UUID PRIMARY KEY,

  -- The uploaded file verbatim, exactly as received, with no application-level transformation.
  -- Deliberately NOT gzipped by the application: this column is the last-resort recovery path, so
  -- it must stay readable with nothing but psql when the app is the thing that is broken
  -- (`\copy (SELECT content FROM ...) TO 'out.xlsx' WITH (FORMAT binary)`). Postgres already
  -- compresses and out-of-lines this via TOAST; xlsx is a zip container so it is near-incompressible
  -- either way, and pglz bails out early on it rather than wasting cycles.
  content BYTEA NOT NULL,

  -- Integrity trio. byte_size and sha256 are captured from the upload, then verified against the
  -- stored bytes: the CHECK below makes a truncated write impossible to commit, and sha256 lets a
  -- reader prove the bytes still match what reconciliation_source_file recorded at registration.
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,

  -- Preserved as uploaded. reconciliation_source_file.file_name can be normalized or corrected
  -- later; these two columns are what the user's machine actually sent, which is what an auditor
  -- asks for and what a support engineer needs to reproduce a parse bug.
  original_file_name TEXT NOT NULL,
  original_mime_type TEXT NOT NULL,

  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL means "retain indefinitely". A purge job deletes rows whose expiry has passed; because the
  -- metadata row is in a different table, purging content never destroys the audit trail.
  retention_expires_at TIMESTAMPTZ,

  CONSTRAINT reconciliation_source_file_content_source_file_fk
    FOREIGN KEY (source_file_id) REFERENCES reconciliation_source_file(id) ON DELETE CASCADE,

  -- Self-verifying storage: the database itself rejects a row whose recorded length disagrees with
  -- the bytes stored, so a partial or truncated upload cannot be silently persisted.
  -- Named ..._length_matches_check, not ..._byte_size_check: Postgres auto-names the inline
  -- `byte_size BIGINT NOT NULL CHECK (byte_size >= 0)` constraint above as
  -- `<table>_<column>_check`, so the latter name is already taken on this table.
  CONSTRAINT reconciliation_source_file_content_length_matches_check
    CHECK (octet_length(content) = byte_size)
);

-- Purge-job access path: find expired content without scanning files retained indefinitely.
CREATE INDEX IF NOT EXISTS reconciliation_source_file_content_retention_idx
  ON reconciliation_source_file_content (retention_expires_at)
  WHERE retention_expires_at IS NOT NULL;

-- Lets a recovery query locate preserved bytes by content hash when the source_file id is unknown
-- (for example, reconstructing which upload produced a given exported workbook).
CREATE INDEX IF NOT EXISTS reconciliation_source_file_content_sha_idx
  ON reconciliation_source_file_content (sha256);

--rollback DROP TABLE IF EXISTS reconciliation_source_file_content CASCADE;
