--liquibase formatted sql

--changeset recon:0059-create_reconciliation_account splitStatements:false
-- Unreconciled Item Roll-Forward, PR A (foundation, no behaviour change): first-class account
-- entity. Today `reconciliation_run.account_identifier` and `reconciliation_canonical_row.
-- account_identifier` are both nullable free TEXT with no shared referent -- nothing stops two
-- runs spelling the same real bank account two different ways. A carried-forward open item is
-- meaningless without a stable account to key it to (see reconciliation_run_account and
-- reconciliation_open_item, changesets 0060/0063), so that identity has to exist before either.
--
-- id is an application-supplied UUID (no DEFAULT), matching every other table in this schema.
CREATE TABLE IF NOT EXISTS reconciliation_account (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  account_identifier TEXT NOT NULL,
  institution_name TEXT,
  display_name TEXT,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_account_org_identifier_key
    UNIQUE (organization_id, account_identifier)
);

CREATE INDEX IF NOT EXISTS reconciliation_account_organization_idx
  ON reconciliation_account (organization_id);

-- Backfill one row per distinct (organization, account_identifier) already referenced from either
-- of today's two free-text sources -- reconciliation_run (the newer File Imports & Validation
-- envelope) and reconciliation_canonical_row (the matching engine's own per-row attribution,
-- present since the very first schema migration). ON CONFLICT DO NOTHING: the same identifier
-- legitimately appears in both.
INSERT INTO reconciliation_account (id, organization_id, account_identifier)
SELECT gen_random_uuid(), organization_id, account_identifier
  FROM reconciliation_run
 WHERE account_identifier IS NOT NULL
GROUP BY organization_id, account_identifier
ON CONFLICT (organization_id, account_identifier) DO NOTHING;

INSERT INTO reconciliation_account (id, organization_id, account_identifier)
SELECT gen_random_uuid(), organization_id, account_identifier
  FROM reconciliation_canonical_row
 WHERE account_identifier IS NOT NULL
GROUP BY organization_id, account_identifier
ON CONFLICT (organization_id, account_identifier) DO NOTHING;

-- Known real accounts (see design/matching/engine/matching-instrument-gating-and-aging-plan.md's fixture analysis
-- and this plan's own §3.3): 1061/5703 are Truist, 5259/5042 are Huntington. Only updates a row
-- that the backfill above actually created for that identifier in some organization -- this does
-- not invent accounts that were never referenced.
UPDATE reconciliation_account SET institution_name = 'Truist' WHERE account_identifier IN ('1061', '5703');
UPDATE reconciliation_account SET institution_name = 'Huntington' WHERE account_identifier IN ('5259', '5042');

ALTER TABLE reconciliation_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_account_tenant_isolation ON reconciliation_account
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

CREATE TRIGGER trg_reconciliation_account_updated_at
  BEFORE UPDATE ON reconciliation_account
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--rollback DROP TRIGGER IF EXISTS trg_reconciliation_account_updated_at ON reconciliation_account;
--rollback DROP POLICY IF EXISTS reconciliation_account_tenant_isolation ON reconciliation_account;
--rollback DROP TABLE IF EXISTS reconciliation_account CASCADE;
