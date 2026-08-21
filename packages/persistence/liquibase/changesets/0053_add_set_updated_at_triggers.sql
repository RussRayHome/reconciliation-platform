--liquibase formatted sql

--changeset recon:0053-add_set_updated_at_triggers splitStatements:false
-- Every table with an updated_at column relied on application code remembering to include
-- `SET updated_at = NOW()` in each UPDATE -- a manual convention with no enforcement, so a future
-- update statement that omits it would silently leave updated_at stale. This closes that gap with
-- a BEFORE UPDATE trigger, so updated_at is always correct regardless of which code path performs
-- the write. Mirrors an existing precedent already in this schema: reconciliation_user's own
-- trg_reconciliation_user_password_changed trigger (changeset predates this file) auto-stamps
-- last_changed the same way; this generalizes that one-off into a reusable function.
--
-- Deliberately scoped to 4 of the 5 tables that already carry an updated_at column --
-- reconciliation_job, reconciliation_job_summary, reconciliation_payee_alias,
-- reconciliation_source_file -- not adding updated_at to any table that lacks one. Most tables
-- here are write-once/append-only by design (audit events, validation issues, raw/canonical
-- rows), where a mutability-tracking column would be meaningless; deciding which of those should
-- ever become mutable is a separate, real design question, not a mechanical follow-on to this
-- change.
--
-- reconciliation_review_decision is the 5th table with an updated_at column, and is deliberately
-- excluded: confirmed by reading persistReviewerDecision (reconciliationLifecycleStore.ts) and
-- ReviewerDecision (packages/domain/src/types.ts) that its updated_at is application-domain data
-- -- the caller-supplied decision timestamp, stored verbatim via `updated_at = EXCLUDED.updated_at`
-- on upsert -- not a generic "last touched by any write" audit column the way every other table's
-- inline `updated_at = NOW()` is. A blanket trigger would silently overwrite that caller-supplied
-- value with the server's own now(), breaking replay/idempotency semantics that depend on it being
-- exactly what the caller passed. Caught by a real test regression during development, not by
-- inspection alone -- worth remembering as the general risk with this kind of blanket trigger:
-- confirm a same-named column means the same thing on every table before automating it.
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reconciliation_job_updated_at
  BEFORE UPDATE ON reconciliation_job
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reconciliation_job_summary_updated_at
  BEFORE UPDATE ON reconciliation_job_summary
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reconciliation_payee_alias_updated_at
  BEFORE UPDATE ON reconciliation_payee_alias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reconciliation_source_file_updated_at
  BEFORE UPDATE ON reconciliation_source_file
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--rollback DROP TRIGGER IF EXISTS trg_reconciliation_source_file_updated_at ON reconciliation_source_file;
--rollback DROP TRIGGER IF EXISTS trg_reconciliation_payee_alias_updated_at ON reconciliation_payee_alias;
--rollback DROP TRIGGER IF EXISTS trg_reconciliation_job_summary_updated_at ON reconciliation_job_summary;
--rollback DROP TRIGGER IF EXISTS trg_reconciliation_job_updated_at ON reconciliation_job;
--rollback DROP FUNCTION IF EXISTS set_updated_at();
