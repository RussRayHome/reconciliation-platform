--liquibase formatted sql

--changeset recon:0015-create_reconciliation_staged_transaction_table
CREATE TABLE IF NOT EXISTS reconciliation_staged_transaction (
  id UUID PRIMARY KEY,
  raw_row_id UUID NOT NULL,
  source_file_id UUID NOT NULL,
  mapping_profile_version_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_VALIDATION'
    CHECK (status IN ('PENDING_VALIDATION', 'VALID', 'INVALID', 'PROMOTED')),
  normalized_fields_json JSONB NOT NULL,
  validation_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  control_total_amount NUMERIC(19, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_staged_transaction_raw_row_fk
    FOREIGN KEY (raw_row_id) REFERENCES reconciliation_raw_row(id) ON DELETE CASCADE,
  CONSTRAINT reconciliation_staged_transaction_source_file_fk
    FOREIGN KEY (source_file_id) REFERENCES reconciliation_source_file(id) ON DELETE CASCADE,
  CONSTRAINT reconciliation_staged_transaction_mapping_profile_version_fk
    FOREIGN KEY (mapping_profile_version_id) REFERENCES reconciliation_mapping_profile_version(id) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_staged_transaction_raw_row_key UNIQUE (raw_row_id)
);

CREATE INDEX IF NOT EXISTS reconciliation_staged_transaction_source_file_idx
  ON reconciliation_staged_transaction (source_file_id, status);

CREATE INDEX IF NOT EXISTS reconciliation_staged_transaction_mapping_profile_version_idx
  ON reconciliation_staged_transaction (mapping_profile_version_id);

--rollback DROP TABLE IF EXISTS reconciliation_staged_transaction CASCADE;
