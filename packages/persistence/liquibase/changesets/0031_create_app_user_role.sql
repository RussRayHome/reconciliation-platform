--liquibase formatted sql

--changeset recon:0031-create_app_user_role splitStatements:false
-- Introduces app_user: the application's runtime role, replacing recon_app_runtime (changeset
-- 0029) under a clearer name for the same purpose. Deliberately NOT implemented as
-- ALTER ROLE recon_app_runtime RENAME TO app_user: roles are cluster-wide (see 0029's own
-- comment), but this repo's Testcontainers test harness shares one cluster across many
-- differently-named per-test-file databases, each running the full changelog from scratch. A
-- rename that succeeds on the first database renamed leaves 0029's own
-- "IF NOT EXISTS recon_app_runtime" guard permanently unsatisfied cluster-wide -- so the very
-- next fresh database recreates a *stray* recon_app_runtime via 0029, which then collides with
-- the rename attempt here ("role app_user already exists"). Creating app_user fresh with its own
-- grants sidesteps that entirely: CREATE ROLE IF NOT EXISTS and GRANT are both safe to re-run
-- unconditionally on every database, regardless of what any other database in the cluster has
-- already done.
--
-- recon_app_runtime itself is deliberately left in place, unused, rather than dropped here:
-- retiring it safely means revoking its CONNECT grant and DROP ROLE-ing it, which -- like 0029's
-- own rollback -- needs dynamic SQL that cannot be made safe against the same cross-database
-- race described above without materially more complexity than an orphaned, harmless,
-- zero-privilege-surface-beyond-CONNECT role justifies. It has no BYPASSRLS, no DDL rights, and
-- nothing connects as it once the application's DATABASE_URL points at app_user instead. Follow
-- up with a dedicated changeset to drop it once it's confirmed unused in every real deployment,
-- if desired.
--
-- The password below is a placeholder for local/dev use only, exactly like 0029's -- it is not
-- read from an environment variable here because Liquibase changesets are committed to version
-- control. Any real deployment must rotate it out-of-band (ALTER ROLE app_user WITH PASSWORD ...)
-- before pointing traffic at it -- it is also, deliberately, a dictionary-pattern password
-- ("P@ssw0rd" appears in essentially every password-cracking wordlist): fine as a placeholder
-- that gets rotated before production, never fine as an actual production credential.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      PASSWORD 'P@ssw0rd';
  END IF;
END
$$;

-- Always (re)sets the password so this changeset alone determines app_user's password, regardless
-- of whether the CREATE branch above fired on this particular database.
ALTER ROLE app_user WITH PASSWORD 'P@ssw0rd';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;

-- Same explicit per-table list as 0029, retargeted to app_user -- see 0029's own comment for why
-- it is spelled out rather than `ALL TABLES IN SCHEMA public`.
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
TO app_user;

GRANT USAGE, SELECT ON SEQUENCE reconciliation_audit_event_event_id_seq TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

--rollback ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app_user;
--rollback REVOKE ALL ON SEQUENCE reconciliation_audit_event_event_id_seq FROM app_user;
--rollback REVOKE ALL ON reconciliation_approval_history, reconciliation_audit_event, reconciliation_canonical_row, reconciliation_exception, reconciliation_export, reconciliation_import_approval, reconciliation_import_batch, reconciliation_job, reconciliation_job_summary, reconciliation_mapping_profile, reconciliation_mapping_profile_version, reconciliation_match_group, reconciliation_match_result, reconciliation_organization, reconciliation_payee_alias, reconciliation_raw_row, reconciliation_review_decision, reconciliation_review_observation, reconciliation_rule_result, reconciliation_source_file, reconciliation_source_file_content, reconciliation_staged_transaction, reconciliation_template_definition, reconciliation_user, reconciliation_validation_result, reconciliation_validation_rule_version FROM app_user;
--rollback REVOKE USAGE ON SCHEMA public FROM app_user;

-- Same rollback-fidelity tradeoff as 0029: stops short of revoking CONNECT and DROP ROLE-ing
-- app_user, since that needs dynamic SQL wrapped in a DO block, and Liquibase splits --rollback
-- SQL on every semicolon regardless of dollar-quoting. Leaves app_user in place with CONNECT but
-- no schema/table/sequence access -- safe and reversible by hand.
