--liquibase formatted sql

--changeset recon:0039-create_reconciliation_matching_config_version_table splitStatements:false
-- Append-only, immutable versions of the matching engine's variance-threshold overrides
-- (MatchingConfig fields), one row per publish action -- same shape/intent as
-- reconciliation_mapping_profile_version (changeset 0012). At most one ACTIVE and at most one
-- DRAFT version may exist per organization at a time, enforced by the two partial unique indexes
-- below rather than only in application code.
--
-- published_by/published_at/effective_at/pending_approval_owner stay NULL for a DRAFT and are
-- filled in atomically when it is published (moved to ACTIVE, with the previous ACTIVE row moved
-- to SUPERSEDED in the same transaction -- see publishMatchingConfigVersion in
-- packages/persistence/src/readModelStore.ts). effective_at is deliberately distinct from
-- published_at: a version can be published now but scheduled to take effect on a later date.
--
-- Tenant-scoped (organization_id NOT NULL) like reconciliation_mapping_profile_version, so RLS is
-- enabled inline here rather than deferred to a later batch changeset like 0030 -- that changeset
-- predates this table and was a one-time backfill for tables that existed before RLS rollout; any
-- new tenant-scoped table added after it should ship with RLS from its first changeset.
CREATE TABLE IF NOT EXISTS reconciliation_matching_config_version (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  variance_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by TEXT,
  published_at TIMESTAMPTZ,
  effective_at TIMESTAMPTZ,
  pending_approval_owner TEXT,
  CONSTRAINT reconciliation_matching_config_version_organization_fk
    FOREIGN KEY (organization_id) REFERENCES reconciliation_organization(id) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_matching_config_version_created_by_fk
    FOREIGN KEY (created_by) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_matching_config_version_published_by_fk
    FOREIGN KEY (published_by) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_matching_config_version_pending_owner_fk
    FOREIGN KEY (pending_approval_owner) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_matching_config_version_key UNIQUE (organization_id, version_number)
);

CREATE INDEX IF NOT EXISTS reconciliation_matching_config_version_org_status_idx
  ON reconciliation_matching_config_version (organization_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_matching_config_version_one_active_idx
  ON reconciliation_matching_config_version (organization_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_matching_config_version_one_draft_idx
  ON reconciliation_matching_config_version (organization_id)
  WHERE status = 'DRAFT';

ALTER TABLE reconciliation_matching_config_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_matching_config_version_tenant_isolation
  ON reconciliation_matching_config_version
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

--rollback DROP TABLE IF EXISTS reconciliation_matching_config_version CASCADE;
