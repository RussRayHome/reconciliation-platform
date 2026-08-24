--liquibase formatted sql

--changeset recon:0069-create_reconciliation_run_event splitStatements:false
-- Unreconciled Item Roll-Forward, PR E.1. Append-only audit trail for reconciliation_run's own
-- period-close lifecycle (CLOSED, REOPENED) -- mirrors reconciliation_open_item_event's shape
-- (changeset 0064) exactly, including the BIGSERIAL event_id for stable insertion-order
-- sequencing. The submit/decide half of reconciliation_run's lifecycle deliberately has no
-- equivalent table (reconciliation_run_timeline_function, changeset 0052, derives those events
-- directly from submitted_at/decided_at, which only ever hold one value each) -- close/reopen
-- needs a real log instead, since a period can be closed and reopened more than once and each
-- occurrence's own actor and timestamp would otherwise be lost the next time it happens.
--
-- run_id cascades on delete, matching reconciliation_open_item_event's own reasoning: an event
-- genuinely belongs to its run and has no meaning once the run itself is gone.
CREATE TABLE IF NOT EXISTS reconciliation_run_event (
  event_id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES reconciliation_run (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX reconciliation_run_event_run_idx
  ON reconciliation_run_event (run_id, created_at);
CREATE INDEX reconciliation_run_event_organization_idx
  ON reconciliation_run_event (organization_id);

ALTER TABLE reconciliation_run_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_run_event_tenant_isolation ON reconciliation_run_event
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- Sequence grants for event_id: changeset 0049's ALTER DEFAULT PRIVILEGES ... ON SEQUENCES TO
-- app_user covers every sequence created after it (verified, not assumed -- same check
-- reconciliation_open_item_event's own changeset already made for the identical reason).

--rollback DROP POLICY IF EXISTS reconciliation_run_event_tenant_isolation ON reconciliation_run_event;
--rollback DROP TABLE IF EXISTS reconciliation_run_event CASCADE;
