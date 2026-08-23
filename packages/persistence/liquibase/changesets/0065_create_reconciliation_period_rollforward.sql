--liquibase formatted sql

--changeset recon:0065-create_reconciliation_period_rollforward splitStatements:false
-- Unreconciled Item Roll-Forward, PR B. One snapshot row per (run, account) asserting the control
-- equation the plan's own §3.1 defines:
--
--   opening_open_items + items_opened_this_period - items_cleared_this_period
--     - items_written_off_this_period = closing_open_items
--
-- Asserted here as a database CHECK constraint, in both count and amount, not only in application
-- code -- PR E's close operation recomputes this snapshot and the close itself fails if either
-- constraint would be violated, so a broken roll-forward can never be silently frozen into a
-- closed period.
--
-- Unlike reconciliation_open_item (which deliberately outlives any single run, every run
-- reference SET NULL), this snapshot belongs to the run that computed it and is meaningless
-- without it -- run_id cascades on delete.
CREATE TABLE IF NOT EXISTS reconciliation_period_rollforward (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  reconciliation_run_id UUID NOT NULL REFERENCES reconciliation_run (id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES reconciliation_account (id),
  opening_count INTEGER NOT NULL,
  new_count INTEGER NOT NULL,
  cleared_count INTEGER NOT NULL,
  written_off_count INTEGER NOT NULL,
  closing_count INTEGER NOT NULL,
  opening_amount NUMERIC(18, 2) NOT NULL,
  new_amount NUMERIC(18, 2) NOT NULL,
  cleared_amount NUMERIC(18, 2) NOT NULL,
  written_off_amount NUMERIC(18, 2) NOT NULL,
  closing_amount NUMERIC(18, 2) NOT NULL,
  -- Flagged, not silently recomputed, when a later-closed earlier period reopens (PR E) --
  -- auto-restating a closed period's own snapshot is how audit trails get destroyed.
  is_stale BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_period_rollforward_run_account_key
    UNIQUE (reconciliation_run_id, account_id),
  CONSTRAINT reconciliation_period_rollforward_count_ties CHECK (
    closing_count = opening_count + new_count - cleared_count - written_off_count
  ),
  CONSTRAINT reconciliation_period_rollforward_amount_ties CHECK (
    closing_amount = opening_amount + new_amount - cleared_amount - written_off_amount
  )
);

CREATE INDEX reconciliation_period_rollforward_organization_idx
  ON reconciliation_period_rollforward (organization_id);
CREATE INDEX reconciliation_period_rollforward_account_idx
  ON reconciliation_period_rollforward (account_id);

ALTER TABLE reconciliation_period_rollforward ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_period_rollforward_tenant_isolation ON reconciliation_period_rollforward
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

--rollback DROP POLICY IF EXISTS reconciliation_period_rollforward_tenant_isolation ON reconciliation_period_rollforward;
--rollback DROP TABLE IF EXISTS reconciliation_period_rollforward CASCADE;
