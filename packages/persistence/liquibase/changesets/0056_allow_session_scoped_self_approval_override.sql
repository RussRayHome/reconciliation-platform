--liquibase formatted sql

--changeset recon:0056-allow_session_scoped_self_approval_override
-- Dev-only escape hatch for the segregation-of-duty constraint (changeset 0042), confirmed
-- with the app owner 2026-08-21: a superuser doing solo Dev-stack testing needs to submit and
-- approve the same run without a second test account. Enforced via a transaction-local GUC
-- rather than dropping the constraint, so the guarantee stays fully intact in every
-- environment that doesn't explicitly opt in -- see ALLOW_SUPERUSER_SELF_APPROVAL and its
-- isProductionRuntime() boot guard in apps/api/src/app.ts, which refuses to start if this
-- flag is set in a production runtime. current_setting(..., true) (missing_ok) returns NULL,
-- not an error, when the GUC was never set for the session -- and a bare `NULL = 'true'`
-- evaluates to NULL, not false, which a CHECK constraint treats as PASSING (only an explicit
-- FALSE fails a CHECK) -- an unset GUC would silently disable this constraint for every caller,
-- not just the intended dev bypass. coalesce(...,'false') is required, not decorative, to force
-- the unset case to an explicit false.
ALTER TABLE reconciliation_run DROP CONSTRAINT reconciliation_run_segregation_of_duty_check;
ALTER TABLE reconciliation_run ADD CONSTRAINT reconciliation_run_segregation_of_duty_check
  CHECK (
    decided_by IS NULL
    OR submitted_by IS DISTINCT FROM decided_by
    OR coalesce(current_setting('app.allow_self_approval', true), 'false') = 'true'
  );

--rollback ALTER TABLE reconciliation_run DROP CONSTRAINT reconciliation_run_segregation_of_duty_check;
--rollback ALTER TABLE reconciliation_run ADD CONSTRAINT reconciliation_run_segregation_of_duty_check CHECK (decided_by IS NULL OR submitted_by IS DISTINCT FROM decided_by);
