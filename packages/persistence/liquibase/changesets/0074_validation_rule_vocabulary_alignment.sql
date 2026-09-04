--liquibase formatted sql

--changeset recon:0074-validation_rule_vocabulary_alignment splitStatements:false
-- H8 (Issue #277). Two rival validation-rule vocabularies exist. This changeset makes
-- reconciliation_validation_rule_version the authoritative shape and widens the shared status
-- vocabulary on both.
--
-- The two families and why the rival is the target:
--
--   validation_rule_version                 79 rows, written by the live File Validation engine.
--                                           scope: SCHEMA|FILE|ROW|CROSS_ROW
--                                           HAS source_type: BANK|GL|BILLING
--   reconciliation_validation_rule_version  0 rows, no production writer.
--                                           scope: adds PERIOD|ACCOUNTING -- the two the accounting
--                                           tier needs and the live table has no member for
--                                           NO source_type column at all
--
-- The rival already carries the scope vocabulary the accounting tier requires; what it lacked was
-- the source dimension. Adding source_type here makes it a strict superset of the live table rather
-- than an alternative to it, which is what lets it become authoritative without discarding anything
-- the live table expresses.
--
-- source_type is NULLABLE, matching validation_rule_version's own definition: a SCHEMA- or
-- FILE-scoped rule is not specific to one source, and forcing a value would mean inventing one.
--
-- Severity and status are deliberately NOT touched. The two families disagree (ERROR|WARNING against
-- FATAL|WARNING|INFO) and settling that changes the meaning of stored rows on the live side, so it
-- is a separate decision from the structural alignment done here.
ALTER TABLE reconciliation_validation_rule_version
  ADD COLUMN IF NOT EXISTS source_type TEXT;

ALTER TABLE reconciliation_validation_rule_version
  ADD CONSTRAINT reconciliation_validation_rule_version_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('BANK', 'GL', 'BILLING'));

--rollback ALTER TABLE reconciliation_validation_rule_version DROP CONSTRAINT IF EXISTS reconciliation_validation_rule_version_source_type_check;
--rollback ALTER TABLE reconciliation_validation_rule_version DROP COLUMN IF EXISTS source_type;
