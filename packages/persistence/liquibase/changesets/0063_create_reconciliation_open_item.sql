--liquibase formatted sql

--changeset recon:0063-create_reconciliation_open_item splitStatements:false
-- Unreconciled Item Roll-Forward, PR B (schema for open items, unused on landing -- nothing
-- writes to this table until PR C). The disposition record for a reconciling item that survives
-- across periods: opened once when first detected, stays OPEN until it clears or is written off.
-- Deliberately a separate table from reconciliation_exception, not a lifecycle extension of it --
-- reconciliation_exception stays what it honestly is, a per-run detection record cascading from
-- the job; this is the thing that outlives any single run's evidence. "Rolling forward" is a
-- query over open items, never a copy operation: recreating the item each period would break
-- aging (which reads from original_transaction_date, not "when this was first opened"), inflate
-- counts, hide repeat offenders, and make the tie-out (reconciliation_period_rollforward, the
-- table two changesets after this one) unprovable.
--
-- Critically: no ON DELETE CASCADE from any job or run reference below -- every one is SET NULL.
-- Deleting the run that opened or cleared an item erases that run's own evidence, never the
-- item's own history. natural_key/natural_key_tier are populated by PR C's tiered key derivation
-- (packages/core/src/rollforward/naturalKey.ts) -- see the plan's own doc for the three tiers
-- (check number, reference+amount, and a same-day/amount/token fingerprint as the fallback).
CREATE TABLE IF NOT EXISTS reconciliation_open_item (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  account_id UUID NOT NULL REFERENCES reconciliation_account (id),
  opened_in_run_id UUID REFERENCES reconciliation_run (id) ON DELETE SET NULL,
  first_detected_job_id UUID REFERENCES reconciliation_job (id) ON DELETE SET NULL,
  source_system TEXT NOT NULL CHECK (source_system IN ('bank', 'gl')),
  -- The carry-eligible subset of reconciliation_exception's own category domain (see the plan's
  -- §3.7): timing differences and genuine unreconciled items that will either self-clear or need
  -- an owner and due date on the support schedule. Data-quality/review-artifact categories
  -- (duplicates, invalid data, ambiguous matches, likely miscodings -- fixed at source, not aged)
  -- never become an open item at all. PR C's carry-eligibility map
  -- (Record<ErrorCategory, boolean>, exhaustive over errorCategories) is the enforced source of
  -- truth at the application layer; this CHECK is the database-level backstop.
  category TEXT NOT NULL CHECK (category IN (
    'OutstandingCheck', 'StaleOutstandingCheck', 'DepositInTransit', 'MissingFromBank',
    'MissingFromGL', 'TimingDifference', 'IntercompanyMismatch', 'NSFReturnedDeposit',
    'AmountMismatch'
  )),
  natural_key TEXT NOT NULL,
  natural_key_tier SMALLINT NOT NULL CHECK (natural_key_tier IN (1, 2, 3)),
  original_transaction_date DATE NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  check_number TEXT,
  reference_number TEXT,
  description_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'CLEARED', 'WRITTEN_OFF', 'ADJUSTED', 'VOIDED', 'SUPERSEDED'
  )),
  owner_user_id UUID REFERENCES reconciliation_user (id),
  due_date DATE,
  cleared_in_run_id UUID REFERENCES reconciliation_run (id) ON DELETE SET NULL,
  cleared_at TIMESTAMPTZ,
  cleared_match_result_id UUID REFERENCES reconciliation_match_result (id) ON DELETE SET NULL,
  -- Populated by PR E's write-off path; left undefined here since the exact code list is a policy
  -- decision (§8 open decision: write-off approval thresholds), not an engineering one.
  disposition_code TEXT,
  disposition_note TEXT,
  superseded_by_open_item_id UUID REFERENCES reconciliation_open_item (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Two open items for the same physical item become impossible; a cleared item does not block a
-- genuine later recurrence of the same check number (a fresh check reusing a number, or a
-- deposit-in-transit pattern repeating next period) since the partial index only covers OPEN rows.
CREATE UNIQUE INDEX reconciliation_open_item_natural_key_open_key
  ON reconciliation_open_item (organization_id, account_id, natural_key)
  WHERE status = 'OPEN';

CREATE INDEX reconciliation_open_item_aging_idx
  ON reconciliation_open_item (organization_id, account_id, status, original_transaction_date);

CREATE INDEX reconciliation_open_item_opened_in_run_idx
  ON reconciliation_open_item (opened_in_run_id) WHERE opened_in_run_id IS NOT NULL;
CREATE INDEX reconciliation_open_item_cleared_in_run_idx
  ON reconciliation_open_item (cleared_in_run_id) WHERE cleared_in_run_id IS NOT NULL;

ALTER TABLE reconciliation_open_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_open_item_tenant_isolation ON reconciliation_open_item
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

CREATE TRIGGER trg_reconciliation_open_item_updated_at
  BEFORE UPDATE ON reconciliation_open_item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--rollback DROP TRIGGER IF EXISTS trg_reconciliation_open_item_updated_at ON reconciliation_open_item;
--rollback DROP POLICY IF EXISTS reconciliation_open_item_tenant_isolation ON reconciliation_open_item;
--rollback DROP TABLE IF EXISTS reconciliation_open_item CASCADE;
