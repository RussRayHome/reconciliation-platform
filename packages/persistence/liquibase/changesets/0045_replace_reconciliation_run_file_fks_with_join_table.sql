--liquibase formatted sql

--changeset recon:0045-replace_reconciliation_run_file_fks_with_join_table splitStatements:false
-- reconciliation-design-v2 review (2026-08-12): reconciliation_run's fixed bank_file_id/
-- gl_file_id pair assumed exactly one Bank file + one GL file per run. v2 generalizes a run
-- to N source files across types (implementation-spec.md v2 §3.3a) via a join table.
-- reconciliation_run has no rows yet, so the two columns are simply dropped -- no backfill
-- into run_source_file needed. The application (Phase 5, not yet built) will insert one
-- run_source_file row per uploaded file; for the Bank/GL case that's still exactly two rows,
-- with role = 'BANK' / 'GL'.
CREATE TABLE IF NOT EXISTS run_source_file (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  reconciliation_run_id UUID NOT NULL REFERENCES reconciliation_run (id) ON DELETE CASCADE,
  import_file_id UUID NOT NULL REFERENCES import_file (id),
  -- The source_type's role in this run (e.g. primary 'BANK', primary 'GL', supporting
  -- 'PAYROLL') -- deliberately TEXT, not FK'd to import_file.source_type's CHECK list, since
  -- "role in this run" and "the file's own source_type" are conceptually independent (kept
  -- equal by application logic today, but a future run could plausibly want two files of the
  -- same source_type distinguished by role).
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT run_source_file_run_import_file_key UNIQUE (reconciliation_run_id, import_file_id)
);

CREATE INDEX IF NOT EXISTS run_source_file_organization_idx ON run_source_file (organization_id);
CREATE INDEX IF NOT EXISTS run_source_file_reconciliation_run_idx ON run_source_file (reconciliation_run_id);
CREATE INDEX IF NOT EXISTS run_source_file_import_file_idx ON run_source_file (import_file_id);

ALTER TABLE run_source_file ENABLE ROW LEVEL SECURITY;
CREATE POLICY run_source_file_tenant_isolation ON run_source_file
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_run DROP CONSTRAINT reconciliation_run_bank_file_id_fkey;
ALTER TABLE reconciliation_run DROP CONSTRAINT reconciliation_run_gl_file_id_fkey;
ALTER TABLE reconciliation_run DROP COLUMN bank_file_id;
ALTER TABLE reconciliation_run DROP COLUMN gl_file_id;

--rollback ALTER TABLE reconciliation_run ADD COLUMN gl_file_id UUID;
--rollback ALTER TABLE reconciliation_run ADD COLUMN bank_file_id UUID;
--rollback ALTER TABLE reconciliation_run ADD CONSTRAINT reconciliation_run_gl_file_id_fkey FOREIGN KEY (gl_file_id) REFERENCES import_file (id);
--rollback ALTER TABLE reconciliation_run ADD CONSTRAINT reconciliation_run_bank_file_id_fkey FOREIGN KEY (bank_file_id) REFERENCES import_file (id);
--rollback DROP POLICY IF EXISTS run_source_file_tenant_isolation ON run_source_file;
--rollback DROP TABLE IF EXISTS run_source_file CASCADE;
