--liquibase formatted sql

--changeset recon:0033-remove_developer_role
-- The 'developer' role existed for exactly one purpose: gating access to the in-app Developer
-- Dashboard (canAccessDeveloperDashboard). That dashboard has been fully replaced by a separate
-- application (apps/developer-dashboard-api/web, GitHub OAuth, reads CI results published by
-- GitHub Actions) that is not reachable from -- or aware of -- this product's own auth at all. With
-- no remaining in-app surface for it to gate, the role itself is dead: every other permission it
-- held (canAccessApplication: false, canAccessDocumentation: true) is a strict subset of
-- financial-analyst's, so reassignment loses no capability any 'developer' row actually had.
-- Any existing 'developer' row (the seeded local/test user 'rray2' being the only one this
-- migration's own history ever assigned it to -- see 0026) moves to financial-analyst, the
-- least-privileged of the roles that remain, matching 0026's own fallback choice for unknown users.
UPDATE reconciliation_user
SET role = 'financial-analyst'
WHERE role = 'developer';

ALTER TABLE reconciliation_user
  DROP CONSTRAINT reconciliation_user_role_check;

ALTER TABLE reconciliation_user
  ADD CONSTRAINT reconciliation_user_role_check
  CHECK (role IN ('financial-analyst', 'admin', 'superuser'));

-- The reassignment above cannot be undone on rollback -- which rows held 'developer' before this
-- migration ran is not recoverable from the post-migration state. Same accepted gap as 0026's own
-- password rollback: fix forward, not a correctness risk for a rollback path.
--rollback ALTER TABLE reconciliation_user DROP CONSTRAINT reconciliation_user_role_check;
--rollback ALTER TABLE reconciliation_user ADD CONSTRAINT reconciliation_user_role_check CHECK (role IN ('developer', 'financial-analyst', 'admin', 'superuser'));
