--liquibase formatted sql

--changeset recon:0048-add_reconciliation_run_matching_job_id splitStatements:false
-- Phase 6 (submit & async validation) design decision (2026-08-12): once both a run's files pass
-- validation, the *existing* GL<->Bank matching pipeline (executeReconciliation, via
-- runReconciliationWorkflow) fires immediately -- reused as-is rather than reimplemented, which
-- means its own separate audit trail (reconciliation_job/reconciliation_source_file/
-- reconciliation_source_file_content, changeset 0001 on) gets a new row too. That pipeline's
-- output id is the same id it registers as reconciliation_job.id (see
-- registerLifecycleJob/executeReconciliation in apps/api/src/app.ts -- the ReconciliationRun.id
-- returned to the caller *is* the reconciliation_job.id passed in as runId). This column is the
-- only link back to it: without it, the eventual Review tabs (Phase 8) would have no way to find
-- the matching results for a given import run.
--
-- Nullable: NULL until validation passes and matching actually fires (DRAFT/VALIDATING/
-- VALIDATION_FAILED runs never get one).
ALTER TABLE reconciliation_run
  ADD COLUMN matching_job_id UUID REFERENCES reconciliation_job (id);

CREATE INDEX IF NOT EXISTS reconciliation_run_matching_job_idx
  ON reconciliation_run (matching_job_id)
  WHERE matching_job_id IS NOT NULL;

--rollback DROP INDEX IF EXISTS reconciliation_run_matching_job_idx;
--rollback ALTER TABLE reconciliation_run DROP COLUMN IF EXISTS matching_job_id;
