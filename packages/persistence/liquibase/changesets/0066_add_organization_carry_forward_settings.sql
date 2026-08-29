--liquibase formatted sql

--changeset recon:0066-add_organization_carry_forward_settings splitStatements:false
-- Unreconciled Item Roll-Forward, PR C.5 (see design/matching/engine/PR-D-Gating-Change-Document.pdf). Carry-forward
-- enablement is a rollout property, not a matching tolerance: it records whether an organization
-- has been onboarded onto open-item roll-forward, not a threshold an analyst tunes. Deliberately
-- NOT placed in reconciliation_matching_config_version.variance_overrides, for two reasons: (1)
-- that column is Partial<Record<keyof MatchingConfig, number>> and every MatchingConfig field is
-- numeric -- carrying a boolean there means widening the type through METRIC_RANGES,
-- RuleVarianceMetric, the catalog UI, and the override-validation path, for one flag; (2) that
-- whole stack is not wired to the engine yet (OVERRIDES_APPLIED_TO_ENGINE = false,
-- apps/api/src/services/rulesCatalog.ts), so a value stored there would be silently ignored.
--
-- updated_at is added alongside because reconciliation_organization never had one, and changeset
-- 0053's set_updated_at trigger convention requires it for any table that becomes mutable.
ALTER TABLE reconciliation_organization
  ADD COLUMN carry_forward_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN carry_forward_enabled_at TIMESTAMPTZ,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TRIGGER trg_reconciliation_organization_updated_at
  BEFORE UPDATE ON reconciliation_organization
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--rollback DROP TRIGGER IF EXISTS trg_reconciliation_organization_updated_at ON reconciliation_organization;
--rollback ALTER TABLE reconciliation_organization DROP COLUMN IF EXISTS updated_at;
--rollback ALTER TABLE reconciliation_organization DROP COLUMN IF EXISTS carry_forward_enabled_at;
--rollback ALTER TABLE reconciliation_organization DROP COLUMN IF EXISTS carry_forward_enabled;
