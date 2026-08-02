--liquibase formatted sql

--changeset recon:0018-create_approval_queue_indexes
-- Modeled on the existing reconciliation_job_state_idx (current_state, updated_at DESC) pattern.
CREATE INDEX IF NOT EXISTS reconciliation_import_approval_status_idx
  ON reconciliation_import_approval (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS reconciliation_import_approval_uploaded_by_idx
  ON reconciliation_import_approval (uploaded_by, status);

CREATE INDEX IF NOT EXISTS reconciliation_import_approval_approved_by_idx
  ON reconciliation_import_approval (approved_by, status)
  WHERE approved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_source_file_organization_approval_idx
  ON reconciliation_source_file (organization_id, approval_status)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_validation_result_severity_idx
  ON reconciliation_validation_result (severity, staged_transaction_id);

--rollback DROP INDEX IF EXISTS reconciliation_validation_result_severity_idx;
--rollback DROP INDEX IF EXISTS reconciliation_source_file_organization_approval_idx;
--rollback DROP INDEX IF EXISTS reconciliation_import_approval_approved_by_idx;
--rollback DROP INDEX IF EXISTS reconciliation_import_approval_uploaded_by_idx;
--rollback DROP INDEX IF EXISTS reconciliation_import_approval_status_idx;
