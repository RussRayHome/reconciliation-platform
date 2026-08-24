--liquibase formatted sql

--changeset recon:0068-add_period_close_to_reconciliation_run splitStatements:false
-- Unreconciled Item Roll-Forward, PR E.1. Extends reconciliation_run's status lifecycle with a
-- terminal CLOSED state (plan §3.8): once a period closes, its roll-forward snapshot is frozen
-- (reconciliation_period_rollforward, changeset 0065) and no further matching runs are accepted
-- for that account+period without an explicit reopen.
--
-- closed_by follows the exact precedent submitted_by/decided_by already set (changeset 0042):
-- a nullable FK to reconciliation_user(id), paired with a same-row segregation-of-duty CHECK.
-- Deliberately NOT given the changeset 0056 self-approval bypass -- that GUC-based escape hatch
-- was a specific, product-owner-approved exception for the submit/decide approval workflow, not a
-- general mechanism every future SoD constraint inherits automatically.
ALTER TABLE reconciliation_run DROP CONSTRAINT reconciliation_run_status_check;
ALTER TABLE reconciliation_run ADD CONSTRAINT reconciliation_run_status_check
  CHECK (status IN (
    'DRAFT', 'VALIDATING', 'VALIDATION_FAILED', 'PENDING_APPROVAL',
    'APPROVED', 'RECONCILING', 'RECONCILED', 'REJECTED', 'CLOSED'
  ));

ALTER TABLE reconciliation_run ADD COLUMN closed_at TIMESTAMPTZ;
ALTER TABLE reconciliation_run ADD COLUMN closed_by UUID REFERENCES reconciliation_user (id);
-- Incremented, never reset, by PR E's reopen operation -- a running count of how many times this
-- period has been reopened, surfaced so a reviewer can see "this has happened before" at a
-- glance rather than having to read the full event history.
ALTER TABLE reconciliation_run ADD COLUMN reopen_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE reconciliation_run
  ADD CONSTRAINT reconciliation_run_close_segregation_of_duty_check
  CHECK (closed_by IS NULL OR submitted_by IS DISTINCT FROM closed_by);

--rollback ALTER TABLE reconciliation_run DROP CONSTRAINT IF EXISTS reconciliation_run_close_segregation_of_duty_check;
--rollback ALTER TABLE reconciliation_run DROP COLUMN IF EXISTS reopen_count;
--rollback ALTER TABLE reconciliation_run DROP COLUMN IF EXISTS closed_by;
--rollback ALTER TABLE reconciliation_run DROP COLUMN IF EXISTS closed_at;
--rollback ALTER TABLE reconciliation_run DROP CONSTRAINT IF EXISTS reconciliation_run_status_check;
--rollback ALTER TABLE reconciliation_run ADD CONSTRAINT reconciliation_run_status_check CHECK (status IN ('DRAFT', 'VALIDATING', 'VALIDATION_FAILED', 'PENDING_APPROVAL', 'APPROVED', 'RECONCILING', 'RECONCILED', 'REJECTED'));
