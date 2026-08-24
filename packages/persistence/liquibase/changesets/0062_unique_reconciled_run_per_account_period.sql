--liquibase formatted sql

--changeset recon:0062-unique_reconciled_run_per_account_period splitStatements:false
-- Unreconciled Item Roll-Forward, PR A. The constraint wanted is "at most one non-superseded
-- RECONCILED run per account + period" -- but that spans reconciliation_run (status, period) and
-- reconciliation_run_account (account), and a Postgres partial index predicate can only reference
-- columns on the indexed table itself. So period_year/period_month are denormalized onto
-- reconciliation_run_account, copied once at row creation (write-once: a run's period never
-- changes after submission, so nothing needs to keep this in sync) -- simpler and just as true as
-- reading it via a join.
--
-- Run status is NOT write-once the same way: a reconciliation_run_account row is created while
-- the run is still DRAFT/VALIDATING, long before it might reach RECONCILED. is_terminal_good is
-- kept in sync by a trigger on reconciliation_run's own status column instead, and is what the
-- partial unique index actually filters on. When PR E adds a CLOSED status, extend this trigger's
-- CASE to treat it as terminal-good too rather than redesigning the mechanism.
ALTER TABLE reconciliation_run_account ADD COLUMN period_year INTEGER;
ALTER TABLE reconciliation_run_account ADD COLUMN period_month INTEGER;
ALTER TABLE reconciliation_run_account ADD COLUMN is_terminal_good BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE reconciliation_run_account ra
   SET period_year = r.period_year,
       period_month = r.period_month,
       is_terminal_good = (r.status = 'RECONCILED')
  FROM reconciliation_run r
 WHERE r.id = ra.reconciliation_run_id;

ALTER TABLE reconciliation_run_account ALTER COLUMN period_year SET NOT NULL;

CREATE OR REPLACE FUNCTION sync_reconciliation_run_account_terminal_good() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE reconciliation_run_account
       SET is_terminal_good = (NEW.status = 'RECONCILED')
     WHERE reconciliation_run_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reconciliation_run_account_terminal_good
  AFTER UPDATE OF status ON reconciliation_run
  FOR EACH ROW EXECUTE FUNCTION sync_reconciliation_run_account_terminal_good();

-- Fails loudly (index creation errors out) if any environment already has two RECONCILED runs for
-- the same account + period -- an intentional, documented risk (see the plan's own risk table):
-- that data problem needs a manual reconciliation/cleanup pass before this constraint can apply,
-- not a migration that silently picks a winner.
CREATE UNIQUE INDEX reconciliation_run_account_period_reconciled_key
  ON reconciliation_run_account (account_id, period_year, period_month)
  WHERE is_terminal_good;

--rollback DROP INDEX IF EXISTS reconciliation_run_account_period_reconciled_key;
--rollback DROP TRIGGER IF EXISTS trg_reconciliation_run_account_terminal_good ON reconciliation_run;
--rollback DROP FUNCTION IF EXISTS sync_reconciliation_run_account_terminal_good();
--rollback ALTER TABLE reconciliation_run_account DROP COLUMN IF EXISTS is_terminal_good;
--rollback ALTER TABLE reconciliation_run_account DROP COLUMN IF EXISTS period_month;
--rollback ALTER TABLE reconciliation_run_account DROP COLUMN IF EXISTS period_year;
