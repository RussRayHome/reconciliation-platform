--liquibase formatted sql

--changeset recon:0067-add_carry_forward_decision_to_reconciliation_run splitStatements:false
-- Unreconciled Item Roll-Forward, PR C.5. Persists the resolveCarryForwardDecision outcome per
-- run, mirroring how reconciliation_job.rulepack_version already records which rule version
-- produced a run's results. Without this, a past run's output is unexplainable: two runs of the
-- same period, one before and one after an organization is enabled, produce different results
-- with nothing recording why.
--
-- Both nullable: NULL means the resolver was never called for this run (every row created before
-- this changeset, or before the resolver is actually wired into the pipeline) -- distinct from
-- carry_forward_applied = false, which means the resolver ran and explicitly declined, with the
-- reason recorded alongside it.
ALTER TABLE reconciliation_run
  ADD COLUMN carry_forward_applied BOOLEAN,
  ADD COLUMN carry_forward_skip_reason TEXT
    CHECK (carry_forward_skip_reason IS NULL OR carry_forward_skip_reason IN ('ENV_DISABLED', 'ORG_NOT_ENABLED'));

--rollback ALTER TABLE reconciliation_run DROP COLUMN IF EXISTS carry_forward_skip_reason;
--rollback ALTER TABLE reconciliation_run DROP COLUMN IF EXISTS carry_forward_applied;
