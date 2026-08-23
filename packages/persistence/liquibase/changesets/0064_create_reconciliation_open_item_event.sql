--liquibase formatted sql

--changeset recon:0064-create_reconciliation_open_item_event splitStatements:false
-- Unreconciled Item Roll-Forward, PR B. Append-only audit trail for an open item's status
-- transitions (OPENED, CARRIED_FORWARD, CLEARED, WRITTEN_OFF, SUPERSEDED, ...) -- mirrors
-- reconciliation_audit_event's own shape exactly (changeset 0001), including the BIGSERIAL
-- event_id for stable insertion-order sequencing. No UPDATE path is ever expected against this
-- table; nothing here should require one.
--
-- open_item_id cascades on delete -- an event genuinely belongs to its item and has no meaning
-- once the item itself is gone -- unlike every reconciliation_run/reconciliation_job reference on
-- reconciliation_open_item itself (changeset 0063), which are all SET NULL by design.
CREATE TABLE IF NOT EXISTS reconciliation_open_item_event (
  event_id BIGSERIAL PRIMARY KEY,
  open_item_id UUID NOT NULL REFERENCES reconciliation_open_item (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  run_id UUID REFERENCES reconciliation_run (id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX reconciliation_open_item_event_open_item_idx
  ON reconciliation_open_item_event (open_item_id, created_at);
CREATE INDEX reconciliation_open_item_event_organization_idx
  ON reconciliation_open_item_event (organization_id);

ALTER TABLE reconciliation_open_item_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_open_item_event_tenant_isolation ON reconciliation_open_item_event
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- Sequence grants for event_id: changeset 0049's ALTER DEFAULT PRIVILEGES ... ON SEQUENCES TO
-- app_user covers every sequence created after it, including this one -- verified against 0049's
-- own text rather than assumed, since 0049 exists precisely because an earlier BIGSERIAL table's
-- sequence grant was missed. No additional GRANT needed here.

--rollback DROP POLICY IF EXISTS reconciliation_open_item_event_tenant_isolation ON reconciliation_open_item_event;
--rollback DROP TABLE IF EXISTS reconciliation_open_item_event CASCADE;
