--liquibase formatted sql

--changeset recon:0050-add_session_id_to_reconciliation_login_event splitStatements:false
-- Session-correlated logging: every login mints a JWT `jti` that stays constant for the whole
-- session (no refresh token exists, see authService.ts's AUTH_TOKEN_TTL_SECONDS). Recording it
-- here lets the durable audit trail answer "which session was this" directly, instead of only
-- by username+timestamp -- the boundary a LOGIN_SUCCESS/LOGOUT pair marks is otherwise invisible
-- from this table alone. Nullable: a LOGIN_FAILURE never gets a token minted, so there is no
-- session id to record for that row.
ALTER TABLE reconciliation_login_event ADD COLUMN session_id UUID;

CREATE INDEX IF NOT EXISTS reconciliation_login_event_session_idx
  ON reconciliation_login_event (session_id);

--rollback DROP INDEX IF EXISTS reconciliation_login_event_session_idx;
--rollback ALTER TABLE reconciliation_login_event DROP COLUMN session_id;
