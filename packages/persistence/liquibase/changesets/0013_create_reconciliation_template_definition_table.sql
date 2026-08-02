--liquibase formatted sql

--changeset recon:0013-create_reconciliation_template_definition_table
CREATE TABLE IF NOT EXISTS reconciliation_template_definition (
  id UUID PRIMARY KEY,
  template_type TEXT NOT NULL CHECK (template_type IN ('bank', 'qbo')),
  version INTEGER NOT NULL CHECK (version > 0),
  headers_json JSONB NOT NULL,
  instructions TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPRECATED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_template_definition_type_version_key UNIQUE (template_type, version)
);

CREATE INDEX IF NOT EXISTS reconciliation_template_definition_active_idx
  ON reconciliation_template_definition (template_type, status);

--rollback DROP TABLE IF EXISTS reconciliation_template_definition CASCADE;
