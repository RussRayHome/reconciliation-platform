--liquibase formatted sql

--changeset recon:0036-create_dashboard_app_runtime_role splitStatements:false
-- Least-privilege runtime role for developer-dashboard-api, on the same pattern as app_user
-- (changeset 0031) but scoped narrower on purpose: the dashboard is a lower-trust surface than the
-- product API (GitHub-login allowlist, not the product's tenant auth) sharing this Postgres
-- instance purely to inherit its backup/pgaudit coverage for the Secret Integrity change log (see
-- 0035) -- it has no business reading or writing a single reconciliation_* table, ever. Unlike
-- app_user (0029/0031), this role's grant is NOT extended via ALTER DEFAULT PRIVILEGES: a future
-- migration adding another dashboard_ table must grant this role explicitly, so the role's access
-- never silently widens.
--
-- The password below is a placeholder for local/dev use only, exactly like 0029/0031 -- it is not
-- read from an environment variable here because Liquibase changesets are committed to version
-- control. Any real deployment must rotate it out-of-band (ALTER ROLE dashboard_app_runtime WITH
-- PASSWORD ...) before pointing DASHBOARD_DATABASE_URL at it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app_runtime') THEN
    CREATE ROLE dashboard_app_runtime WITH
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      PASSWORD 'CHANGE_ME_dashboard_app_runtime_dev_only';
  END IF;
END
$$;

ALTER ROLE dashboard_app_runtime WITH PASSWORD 'CHANGE_ME_dashboard_app_runtime_dev_only';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO dashboard_app_runtime', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO dashboard_app_runtime;

-- SELECT + INSERT only, not UPDATE/DELETE -- secretActionsStore.ts never updates or deletes a row
-- (append-only change log), so the grant doesn't offer more than the app actually does.
GRANT SELECT, INSERT ON dashboard_secret_change_log TO dashboard_app_runtime;
GRANT USAGE, SELECT ON SEQUENCE dashboard_secret_change_log_id_seq TO dashboard_app_runtime;

--rollback REVOKE ALL ON SEQUENCE dashboard_secret_change_log_id_seq FROM dashboard_app_runtime;
--rollback REVOKE ALL ON dashboard_secret_change_log FROM dashboard_app_runtime;
--rollback REVOKE USAGE ON SCHEMA public FROM dashboard_app_runtime;

-- Same rollback-fidelity tradeoff as 0029/0031: stops short of revoking CONNECT and DROP ROLE-ing
-- dashboard_app_runtime, which needs dynamic SQL that can't survive as --rollback SQL (Liquibase
-- splits rollback SQL on every semicolon regardless of dollar-quoting). Rolling back leaves the
-- role in place with CONNECT but no table access -- safe, and reversible by hand.
