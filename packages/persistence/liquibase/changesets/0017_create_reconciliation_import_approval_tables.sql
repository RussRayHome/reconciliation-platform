--liquibase formatted sql

--changeset recon:0017-create_reconciliation_import_approval_tables
CREATE TABLE IF NOT EXISTS reconciliation_import_approval (
  id UUID PRIMARY KEY,
  source_file_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'OVERRIDDEN')),
  uploaded_by TEXT NOT NULL,
  approved_by TEXT,
  rationale TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  CONSTRAINT reconciliation_import_approval_source_file_fk
    FOREIGN KEY (source_file_id) REFERENCES reconciliation_source_file(id) ON DELETE CASCADE,
  CONSTRAINT reconciliation_import_approval_uploaded_by_fk
    FOREIGN KEY (uploaded_by) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_import_approval_approved_by_fk
    FOREIGN KEY (approved_by) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_import_approval_source_file_key UNIQUE (source_file_id)
);

CREATE TABLE IF NOT EXISTS reconciliation_approval_history (
  id UUID PRIMARY KEY,
  approval_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_approval_history_approval_fk
    FOREIGN KEY (approval_id) REFERENCES reconciliation_import_approval(id) ON DELETE CASCADE,
  CONSTRAINT reconciliation_approval_history_actor_fk
    FOREIGN KEY (actor) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS reconciliation_approval_history_approval_idx
  ON reconciliation_approval_history (approval_id, created_at ASC);

--rollback DROP TABLE IF EXISTS reconciliation_approval_history CASCADE;
--rollback DROP TABLE IF EXISTS reconciliation_import_approval CASCADE;
