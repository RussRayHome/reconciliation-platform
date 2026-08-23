--liquibase formatted sql

--changeset recon:0060-create_reconciliation_run_account splitStatements:false
-- Unreconciled Item Roll-Forward, PR A. reconciliation_run.account_identifier is a single
-- nullable TEXT, but one run can span 1-4 real bank accounts (commit 6077d55, mergeBankFiles) --
-- a reconciling item belongs to exactly one of them, so carrying it forward against the run as a
-- whole would be meaningless. Mirrors the exact move changeset 0045 made replacing
-- reconciliation_run's scalar bank_file_id/gl_file_id with the run_source_file join table.
--
-- reconciliation_run.account_identifier is left in place -- this does not yet change what the run
-- itself records, only adds the normalized link. Deprecating the scalar column is a later,
-- separate change once every reader has migrated to this table.
CREATE TABLE IF NOT EXISTS reconciliation_run_account (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  reconciliation_run_id UUID NOT NULL REFERENCES reconciliation_run (id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES reconciliation_account (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_run_account_run_account_key
    UNIQUE (reconciliation_run_id, account_id)
);

CREATE INDEX IF NOT EXISTS reconciliation_run_account_organization_idx
  ON reconciliation_run_account (organization_id);
CREATE INDEX IF NOT EXISTS reconciliation_run_account_run_idx
  ON reconciliation_run_account (reconciliation_run_id);
CREATE INDEX IF NOT EXISTS reconciliation_run_account_account_idx
  ON reconciliation_run_account (account_id);

-- Backfill one row per existing run from its scalar account_identifier, resolved against the
-- reconciliation_account rows changeset 0059 just backfilled. A run with a NULL
-- account_identifier gets no row here -- there is nothing to resolve it to.
INSERT INTO reconciliation_run_account (id, organization_id, reconciliation_run_id, account_id)
SELECT gen_random_uuid(), r.organization_id, r.id, a.id
  FROM reconciliation_run r
  JOIN reconciliation_account a
    ON a.organization_id = r.organization_id
   AND a.account_identifier = r.account_identifier
 WHERE r.account_identifier IS NOT NULL
ON CONFLICT (reconciliation_run_id, account_id) DO NOTHING;

ALTER TABLE reconciliation_run_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_run_account_tenant_isolation ON reconciliation_run_account
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

--rollback DROP POLICY IF EXISTS reconciliation_run_account_tenant_isolation ON reconciliation_run_account;
--rollback DROP TABLE IF EXISTS reconciliation_run_account CASCADE;
