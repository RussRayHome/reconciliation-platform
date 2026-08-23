--liquibase formatted sql

--changeset recon:0061-add_declared_period_dates splitStatements:false
-- Unreconciled Item Roll-Forward, PR A. reconciliation_run only carries period_year/period_month
-- today -- the reconciliation anchor date the matching engine ages every exception against
-- (buildReconciliationAnchorDate, exceptionClassifierStages.ts) is instead *inferred* as
-- max(transactionDate) across the whole normalized population. That inferred value moves with
-- whatever the uploaded file happens to contain: a bank export cut two days short of period end
-- understates every age by two days, and a single stray next-month GL row overstates every age in
-- the run. A declared period_end (wired in as the anchor by application code in a later, separate
-- change -- this changeset only adds the columns) fixes both, and makes the anchor reproducible
-- across re-runs of the same period regardless of file cut.
--
-- Nullable for backfill safety on rows created before this column existed; new runs populate both
-- at submission time going forward.
ALTER TABLE reconciliation_run ADD COLUMN period_start DATE;
ALTER TABLE reconciliation_run ADD COLUMN period_end DATE;

-- Backfill from the existing period_year/period_month: first/last calendar day of the month for
-- MONTHLY, Jan 1/Dec 31 of the year for ANNUAL.
UPDATE reconciliation_run
   SET period_start = CASE
         WHEN frequency = 'ANNUAL' THEN make_date(period_year, 1, 1)
         ELSE make_date(period_year, period_month, 1)
       END,
       period_end = CASE
         WHEN frequency = 'ANNUAL' THEN make_date(period_year, 12, 31)
         ELSE (make_date(period_year, period_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date
       END
 WHERE period_start IS NULL
   AND (frequency = 'ANNUAL' OR period_month IS NOT NULL);

ALTER TABLE reconciliation_run
  ADD CONSTRAINT reconciliation_run_period_start_before_end_check
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start);

--rollback ALTER TABLE reconciliation_run DROP CONSTRAINT IF EXISTS reconciliation_run_period_start_before_end_check;
--rollback ALTER TABLE reconciliation_run DROP COLUMN IF EXISTS period_end;
--rollback ALTER TABLE reconciliation_run DROP COLUMN IF EXISTS period_start;
