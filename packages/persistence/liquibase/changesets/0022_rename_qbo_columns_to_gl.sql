--liquibase formatted sql

--changeset recon:0022-rename_qbo_columns_to_gl
-- Renames every column carrying the legacy "qbo" name to "gl". The product renamed the QuickBooks
-- Online side to the general ledger some time ago -- packages/domain/src/messages.ts already maps
-- MissingFromQBO to the display string "Missing from GL" -- but the physical schema and the internal
-- identifiers never followed. This changeset closes that gap for column names; changeset 0023 does
-- the same for stored enum values.
--
-- Column renames preserve data, constraints, indexes, and defaults: PostgreSQL rewrites the catalog
-- entry rather than the heap, so these are metadata-only operations regardless of table size.

ALTER TABLE reconciliation_job_summary RENAME COLUMN qbo_records TO gl_records;
ALTER TABLE reconciliation_job_summary RENAME COLUMN qbo_duplicates TO gl_duplicates;
ALTER TABLE reconciliation_job_summary RENAME COLUMN missing_from_qbo TO missing_from_gl;
ALTER TABLE reconciliation_job_summary
  RENAME COLUMN unmatched_qbo_net_amount TO unmatched_gl_net_amount;

ALTER TABLE reconciliation_match_group RENAME COLUMN qbo_transaction_ids TO gl_transaction_ids;
ALTER TABLE reconciliation_match_group RENAME COLUMN qbo_members_json TO gl_members_json;

ALTER TABLE reconciliation_match_result RENAME COLUMN qbo_transaction_id TO gl_transaction_id;

-- Renaming a column does not rename indexes built on it, so this partial index (from changeset 0003)
-- would otherwise keep advertising the retired vocabulary in its name. Renamed here rather than in
-- 0003 itself because 0003 is already applied in every environment and editing an applied changeset
-- invalidates its Liquibase checksum.
ALTER INDEX reconciliation_match_result_job_qbo_transaction_lookup_idx
  RENAME TO reconciliation_match_result_job_gl_transaction_lookup_idx;

--rollback ALTER INDEX reconciliation_match_result_job_gl_transaction_lookup_idx RENAME TO reconciliation_match_result_job_qbo_transaction_lookup_idx;
--rollback ALTER TABLE reconciliation_match_result RENAME COLUMN gl_transaction_id TO qbo_transaction_id;
--rollback ALTER TABLE reconciliation_match_group RENAME COLUMN gl_members_json TO qbo_members_json;
--rollback ALTER TABLE reconciliation_match_group RENAME COLUMN gl_transaction_ids TO qbo_transaction_ids;
--rollback ALTER TABLE reconciliation_job_summary RENAME COLUMN unmatched_gl_net_amount TO unmatched_qbo_net_amount;
--rollback ALTER TABLE reconciliation_job_summary RENAME COLUMN missing_from_gl TO missing_from_qbo;
--rollback ALTER TABLE reconciliation_job_summary RENAME COLUMN gl_duplicates TO qbo_duplicates;
--rollback ALTER TABLE reconciliation_job_summary RENAME COLUMN gl_records TO qbo_records;
