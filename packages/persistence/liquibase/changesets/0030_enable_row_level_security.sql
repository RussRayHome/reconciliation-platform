--liquibase formatted sql

--changeset recon:0030-enable_row_level_security splitStatements:false
-- ADR-0001 step 5. Enables RLS and adds one tenant-isolation policy per table that carries a
-- NOT NULL organization_id (per changesets 0026/0028). The policy compares the row's
-- organization_id against app.current_organization_id, a session GUC that
-- packages/persistence/src/postgres.ts's runInTenantScope sets via SET LOCAL at the start of
-- every transaction -- current_setting(..., true) returns NULL rather than raising when the GUC
-- is unset, so a connection that forgot to set it sees zero rows (fails closed) instead of an
-- error or, worse, every tenant's rows.
--
-- No FOR clause on CREATE POLICY -- it defaults to FOR ALL, so the same USING expression gates
-- SELECT/UPDATE/DELETE row visibility and the same WITH CHECK expression (implied equal to
-- USING when not given separately) validates INSERT/UPDATE new-row values.
--
-- Excluded on purpose, matching ADR-0001's own scope: reconciliation_organization is the tenant
-- root itself (no organization_id column to compare -- see findOrCreateDefaultOrganization,
-- which intentionally runs outside tenant scope), and reconciliation_template_definition /
-- reconciliation_validation_rule_version are global catalogs with no per-customer data.
--
-- recon_app (the migration/owner role) is a Postgres superuser, which always bypasses RLS
-- regardless of these policies -- migrations and the pgTap schema baseline are unaffected.
-- recon_app_runtime (changeset 0029) is NOT a superuser, so these policies are exactly what
-- stands between it and cross-tenant rows once the API's DATABASE_URL is switched to it.
ALTER TABLE reconciliation_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_job_tenant_isolation ON reconciliation_job
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_source_file ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_source_file_tenant_isolation ON reconciliation_source_file
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_source_file_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_source_file_content_tenant_isolation ON reconciliation_source_file_content
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_audit_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_audit_event_tenant_isolation ON reconciliation_audit_event
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_canonical_row ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_canonical_row_tenant_isolation ON reconciliation_canonical_row
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_exception ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_exception_tenant_isolation ON reconciliation_exception
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_export ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_export_tenant_isolation ON reconciliation_export
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_import_batch ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_import_batch_tenant_isolation ON reconciliation_import_batch
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_import_approval ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_import_approval_tenant_isolation ON reconciliation_import_approval
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_approval_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_approval_history_tenant_isolation ON reconciliation_approval_history
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_job_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_job_summary_tenant_isolation ON reconciliation_job_summary
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_mapping_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_mapping_profile_tenant_isolation ON reconciliation_mapping_profile
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_mapping_profile_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_mapping_profile_version_tenant_isolation ON reconciliation_mapping_profile_version
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_match_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_match_group_tenant_isolation ON reconciliation_match_group
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_match_result ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_match_result_tenant_isolation ON reconciliation_match_result
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_payee_alias ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_payee_alias_tenant_isolation ON reconciliation_payee_alias
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_raw_row ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_raw_row_tenant_isolation ON reconciliation_raw_row
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_review_decision ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_review_decision_tenant_isolation ON reconciliation_review_decision
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_review_observation ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_review_observation_tenant_isolation ON reconciliation_review_observation
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_rule_result ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_rule_result_tenant_isolation ON reconciliation_rule_result
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_staged_transaction ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_staged_transaction_tenant_isolation ON reconciliation_staged_transaction
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_validation_result ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_validation_result_tenant_isolation ON reconciliation_validation_result
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

ALTER TABLE reconciliation_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_user_tenant_isolation ON reconciliation_user
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

--rollback DROP POLICY IF EXISTS reconciliation_job_tenant_isolation ON reconciliation_job;
--rollback ALTER TABLE reconciliation_job DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_source_file_tenant_isolation ON reconciliation_source_file;
--rollback ALTER TABLE reconciliation_source_file DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_source_file_content_tenant_isolation ON reconciliation_source_file_content;
--rollback ALTER TABLE reconciliation_source_file_content DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_audit_event_tenant_isolation ON reconciliation_audit_event;
--rollback ALTER TABLE reconciliation_audit_event DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_canonical_row_tenant_isolation ON reconciliation_canonical_row;
--rollback ALTER TABLE reconciliation_canonical_row DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_exception_tenant_isolation ON reconciliation_exception;
--rollback ALTER TABLE reconciliation_exception DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_export_tenant_isolation ON reconciliation_export;
--rollback ALTER TABLE reconciliation_export DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_import_batch_tenant_isolation ON reconciliation_import_batch;
--rollback ALTER TABLE reconciliation_import_batch DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_import_approval_tenant_isolation ON reconciliation_import_approval;
--rollback ALTER TABLE reconciliation_import_approval DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_approval_history_tenant_isolation ON reconciliation_approval_history;
--rollback ALTER TABLE reconciliation_approval_history DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_job_summary_tenant_isolation ON reconciliation_job_summary;
--rollback ALTER TABLE reconciliation_job_summary DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_mapping_profile_tenant_isolation ON reconciliation_mapping_profile;
--rollback ALTER TABLE reconciliation_mapping_profile DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_mapping_profile_version_tenant_isolation ON reconciliation_mapping_profile_version;
--rollback ALTER TABLE reconciliation_mapping_profile_version DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_match_group_tenant_isolation ON reconciliation_match_group;
--rollback ALTER TABLE reconciliation_match_group DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_match_result_tenant_isolation ON reconciliation_match_result;
--rollback ALTER TABLE reconciliation_match_result DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_payee_alias_tenant_isolation ON reconciliation_payee_alias;
--rollback ALTER TABLE reconciliation_payee_alias DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_raw_row_tenant_isolation ON reconciliation_raw_row;
--rollback ALTER TABLE reconciliation_raw_row DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_review_decision_tenant_isolation ON reconciliation_review_decision;
--rollback ALTER TABLE reconciliation_review_decision DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_review_observation_tenant_isolation ON reconciliation_review_observation;
--rollback ALTER TABLE reconciliation_review_observation DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_rule_result_tenant_isolation ON reconciliation_rule_result;
--rollback ALTER TABLE reconciliation_rule_result DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_staged_transaction_tenant_isolation ON reconciliation_staged_transaction;
--rollback ALTER TABLE reconciliation_staged_transaction DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_validation_result_tenant_isolation ON reconciliation_validation_result;
--rollback ALTER TABLE reconciliation_validation_result DISABLE ROW LEVEL SECURITY;
--rollback DROP POLICY IF EXISTS reconciliation_user_tenant_isolation ON reconciliation_user;
--rollback ALTER TABLE reconciliation_user DISABLE ROW LEVEL SECURITY;
