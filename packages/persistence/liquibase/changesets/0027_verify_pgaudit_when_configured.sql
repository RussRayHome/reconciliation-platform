--liquibase formatted sql

--changeset recon:0027-verify_pgaudit_when_configured splitStatements:false
-- 0004 intentionally swallows a failed `CREATE EXTENSION pgaudit` so environments that never
-- opted in (ENABLE_PGAUDIT unset -- e.g. the lightweight postgres:16 image the test harness
-- uses, which has no pgaudit package at all) aren't blocked from migrating. That same swallow
-- means a REAL deployment that opted in (shared_preload_libraries configured for pgaudit, via
-- ENABLE_PGAUDIT=true in Dockerfile.postgres) but still failed to actually install it --
-- wrong base image, permissions, version mismatch -- would report a successful migration with
-- zero audit trail, and nothing would surface that. Not edited in place: 0004 already ran
-- against every existing database, and Liquibase checksums already-applied changesets, so this
-- lands as a new changeset rather than a modification.
--
-- This only checks; it changes nothing, so it is safe to add without a matching forward
-- migration. If the operator configured pgaudit to be preloaded, the extension must actually be
-- present by the time this runs, or the migration now fails loudly instead of silently.
DO $$
BEGIN
  IF POSITION('pgaudit' IN current_setting('shared_preload_libraries', true)) > 0
    AND NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgaudit') THEN
    RAISE EXCEPTION 'pgaudit is preloaded via shared_preload_libraries but the extension is not installed -- audit logging is silently absent. Check that postgresql-16-pgaudit (or the equivalent for this base image) is actually installed.';
  END IF;
END
$$;

--rollback -- No-op: this changeset only verifies pgaudit's state, it does not change schema.
