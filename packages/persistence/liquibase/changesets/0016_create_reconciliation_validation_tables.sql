--liquibase formatted sql

--changeset recon:0016-create_reconciliation_validation_tables
CREATE TABLE IF NOT EXISTS reconciliation_validation_rule_version (
  id UUID PRIMARY KEY,
  rule_code TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  scope TEXT NOT NULL CHECK (scope IN ('FILE', 'SCHEMA', 'ROW', 'CROSS_ROW', 'PERIOD', 'ACCOUNTING')),
  severity TEXT NOT NULL CHECK (severity IN ('FATAL', 'WARNING', 'INFO')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPRECATED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_validation_rule_version_key UNIQUE (rule_code, version_number)
);

CREATE TABLE IF NOT EXISTS reconciliation_validation_result (
  id UUID PRIMARY KEY,
  staged_transaction_id UUID,
  source_file_id UUID,
  rule_version_id UUID NOT NULL,
  -- Denormalized from reconciliation_validation_rule_version.severity at insert time so the
  -- approval-queue read path (see changeset 0018) can filter by severity without a join,
  -- matching the denormalization style already used on reconciliation_canonical_row.
  severity TEXT NOT NULL CHECK (severity IN ('FATAL', 'WARNING', 'INFO')),
  passed BOOLEAN NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_validation_result_staged_transaction_fk
    FOREIGN KEY (staged_transaction_id) REFERENCES reconciliation_staged_transaction(id) ON DELETE CASCADE,
  CONSTRAINT reconciliation_validation_result_source_file_fk
    FOREIGN KEY (source_file_id) REFERENCES reconciliation_source_file(id) ON DELETE CASCADE,
  CONSTRAINT reconciliation_validation_result_rule_version_fk
    FOREIGN KEY (rule_version_id) REFERENCES reconciliation_validation_rule_version(id) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_validation_result_target_check
    CHECK (staged_transaction_id IS NOT NULL OR source_file_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS reconciliation_validation_result_staged_transaction_idx
  ON reconciliation_validation_result (staged_transaction_id)
  WHERE staged_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_validation_result_source_file_idx
  ON reconciliation_validation_result (source_file_id)
  WHERE source_file_id IS NOT NULL;

--rollback DROP TABLE IF EXISTS reconciliation_validation_result CASCADE;
--rollback DROP TABLE IF EXISTS reconciliation_validation_rule_version CASCADE;
