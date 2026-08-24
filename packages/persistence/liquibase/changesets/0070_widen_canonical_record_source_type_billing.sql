--liquibase formatted sql

--changeset recon:0070-widen_canonical_record_source_type_billing splitStatements:false
-- R1 (AP inclusion), WP0.1: canonical_record.source_type carries its own CHECK constraint,
-- separate from both unions the R1 design handoff analyzed (fileValidation's shallow
-- 'BANK'|'GL' union and domain's deep SourceSystem union) -- neither of those docs accounted
-- for this one. importValidationService.ts's toCanonicalRecordInput maps a validated
-- NormalizedRecord.sourceSystem straight into CanonicalRecordInput.sourceType, which persists
-- here, so a validated BILLING file would fail this constraint at INSERT without this change.
--
-- The constraint's own name (normalized_record_source_system_check) predates two renames
-- (changeset 0046: table normalized_record -> canonical_record, column source_system ->
-- source_type) -- Postgres doesn't rename constraints when the table/column they're attached to
-- is renamed, so the original auto-generated name is still current; confirmed against the live
-- schema (pg_constraint) rather than assumed.
--
-- Mirrors changeset 0044's own precedent for the identical class of change on the sibling
-- import_file.source_type column: widen an existing CHECK's value list on an existing column,
-- no new table, no touch to either of the other two unions.
ALTER TABLE canonical_record DROP CONSTRAINT normalized_record_source_system_check;
ALTER TABLE canonical_record ADD CONSTRAINT normalized_record_source_system_check
  CHECK (source_type IN ('BANK', 'GL', 'BILLING'));

--rollback ALTER TABLE canonical_record DROP CONSTRAINT normalized_record_source_system_check;
--rollback ALTER TABLE canonical_record ADD CONSTRAINT normalized_record_source_system_check CHECK (source_type IN ('BANK', 'GL'));
