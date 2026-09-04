--liquibase formatted sql

--changeset recon:0073-retire_remaining_qbo_naming splitStatements:false
-- Retires the last two schema objects still carrying the pre-rename QBO vocabulary, finishing the
-- job changeset 0022 started.
--
-- 0022 renamed the seven qbo_* columns to gl_*, and it already knew that renaming a column does
-- not rename the objects attached to it -- it explicitly renamed
-- reconciliation_match_result_job_qbo_transaction_lookup_idx for exactly that reason. It caught
-- one of the two indexes and none of the constraints, so a live database still answers to 'qbo'
-- on:
--
--   reconciliation_match_result_qbo_transaction_idx  (partial index on gl_transaction_id)
--   reconciliation_match_result_qbo_transaction_fk   (FK on gl_transaction_id)
--
-- Both already point at gl_transaction_id; only their names lag. The bank side of this same table
-- is reconciliation_match_result_bank_transaction_idx / _bank_transaction_fk, so these renames
-- restore symmetry rather than inventing a convention.
--
-- Metadata-only: RENAME rewrites the catalog entry without rebuilding the index or revalidating
-- the constraint, so no data moves and the table is not held for any meaningful duration.
--
-- Deliberately out of scope: changesets 0001-0023 still contain the old spelling. They are the
-- applied history of the rename (0022 is literally rename_qbo_columns_to_gl), Liquibase checksums
-- them, and editing an applied changeset breaks validation. Likewise the uploaded file names 0023
-- preserved -- see this directory's README on why rewriting those would fabricate audit history.
ALTER INDEX reconciliation_match_result_qbo_transaction_idx
  RENAME TO reconciliation_match_result_gl_transaction_idx;

ALTER TABLE reconciliation_match_result
  RENAME CONSTRAINT reconciliation_match_result_qbo_transaction_fk
  TO reconciliation_match_result_gl_transaction_fk;

-- reconciliation_payee_alias.source_direction still DEFAULTs to 'bank_to_qbo'. 0023 migrated the
-- stored values and narrowed the CHECK to ('bank_to_gl', 'bidirectional') but left the default
-- pointing at a value that constraint now rejects, so the column's own default violates its own
-- check: any INSERT omitting source_direction fails with
-- payee_alias_source_direction_check. Verified against the live dev database.
--
-- Latent rather than live: the only production writer (readModelStore.ts's createPayeeAlias)
-- always supplies the column, falling back to 'bank_to_gl' in application code, so nothing hits
-- this today. It is a landmine for the next writer that relies on the default -- a backfill, a
-- manual fix-up, or a new code path.
ALTER TABLE reconciliation_payee_alias
  ALTER COLUMN source_direction SET DEFAULT 'bank_to_gl';

--rollback ALTER TABLE reconciliation_payee_alias ALTER COLUMN source_direction SET DEFAULT 'bank_to_qbo';
--rollback ALTER TABLE reconciliation_match_result RENAME CONSTRAINT reconciliation_match_result_gl_transaction_fk TO reconciliation_match_result_qbo_transaction_fk;
--rollback ALTER INDEX reconciliation_match_result_gl_transaction_idx RENAME TO reconciliation_match_result_qbo_transaction_idx;
