--liquibase formatted sql

--changeset recon:0032-exclude_reconciliation_user_from_rls splitStatements:false
-- Reverses, for reconciliation_user only, the RLS policy changeset 0030 added. Discovered via a
-- real end-to-end deploy: POST /api/auth/login looks up a row by username to discover which
-- tenant the user belongs to -- that lookup is what establishes app.current_organization_id in
-- the first place, so at the moment it runs, the GUC is unset. Once app_user (changeset 0031,
-- non-superuser, no BYPASSRLS) is what the API actually connects as, the tenant-isolation policy
-- from 0030 evaluates organization_id = NULL for every row, which is never true -- so login
-- always fails to find the user, for every account, unconditionally.
--
-- reconciliation_user joins reconciliation_organization (already excluded from RLS entirely,
-- no organization_id column) as a second table that has to bootstrap tenant context rather than
-- operate within it, and so cannot itself be gated by that context. No other code path queries
-- reconciliation_user directly -- readModelStore.ts / reconciliationLifecycleStore.ts never
-- SELECT from it -- so this does not reopen any tenant-scoped query that was actually relying on
-- the policy.
ALTER TABLE reconciliation_user DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reconciliation_user_tenant_isolation ON reconciliation_user;

--rollback CREATE POLICY reconciliation_user_tenant_isolation ON reconciliation_user USING (organization_id = current_setting('app.current_organization_id', true)::uuid);
--rollback ALTER TABLE reconciliation_user ENABLE ROW LEVEL SECURITY;
