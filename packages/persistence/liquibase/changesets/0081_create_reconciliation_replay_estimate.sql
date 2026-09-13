--liquibase formatted sql

--changeset recon:0081-create_reconciliation_replay_estimate splitStatements:false
-- The replay estimate behind the 2b approver sheet (ADR-0018, Issue #530, part of #404).
--
-- A second approver is asked to decide a matching-config version and given nothing to decide on:
-- "widen the date window to 2 days" is unfalsifiable, and the change applies next run onward with
-- no retro-matching, so the replay is the only view of its consequences anyone gets. This table
-- holds what that replay produced.
--
-- ONE ROW PER (VERSION, PERIOD), NOT PER VERSION. The approver chooses which closed period to
-- replay against (owner decision, 2026-09-12), so one draft accumulates several estimates. Keying
-- on the pair is what lets the decision record say WHICH period informed the approval rather than
-- leaving a single figure's provenance implicit -- and it doubles as the cache, so re-picking a
-- period already viewed costs nothing.
--
-- SIGN CONVENTION: every delta is DRAFT MINUS ACTIVE. "12 fewer exceptions" is -12. Stated here
-- because a reader cannot recover it from the column name, and getting it backwards would invert
-- the sheet's meaning while looking perfectly plausible.
--
-- WHY A FINGERPRINT. A draft is one mutable row: its varianceOverrides can change after an
-- estimate was computed. An estimate that no longer matches the draft it describes must never
-- display, so the fingerprint of the overrides it was computed FROM travels with it and the reader
-- compares rather than trusts. Staleness against a newer CLOSED PERIOD is different and is not an
-- error -- the estimate names its period, and an older period is still evidence.
CREATE TABLE IF NOT EXISTS reconciliation_replay_estimate (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id) ON DELETE CASCADE,
  -- The DRAFT being judged. Cascades: an estimate describes one version and means nothing without
  -- it, so a deleted version takes its estimates with it rather than leaving orphans keyed to a
  -- row that no longer exists.
  matching_config_version_id UUID NOT NULL
    REFERENCES reconciliation_matching_config_version (id) ON DELETE CASCADE,
  -- The closed period replayed. Cascades for the same reason, and because normalized_record --
  -- the input this estimate was computed from -- already cascades with the run.
  reconciliation_run_id UUID NOT NULL
    REFERENCES reconciliation_run (id) ON DELETE CASCADE,
  -- Signed counts. draft - active (see the sign convention above).
  exceptions_delta INTEGER NOT NULL,
  probable_matches_delta INTEGER NOT NULL,
  -- Signed amount. NUMERIC, never a float: this is money on a screen an approver signs against.
  -- (20, 4) matches normalized_record.signed_amount, the figures it is derived from, so the
  -- estimate cannot lose precision the inputs carried.
  unresolved_exposure_delta NUMERIC(20, 4) NOT NULL,
  -- Which build produced it. ADR-0018 decision 1 requires both sides of the diff to execute in the
  -- SAME build -- otherwise an engine change since the period ran shows up as an effect of the
  -- proposed rule. Recording the build is what lets a later reader tell whether two estimates are
  -- comparable with each other.
  engine_build TEXT NOT NULL,
  -- The draft's varianceOverrides as they stood when this was computed. See "why a fingerprint".
  draft_overrides_fingerprint TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The cache key and the uniqueness rule in one. Organization-scoped rather than relying on the two
-- foreign keys alone, so the constraint holds under RLS the same way it reads in a query.
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_replay_estimate_version_run_key
  ON reconciliation_replay_estimate (organization_id, matching_config_version_id, reconciliation_run_id);

-- The approver sheet's read: every estimate computed for this draft, newest first.
CREATE INDEX IF NOT EXISTS reconciliation_replay_estimate_version_idx
  ON reconciliation_replay_estimate (organization_id, matching_config_version_id, computed_at DESC);

ALTER TABLE reconciliation_replay_estimate ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_replay_estimate_tenant_isolation ON reconciliation_replay_estimate
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

--rollback DROP POLICY IF EXISTS reconciliation_replay_estimate_tenant_isolation ON reconciliation_replay_estimate;
--rollback DROP TABLE IF EXISTS reconciliation_replay_estimate CASCADE;
