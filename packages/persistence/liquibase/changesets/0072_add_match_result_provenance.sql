--liquibase formatted sql

--changeset recon:0072-add_match_result_provenance splitStatements:false
-- H7 (Issue #276): a persisted match result recorded WHAT the engine decided but nothing about the
-- configuration it decided under. Once an organization edits its amount tolerance, every exception
-- already on record becomes un-re-explainable: the disposition is still there, the number that
-- produced it is not. Evidence strings were the only carrier, and they were inconsistent -- the
-- grouped rules interpolate the tolerance, the pairwise rules emit "Amounts agree within configured
-- tolerance" with no value at all.
--
-- Both columns are NULLABLE and carry no DEFAULT, deliberately. Existing rows were written by an
-- engine that never captured this, so their tolerance is genuinely unknown. Backfilling them with
-- today's default would manufacture the audit record this change exists to make trustworthy -- an
-- unknown that reads as a measurement is worse than an unknown that reads as NULL. The read model
-- surfaces NULL as "not recorded" rather than substituting a value.
--
-- NUMERIC(18, 6) rather than reconciliation_match_result.amount_difference's NUMERIC(18, 2): a
-- tolerance is a threshold, not a posted amount, and nothing constrains it to whole cents. Storing
-- it at the money scale would silently round a sub-cent tolerance to 0.00 and assert exact-amount
-- matching for a run that did no such thing. DOUBLE PRECISION was rejected for the same reason
-- amount_difference is not one: this value gets compared against money.
--
-- matching_config_version_id carries a real FK with ON DELETE RESTRICT. Versions are append-only
-- (status moves DRAFT -> ACTIVE -> SUPERSEDED; nothing deletes them), so RESTRICT costs nothing in
-- normal operation and refuses the one operation that would turn a provenance record into a
-- dangling id. SET NULL was rejected: it would silently downgrade "decided under version X" to
-- "decided under engine defaults", which is a different and false claim.
--
-- The column is expected to be NULL for every row written today. OVERRIDES_APPLIED_TO_ENGINE is
-- false (Issue #260), so no published version reaches the engine, and NULL correctly means "engine
-- defaults". The column exists now so that wiring #260 records provenance automatically instead of
-- needing a second migration against rows already written.
ALTER TABLE reconciliation_match_result
  ADD COLUMN IF NOT EXISTS applied_amount_tolerance NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS matching_config_version_id UUID;

ALTER TABLE reconciliation_match_result
  ADD CONSTRAINT reconciliation_match_result_matching_config_version_fk
  FOREIGN KEY (matching_config_version_id)
  REFERENCES reconciliation_matching_config_version (id)
  ON DELETE RESTRICT;

--rollback ALTER TABLE reconciliation_match_result DROP CONSTRAINT IF EXISTS reconciliation_match_result_matching_config_version_fk;
--rollback ALTER TABLE reconciliation_match_result DROP COLUMN IF EXISTS matching_config_version_id;
--rollback ALTER TABLE reconciliation_match_result DROP COLUMN IF EXISTS applied_amount_tolerance;
