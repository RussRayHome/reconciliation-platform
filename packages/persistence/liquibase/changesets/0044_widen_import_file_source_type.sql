--liquibase formatted sql

--changeset recon:0044-widen_import_file_source_type splitStatements:false
-- reconciliation-design-v2 review (2026-08-12): generalizes the File Imports & Validation
-- feature from a Bank/GL-only assumption to a 14-value source_type taxonomy (transaction-
-- csv-spec.md v2 §0.5) so the schema doesn't need a disruptive migration once non-Bank/GL
-- source types are actually built (tracked separately, GitHub issue #121 -- not built now,
-- this changeset only widens the column). import_file has no rows yet (Phase 5 ingestion
-- API doesn't exist), so this is a plain rename + CHECK swap, no backfill needed.
--
-- Renaming the COLUMN does not rename its CHECK constraint (Postgres has no "rename
-- constraint on column rename" behavior) -- the old constraint stays named
-- import_file_file_type_check until explicitly dropped, so it's dropped and recreated
-- under the name matching the new column, for readability.
ALTER TABLE import_file RENAME COLUMN file_type TO source_type;

ALTER TABLE import_file DROP CONSTRAINT import_file_file_type_check;

ALTER TABLE import_file
  ADD CONSTRAINT import_file_source_type_check
  CHECK (source_type IN (
    'BANK', 'GL', 'PAYROLL', 'RECEIPT', 'REMITTANCE', 'BILLING', 'VMS', 'FACTOR', 'LOC',
    'TAX', 'BENEFITS', 'TIMEKEEPING', 'INTERCOMPANY', 'ASSIGNMENT', 'LEGAL_ENTITY'
  ));

--rollback ALTER TABLE import_file DROP CONSTRAINT import_file_source_type_check;
--rollback ALTER TABLE import_file RENAME COLUMN source_type TO file_type;
--rollback ALTER TABLE import_file ADD CONSTRAINT import_file_file_type_check CHECK (file_type IN ('BANK', 'GL'));
