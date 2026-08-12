--liquibase formatted sql

--changeset recon:0043-enable_rls_file_import_validation_tables splitStatements:false
-- RLS for the six File Imports & Validation tables added in changeset 0042, matching the exact
-- policy shape changeset 0030 established for the rest of the schema: FOR ALL (the default when
-- no FOR clause is given), gating SELECT/UPDATE/DELETE visibility and INSERT/UPDATE new-row
-- validation on organization_id = the app.current_organization_id session GUC that
-- packages/persistence/src/postgres.ts's runInTenantScope sets via SET LOCAL. A connection that
-- forgot to set the GUC sees zero rows (fails closed), not an error and not every tenant's rows.
--
-- No ALTER DEFAULT PRIVILEGES / GRANT changes needed here: changesets 0029 and 0031 already
-- granted SELECT/INSERT/UPDATE/DELETE on future tables to recon_app_runtime and app_user
-- respectively, so these six tables already have the same runtime access as every other table.
ALTER TABLE import_file ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_file_tenant_isolation ON import_file
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE import_file_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_file_content_tenant_isolation ON import_file_content
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_run_tenant_isolation ON reconciliation_run
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE import_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_job_tenant_isolation ON import_job
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE validation_issue ENABLE ROW LEVEL SECURITY;
CREATE POLICY validation_issue_tenant_isolation ON validation_issue
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE normalized_record ENABLE ROW LEVEL SECURITY;
CREATE POLICY normalized_record_tenant_isolation ON normalized_record
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

--rollback DROP POLICY IF EXISTS import_file_tenant_isolation ON import_file;
--rollback ALTER TABLE import_file DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS import_file_content_tenant_isolation ON import_file_content;
--rollback ALTER TABLE import_file_content DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_run_tenant_isolation ON reconciliation_run;
--rollback ALTER TABLE reconciliation_run DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS import_job_tenant_isolation ON import_job;
--rollback ALTER TABLE import_job DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS validation_issue_tenant_isolation ON validation_issue;
--rollback ALTER TABLE validation_issue DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS normalized_record_tenant_isolation ON normalized_record;
--rollback ALTER TABLE normalized_record DISABLE ROW LEVEL SECURITY;
