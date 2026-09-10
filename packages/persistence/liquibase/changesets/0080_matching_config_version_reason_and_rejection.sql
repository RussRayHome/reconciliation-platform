--liquibase formatted sql

--changeset recon:0080-matching_config_version_reason_and_rejection splitStatements:false
-- The two-person rule approval pathway for matching-config versions (UI-5, Issue #404, designs
-- 2a/2b). Adds the four columns and the one status the pathway needs; the table itself comes from
-- 0039.
--
-- REJECTED joins the status CHECK. The lifecycle was DRAFT -> ACTIVE -> SUPERSEDED with no way to
-- decline a draft: an approver could only publish it or leave it pending forever, which is not a
-- two-person rule so much as a one-person veto by inaction.
--
-- WHY REJECT DOES NOT DELETE, and why that is what "does not reuse the version number" means.
-- `reconciliation_matching_config_version_key UNIQUE (organization_id, version_number)` already
-- forbids two rows sharing a number. So a rejected draft that STAYS in the table consumes its
-- number permanently, and the next draft necessarily gets a new one -- the requirement is satisfied
-- by the constraint that already exists, provided rejection is a status transition rather than a
-- delete. Deleting the row would hand the number straight back and make v13 mean two different
-- proposals to two different readers, which is exactly the ambiguity an audit trail cannot afford.
--
-- draft_reason is why the draft was proposed; rejection_note is why it was declined. Both are
-- nullable at the DB layer and required at the API layer, deliberately: existing rows predate the
-- columns and cannot be backfilled with a truthful answer, and inventing one ("migrated") would put
-- a fabricated justification into an audit trail. The application refuses to CREATE a draft without
-- a reason or to reject without a note; the column stays nullable so history remains honest about
-- what was never captured.
ALTER TABLE reconciliation_matching_config_version
  DROP CONSTRAINT IF EXISTS reconciliation_matching_config_version_status_check;

ALTER TABLE reconciliation_matching_config_version
  ADD CONSTRAINT reconciliation_matching_config_version_status_check
  CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'REJECTED'));

ALTER TABLE reconciliation_matching_config_version
  ADD COLUMN IF NOT EXISTS draft_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejection_note TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

ALTER TABLE reconciliation_matching_config_version
  ADD CONSTRAINT reconciliation_matching_config_version_rejected_by_fk
  FOREIGN KEY (rejected_by) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT;

-- A rejected row must carry its note and its rejecter together, or the audit trail records that
-- something was declined without recording by whom or why. Enforced here rather than only in the
-- service so a direct write cannot produce a half-recorded rejection.
ALTER TABLE reconciliation_matching_config_version
  ADD CONSTRAINT reconciliation_matching_config_version_rejection_complete
  CHECK (
    status <> 'REJECTED'
    OR (rejection_note IS NOT NULL AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL)
  );

--rollback ALTER TABLE reconciliation_matching_config_version DROP CONSTRAINT IF EXISTS reconciliation_matching_config_version_rejection_complete;
--rollback ALTER TABLE reconciliation_matching_config_version DROP CONSTRAINT IF EXISTS reconciliation_matching_config_version_rejected_by_fk;
--rollback ALTER TABLE reconciliation_matching_config_version DROP COLUMN IF EXISTS rejected_at;
--rollback ALTER TABLE reconciliation_matching_config_version DROP COLUMN IF EXISTS rejected_by;
--rollback ALTER TABLE reconciliation_matching_config_version DROP COLUMN IF EXISTS rejection_note;
--rollback ALTER TABLE reconciliation_matching_config_version DROP COLUMN IF EXISTS draft_reason;
--rollback ALTER TABLE reconciliation_matching_config_version DROP CONSTRAINT IF EXISTS reconciliation_matching_config_version_status_check;
--rollback ALTER TABLE reconciliation_matching_config_version ADD CONSTRAINT reconciliation_matching_config_version_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED'));
