--liquibase formatted sql

--changeset recon:0054-add_skip_invalid_rows_tracking_to_reconciliation_run
-- A real Dev-stack trace-through (Issue #154's reconciliation_run_timeline, changeset 0052)
-- surfaced a genuine gap: acceptPartialImport (Phase 12 / Screen 06's "skip invalid rows and
-- proceed anyway" override) flips reconciliation_run.status VALIDATION_FAILED -> PENDING_APPROVAL
-- with no record of who made that call or when -- the only trace was the overridden files' own
-- validation_status staying INVALID forever, which doesn't say *who* decided to proceed past it.
-- Mirrors the existing submitted_by/submitted_at and decided_by/decided_at columns on this same
-- table exactly (same table, same FK target, same nullable-until-it-happens shape) rather than
-- introducing a new audit table -- reconciliation_audit_event's job_id is NOT NULL and no
-- reconciliation_job exists yet at the point this decision is made (the same reason Stage 1's
-- own step-by-step audit trail is out of scope, documented on Issue #154).
ALTER TABLE reconciliation_run
  ADD COLUMN skip_invalid_rows_by uuid REFERENCES reconciliation_user(id),
  ADD COLUMN skip_invalid_rows_at timestamptz;

--rollback ALTER TABLE reconciliation_run DROP COLUMN skip_invalid_rows_by;
--rollback ALTER TABLE reconciliation_run DROP COLUMN skip_invalid_rows_at;
