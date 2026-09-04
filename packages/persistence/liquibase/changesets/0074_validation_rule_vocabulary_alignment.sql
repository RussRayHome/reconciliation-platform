--liquibase formatted sql

--changeset recon:0074-validation_rule_vocabulary_alignment splitStatements:false
-- H8 (Issue #277). Collapses two rival validation-rule families into one.
--
-- Before this, the same two concepts existed twice:
--
--   validation_rule_version / validation_issue                        <- LIVE
--     79 rules + real findings. Read and written by importValidationStore on every run.
--     scope    SCHEMA | FILE | ROW | CROSS_ROW
--     severity ERROR | WARNING
--
--   reconciliation_validation_rule_version / reconciliation_validation_result   <- LEGACY
--     0 rows, no reader, no writer, referenced only by each other.
--     scope    adds PERIOD | ACCOUNTING
--     severity FATAL | WARNING | INFO
--
-- The legacy pair is from changeset 0016 and was superseded by the File Validation engine --
-- `core/fileValidation/ruleCatalog.ts:11` says so outright: the engine's scope type "mirrors the
-- OLDER reconciliation_validation_rule_version.scope convention". It survived only because nothing
-- removed it, and its sole remaining advantage was three enum values the live tables lacked.
--
-- Adding three enum values to a working table is cheaper than migrating a working pipeline onto an
-- empty one, so the live pair keeps its data, its readers and its writers, and gains the vocabulary:
--
--   scope    + PERIOD, ACCOUNTING   -- the accounting tier's home. It had none: the live type had
--                                      no member for a period- or accounting-level assertion, which
--                                      is what H8 was actually about.
--   severity + INFO                 -- advisory checks that must not fail a run. ERROR and WARNING
--                                      are untouched, so none of the 79 rules is rewritten. FATAL
--                                      is not carried over: it was a second word for ERROR, and two
--                                      words for one severity is how this divergence began.
ALTER TABLE validation_rule_version
  DROP CONSTRAINT IF EXISTS validation_rule_version_scope_check;

ALTER TABLE validation_rule_version
  ADD CONSTRAINT validation_rule_version_scope_check
  CHECK (scope IN ('SCHEMA', 'FILE', 'ROW', 'CROSS_ROW', 'PERIOD', 'ACCOUNTING'));

ALTER TABLE validation_rule_version
  DROP CONSTRAINT IF EXISTS validation_rule_version_severity_check;

ALTER TABLE validation_rule_version
  ADD CONSTRAINT validation_rule_version_severity_check
  CHECK (severity IN ('ERROR', 'WARNING', 'INFO'));

ALTER TABLE validation_issue
  DROP CONSTRAINT IF EXISTS validation_issue_severity_check;

ALTER TABLE validation_issue
  ADD CONSTRAINT validation_issue_severity_check
  CHECK (severity IN ('ERROR', 'WARNING', 'INFO'));

-- Dropped, not deprecated. Both are empty, neither has a reader or writer in application code, and
-- the only foreign key into either comes from the other -- so they come out together with nothing
-- left dangling. Leaving them would preserve exactly the two-sources-of-truth problem that this
-- migration exists to end.
DROP TABLE IF EXISTS reconciliation_validation_result;
DROP TABLE IF EXISTS reconciliation_validation_rule_version;

-- The rollback recreates both tables exactly as they stood before the drop -- every constraint and
-- index under its ORIGINAL name, not the name Postgres would auto-generate. That matters: earlier
-- earlier migrations' own rollbacks reference these by name (the tenancy rollback does
-- `DROP CONSTRAINT reconciliation_validation_result_organization_fk`), and an inline `REFERENCES`
-- would have produced `..._organization_id_fkey` instead, breaking any rollback that unwinds past
-- this point. Verified against the live definitions before being written.
--rollback CREATE TABLE reconciliation_validation_rule_version (id UUID PRIMARY KEY, rule_code TEXT NOT NULL, version_number INTEGER NOT NULL, scope TEXT NOT NULL, severity TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
--rollback ALTER TABLE reconciliation_validation_rule_version ADD CONSTRAINT reconciliation_validation_rule_version_version_number_check CHECK (version_number > 0);
--rollback ALTER TABLE reconciliation_validation_rule_version ADD CONSTRAINT reconciliation_validation_rule_version_scope_check CHECK (scope IN ('FILE','SCHEMA','ROW','CROSS_ROW','PERIOD','ACCOUNTING'));
--rollback ALTER TABLE reconciliation_validation_rule_version ADD CONSTRAINT reconciliation_validation_rule_version_severity_check CHECK (severity IN ('FATAL','WARNING','INFO'));
--rollback ALTER TABLE reconciliation_validation_rule_version ADD CONSTRAINT reconciliation_validation_rule_version_status_check CHECK (status IN ('ACTIVE','DEPRECATED'));
--rollback ALTER TABLE reconciliation_validation_rule_version ADD CONSTRAINT reconciliation_validation_rule_version_key UNIQUE (rule_code, version_number);
--rollback CREATE TABLE reconciliation_validation_result (id UUID PRIMARY KEY, staged_transaction_id UUID, source_file_id UUID, rule_version_id UUID NOT NULL, severity TEXT NOT NULL, passed BOOLEAN NOT NULL, message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), organization_id UUID NOT NULL);
--rollback ALTER TABLE reconciliation_validation_result ADD CONSTRAINT reconciliation_validation_result_severity_check CHECK (severity IN ('FATAL','WARNING','INFO'));
--rollback ALTER TABLE reconciliation_validation_result ADD CONSTRAINT reconciliation_validation_result_target_check CHECK (staged_transaction_id IS NOT NULL OR source_file_id IS NOT NULL);
--rollback ALTER TABLE reconciliation_validation_result ADD CONSTRAINT reconciliation_validation_result_staged_transaction_fk FOREIGN KEY (staged_transaction_id) REFERENCES reconciliation_staged_transaction(id) ON DELETE CASCADE;
--rollback ALTER TABLE reconciliation_validation_result ADD CONSTRAINT reconciliation_validation_result_source_file_fk FOREIGN KEY (source_file_id) REFERENCES reconciliation_source_file(id) ON DELETE CASCADE;
--rollback ALTER TABLE reconciliation_validation_result ADD CONSTRAINT reconciliation_validation_result_rule_version_fk FOREIGN KEY (rule_version_id) REFERENCES reconciliation_validation_rule_version(id) ON DELETE RESTRICT;
--rollback ALTER TABLE reconciliation_validation_result ADD CONSTRAINT reconciliation_validation_result_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization(id);
--rollback CREATE INDEX reconciliation_validation_result_staged_transaction_idx ON reconciliation_validation_result (staged_transaction_id) WHERE staged_transaction_id IS NOT NULL;
--rollback CREATE INDEX reconciliation_validation_result_source_file_idx ON reconciliation_validation_result (source_file_id) WHERE source_file_id IS NOT NULL;
--rollback CREATE INDEX reconciliation_validation_result_severity_idx ON reconciliation_validation_result (severity, staged_transaction_id);
--rollback CREATE INDEX reconciliation_validation_result_organization_idx ON reconciliation_validation_result (organization_id);
--rollback ALTER TABLE validation_issue DROP CONSTRAINT IF EXISTS validation_issue_severity_check;
--rollback ALTER TABLE validation_issue ADD CONSTRAINT validation_issue_severity_check CHECK (severity IN ('ERROR','WARNING'));
--rollback ALTER TABLE validation_rule_version DROP CONSTRAINT IF EXISTS validation_rule_version_severity_check;
--rollback ALTER TABLE validation_rule_version ADD CONSTRAINT validation_rule_version_severity_check CHECK (severity IN ('ERROR','WARNING'));
--rollback ALTER TABLE validation_rule_version DROP CONSTRAINT IF EXISTS validation_rule_version_scope_check;
--rollback ALTER TABLE validation_rule_version ADD CONSTRAINT validation_rule_version_scope_check CHECK (scope IN ('SCHEMA','FILE','ROW','CROSS_ROW'));
