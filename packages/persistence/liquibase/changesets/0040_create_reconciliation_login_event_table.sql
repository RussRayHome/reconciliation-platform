--liquibase formatted sql

--changeset recon:0040-create_reconciliation_login_event_table splitStatements:false
-- Durable audit trail for authentication events (ISSUE-050.2) -- a login/logout event is
-- security-critical and low-volume enough to warrant a persisted, queryable table rather than
-- only a structured pino log line (see app.ts's login/logout handlers for the log-line half of
-- this fix), matching how dashboard_secret_change_log already treats its own audit trail as
-- durable evidence, not just log-mineable text.
--
-- Deliberately NOT RLS-protected, for the same reason changeset 0032 excludes
-- reconciliation_user: a LOGIN_FAILURE for an unknown/mistyped username has no organization to
-- scope the row to at insert time -- the login attempt is what would have discovered the tenant,
-- and it never got that far. organization_id is nullable to allow exactly that row to exist;
-- username has no foreign key for the same reason (a bogus username that matches no real account
-- is precisely the event worth capturing, not one an FK should reject).
CREATE TABLE IF NOT EXISTS reconciliation_login_event (
  id UUID PRIMARY KEY,
  organization_id UUID,
  username TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT')),
  failure_reason TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_login_event_organization_fk
    FOREIGN KEY (organization_id) REFERENCES reconciliation_organization(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS reconciliation_login_event_organization_idx
  ON reconciliation_login_event (organization_id, created_at);

CREATE INDEX IF NOT EXISTS reconciliation_login_event_username_idx
  ON reconciliation_login_event (username, created_at);

--rollback DROP TABLE IF EXISTS reconciliation_login_event CASCADE;
