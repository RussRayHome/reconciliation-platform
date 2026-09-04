--liquibase formatted sql

--changeset recon:0075-open_item_writeoff_approval_control splitStatements:false
-- B5 (Issue #283). Write-off had no segregation of duty. `writeOffOpenItem`
-- (openItemStore.ts) resolved the actor to a user and threw if unknown, and that was the whole
-- check -- its own docblock said so: "Whoever calls this with a valid actor is the approver."
-- For AP the same mechanism unilaterally erases a vendor liability.
--
-- WHY THE OBVIOUS PAIRING DOES NOT WORK. The issue's wording is "a write-off by the user who
-- opened the item is rejected." reconciliation_open_item.owner_user_id looks like that user: it
-- has a column, an FK to reconciliation_user, and a resolving LEFT JOIN in the read path. It is
-- also never written -- openItemStore.listOpenItemsSchedule says so outright ("nothing yet
-- assigns owner_user_id (no write path exists)"), and a repository-wide search for an INSERT or
-- UPDATE touching it returns nothing. A constraint comparing against it would read
-- `owner_user_id IS DISTINCT FROM written_off_by`, which for a NULL left side is true for every
-- possible right side. It would pass review, ship, and reject nothing. Open items are created by
-- the roll-forward process, not by a person, so there is no "user who opened it" to compare to.
--
-- WHAT IS ENFORCED INSTEAD. The realistic self-review risk is the analyst who submitted the run
-- that surfaced an exception then writing that exception off. Both parties are reachable:
--   reconciliation_open_item.opened_in_run_id -> reconciliation_run.submitted_by  (the maker)
--   reconciliation_open_item.written_off_by                                       (the checker)
-- submitted_by is genuinely populated -- importValidationStore stamps it on the
-- DRAFT -> VALIDATING submit transition -- so unlike owner_user_id this pairing exists in real
-- rows.
--
-- WHY A TRIGGER AND NOT A CHECK. A CHECK constraint cannot reference another table, and the maker
-- lives on reconciliation_run. Triggers are already an established mechanism in this schema
-- (changeset 0053's set_updated_at, and reconciliation_user's password_changed trigger before
-- it), so this introduces no new concept. It raises SQLSTATE 23514 -- the same check_violation
-- code importValidationStore already maps for the run-approval segregation constraint -- so
-- existing error handling applies unchanged. RAISE ... USING CONSTRAINT also stamps a constraint
-- name onto the error, which matters because the approver-recorded CHECK below raises 23514 too:
-- without a name the caller could not tell a segregation-of-duty rejection (a legitimate 409 for
-- the user) from a code path that forgot to record the approver (a bug that must not be reported
-- as policy).
--
-- KNOWN GAPS, stated rather than hidden. opened_in_run_id is nullable (ON DELETE SET NULL) and
-- submitted_by is nullable, so an item whose opening run was deleted, or one opened by a run that
-- never went through the submit path, has no maker to compare against and passes. That is
-- narrower than the owner_user_id gap above -- it fails open only where the counterparty genuinely
-- is not recorded, rather than always.
--
-- The role widening below is part of the same feature: Issue #283's approval bands name COO and
-- CEO as authorities above CFO, and neither existed in the role CHECK (last set by changeset
-- 0034). The band thresholds themselves live in @recon/domain, not here -- a CHECK cannot join to
-- reconciliation_user to read the approver's role, so amount-to-authority routing is enforced in
-- the application layer. This constraint enforces the part that holds at any amount.
ALTER TABLE reconciliation_user
  DROP CONSTRAINT reconciliation_user_role_check;

ALTER TABLE reconciliation_user
  ADD CONSTRAINT reconciliation_user_role_check
  CHECK (role IN (
    'financial-analyst',
    'senior-analyst',
    'staff-accountant',
    'controller',
    'vp-finance',
    'cfo',
    'coo',
    'ceo',
    'admin',
    'superuser'
  ));

ALTER TABLE reconciliation_open_item
  ADD COLUMN written_off_by UUID;

ALTER TABLE reconciliation_open_item
  ADD CONSTRAINT reconciliation_open_item_written_off_by_fk
  FOREIGN KEY (written_off_by) REFERENCES reconciliation_user (id) ON DELETE RESTRICT;

ALTER TABLE reconciliation_open_item
  ADD CONSTRAINT reconciliation_open_item_writeoff_approver_recorded_check
  CHECK (status <> 'WRITTEN_OFF' OR written_off_by IS NOT NULL);

CREATE INDEX reconciliation_open_item_written_off_by_idx
  ON reconciliation_open_item (written_off_by) WHERE written_off_by IS NOT NULL;

CREATE FUNCTION enforce_open_item_writeoff_segregation_of_duty() RETURNS trigger AS $$
DECLARE
  opening_submitter UUID;
BEGIN
  IF NEW.written_off_by IS NULL OR NEW.opened_in_run_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT submitted_by INTO opening_submitter
    FROM reconciliation_run
   WHERE id = NEW.opened_in_run_id;

  IF opening_submitter IS NOT NULL AND opening_submitter = NEW.written_off_by THEN
    RAISE EXCEPTION
      'Segregation of duty: user % submitted the run that opened open item % and may not also write it off.',
      NEW.written_off_by, NEW.id
      USING ERRCODE = '23514',
            CONSTRAINT = 'reconciliation_open_item_writeoff_segregation_of_duty';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reconciliation_open_item_writeoff_sod
  BEFORE INSERT OR UPDATE ON reconciliation_open_item
  FOR EACH ROW EXECUTE FUNCTION enforce_open_item_writeoff_segregation_of_duty();

--rollback DROP TRIGGER IF EXISTS trg_reconciliation_open_item_writeoff_sod ON reconciliation_open_item;
--rollback DROP FUNCTION IF EXISTS enforce_open_item_writeoff_segregation_of_duty();
--rollback DROP INDEX IF EXISTS reconciliation_open_item_written_off_by_idx;
--rollback ALTER TABLE reconciliation_open_item DROP CONSTRAINT IF EXISTS reconciliation_open_item_writeoff_approver_recorded_check;
--rollback ALTER TABLE reconciliation_open_item DROP CONSTRAINT IF EXISTS reconciliation_open_item_written_off_by_fk;
--rollback ALTER TABLE reconciliation_open_item DROP COLUMN IF EXISTS written_off_by;
--rollback ALTER TABLE reconciliation_user DROP CONSTRAINT reconciliation_user_role_check;
--rollback ALTER TABLE reconciliation_user ADD CONSTRAINT reconciliation_user_role_check CHECK (role IN ('financial-analyst', 'senior-analyst', 'staff-accountant', 'controller', 'vp-finance', 'cfo', 'admin', 'superuser'));
