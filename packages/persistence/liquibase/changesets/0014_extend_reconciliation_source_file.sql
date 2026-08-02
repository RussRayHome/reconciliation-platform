--liquibase formatted sql

--changeset recon:0014-extend_reconciliation_source_file
ALTER TABLE reconciliation_source_file
  ADD COLUMN organization_id UUID;

ALTER TABLE reconciliation_source_file
  ADD CONSTRAINT reconciliation_source_file_organization_fk
  FOREIGN KEY (organization_id) REFERENCES reconciliation_organization(id) ON DELETE RESTRICT;

ALTER TABLE reconciliation_source_file
  ADD COLUMN uploaded_by TEXT;

ALTER TABLE reconciliation_source_file
  ADD CONSTRAINT reconciliation_source_file_uploaded_by_fk
  FOREIGN KEY (uploaded_by) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT;

ALTER TABLE reconciliation_source_file
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED'
  CONSTRAINT reconciliation_source_file_approval_status_check
  CHECK (approval_status IN ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'));

CREATE INDEX IF NOT EXISTS reconciliation_source_file_organization_idx
  ON reconciliation_source_file (organization_id)
  WHERE organization_id IS NOT NULL;

--rollback DROP INDEX IF EXISTS reconciliation_source_file_organization_idx;
--rollback ALTER TABLE reconciliation_source_file DROP COLUMN IF EXISTS approval_status;
--rollback ALTER TABLE reconciliation_source_file DROP COLUMN IF EXISTS uploaded_by;
--rollback ALTER TABLE reconciliation_source_file DROP COLUMN IF EXISTS organization_id;
