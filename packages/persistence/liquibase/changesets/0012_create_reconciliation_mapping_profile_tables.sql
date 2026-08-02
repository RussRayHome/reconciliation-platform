--liquibase formatted sql

--changeset recon:0012-create_reconciliation_mapping_profile_tables
CREATE TABLE IF NOT EXISTS reconciliation_mapping_profile (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bank', 'qbo')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPRECATED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_mapping_profile_organization_fk
    FOREIGN KEY (organization_id) REFERENCES reconciliation_organization(id) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_mapping_profile_org_name_key UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS reconciliation_mapping_profile_organization_idx
  ON reconciliation_mapping_profile (organization_id, source_type);

CREATE TABLE IF NOT EXISTS reconciliation_mapping_profile_version (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  column_mapping JSONB NOT NULL,
  transformation_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPRECATED')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_mapping_profile_version_profile_fk
    FOREIGN KEY (profile_id) REFERENCES reconciliation_mapping_profile(id) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_mapping_profile_version_created_by_fk
    FOREIGN KEY (created_by) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_mapping_profile_version_key UNIQUE (profile_id, version_number)
);

CREATE INDEX IF NOT EXISTS reconciliation_mapping_profile_version_profile_idx
  ON reconciliation_mapping_profile_version (profile_id, status);

--rollback DROP TABLE IF EXISTS reconciliation_mapping_profile_version CASCADE;
--rollback DROP TABLE IF EXISTS reconciliation_mapping_profile CASCADE;
