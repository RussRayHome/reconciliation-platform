--liquibase formatted sql

--changeset recon:0029-create_least_privilege_app_role splitStatements:false
-- Postgres hardening backlog item 1. The application currently connects as recon_app, which is
-- POSTGRES_USER -- confirmed via \du to be Superuser/Create role/Create DB/Bypass RLS, i.e. the
-- database owner. A SQL injection today escalates from row disclosure to DROP TABLE. This
-- migration creates a non-superuser role scoped to CRUD on application tables and nothing else;
-- recon_app remains the migration/owner role (superuser already implies BYPASSRLS, so RLS
-- policies added later apply to this new role and not to migrations).
--
-- NOT done here, and this changeset alone does not close the backlog item: the API's own
-- connection string still points at recon_app until it is switched to connect as
-- recon_app_runtime instead. That is a deployment/credential change (new password in
-- .env.docker.*, new DATABASE_URL), deliberately left as a follow-up rather than silently
-- changed here -- creating a role is safe and reversible; re-pointing a live application's DB
-- connection is not something to do inside a schema migration.
--
-- The password below is a placeholder for local/dev use only. Any real deployment must rotate it
-- out-of-band (ALTER ROLE recon_app_runtime WITH PASSWORD ...) before pointing traffic at it --
-- it is not read from an environment variable here because Liquibase changesets are committed to
-- version control.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recon_app_runtime') THEN
    CREATE ROLE recon_app_runtime WITH
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      PASSWORD 'CHANGE_ME_recon_app_runtime_dev_only';
  END IF;
END
$$;

-- current_database() rather than a literal name: this changeset also runs against the postgres
-- test harness's per-test-file databases (recon_lifecycle, recon_rollback_one, ...), not just the
-- real reconciliation_platform database, and GRANT ... ON DATABASE takes an identifier, not an
-- expression, so it has to go through dynamic SQL.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO recon_app_runtime', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO recon_app_runtime;

-- Explicit per-table grants rather than `ALL TABLES IN SCHEMA public` -- deliberate, so this list
-- is a readable audit of exactly what the app can touch, and so Liquibase's own
-- databasechangelog / databasechangeloglock (excluded) stay out of the app's reach entirely.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  reconciliation_approval_history,
  reconciliation_audit_event,
  reconciliation_canonical_row,
  reconciliation_exception,
  reconciliation_export,
  reconciliation_import_approval,
  reconciliation_import_batch,
  reconciliation_job,
  reconciliation_job_summary,
  reconciliation_mapping_profile,
  reconciliation_mapping_profile_version,
  reconciliation_match_group,
  reconciliation_match_result,
  reconciliation_organization,
  reconciliation_payee_alias,
  reconciliation_raw_row,
  reconciliation_review_decision,
  reconciliation_review_observation,
  reconciliation_rule_result,
  reconciliation_source_file,
  reconciliation_source_file_content,
  reconciliation_staged_transaction,
  reconciliation_template_definition,
  reconciliation_user,
  reconciliation_validation_result,
  reconciliation_validation_rule_version
TO recon_app_runtime;

-- reconciliation_audit_event.event_id is BIGSERIAL (an implicit sequence), the only one in the
-- schema -- every other primary key is an application-supplied UUID needing no sequence grant.
GRANT USAGE, SELECT ON SEQUENCE reconciliation_audit_event_event_id_seq TO recon_app_runtime;

-- Covers tables a *future* migration adds while running as the migration/owner role, so nobody
-- has to remember to extend the explicit list above every time. Does not retroactively grant on
-- tables that already existed before this changeset (all of them are listed explicitly above
-- already). Deliberately no `FOR ROLE <name>` clause: that role is `recon_app` in a real
-- deployment but `recon` in the Testcontainers harness (packages/persistence/tests/testHelpers/
-- liquibase.ts), and omitting `FOR ROLE` makes Postgres default to whichever role is actually
-- running this changeset, which is correct in both places without hardcoding either name.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recon_app_runtime;

--rollback ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM recon_app_runtime;
--rollback REVOKE ALL ON SEQUENCE reconciliation_audit_event_event_id_seq FROM recon_app_runtime;
--rollback REVOKE ALL ON reconciliation_approval_history, reconciliation_audit_event, reconciliation_canonical_row, reconciliation_exception, reconciliation_export, reconciliation_import_approval, reconciliation_import_batch, reconciliation_job, reconciliation_job_summary, reconciliation_mapping_profile, reconciliation_mapping_profile_version, reconciliation_match_group, reconciliation_match_result, reconciliation_organization, reconciliation_payee_alias, reconciliation_raw_row, reconciliation_review_decision, reconciliation_review_observation, reconciliation_rule_result, reconciliation_source_file, reconciliation_source_file_content, reconciliation_staged_transaction, reconciliation_template_definition, reconciliation_user, reconciliation_validation_result, reconciliation_validation_rule_version FROM recon_app_runtime;
--rollback REVOKE USAGE ON SCHEMA public FROM recon_app_runtime;

-- This deliberately stops short of also revoking CONNECT and DROP ROLE-ing
-- recon_app_runtime: that needs dynamic SQL (format('...%I...', current_database())) wrapped in a
-- DO block, and -- as already discovered with changeset 0026's rollback -- Liquibase splits
-- --rollback SQL on every semicolon regardless of dollar-quoting, so a DO $$ ... $$; body cannot
-- survive as rollback SQL. Rolling back leaves recon_app_runtime in place with CONNECT but no
-- schema/table/sequence access -- safe (nothing left for it to do) and reversible by hand
-- (DROP ROLE recon_app_runtime after REVOKE CONNECT ON DATABASE ... FROM recon_app_runtime).
