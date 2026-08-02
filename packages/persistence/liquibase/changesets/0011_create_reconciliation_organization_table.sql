--liquibase formatted sql

--changeset recon:0011-create_reconciliation_organization_table
CREATE TABLE IF NOT EXISTS reconciliation_organization (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_organization_name_key UNIQUE (name)
);

--rollback DROP TABLE IF EXISTS reconciliation_organization CASCADE;
