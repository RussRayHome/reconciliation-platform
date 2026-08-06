--liquibase formatted sql

--changeset recon:0037-create_dashboard_secret_scan_history_tables
-- dashboard_secret_change_log (0035) records what a human did about a finding; it says nothing
-- about what the scanner actually saw on a given night. Without this, "was this secret present
-- on March 3rd" is only answerable by manually walking the status-data branch's git history --
-- not a real answer for SOX evidence. These two tables give a durable, queryable history of every
-- nightly (or manual) secret-integrity scan and every finding it produced.
--
-- One row per scan run, keyed by the status-data branch commit it was read from (not the scan's
-- own generatedAt alone, since a re-publish with no content change would otherwise look like a
-- second run of the same data). dashboard-secret-scan-history-sync.ts in developer-dashboard-api
-- is the only writer -- it walks status-data's recent commit history and inserts any run this
-- table doesn't have yet, so a quiet dashboard (nobody loading it for a few days) doesn't silently
-- lose nights the way a "snapshot of whatever's latest" approach would.
CREATE TABLE dashboard_secret_scan_run (
  id BIGSERIAL PRIMARY KEY,
  environment TEXT NOT NULL,
  status_commit_sha TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  gitleaks_available BOOLEAN NOT NULL,
  trufflehog_available BOOLEAN NOT NULL,
  critical_count INT NOT NULL,
  high_count INT NOT NULL,
  moderate_count INT NOT NULL,
  low_count INT NOT NULL,
  info_count INT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (environment, status_commit_sha)
);

-- One row per finding per scan run -- a full snapshot each run rather than a diff/delta, so a
-- query for one run's rows is always the complete picture that run saw, with no need to replay
-- earlier rows to reconstruct it. Volume is bounded: nightly cadence, a handful of findings at
-- most, so this does not grow the way a per-request or per-transaction log would.
CREATE TABLE dashboard_secret_finding_snapshot (
  id BIGSERIAL PRIMARY KEY,
  scan_run_id BIGINT NOT NULL REFERENCES dashboard_secret_scan_run (id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  masked_secret TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  description TEXT NOT NULL,
  file TEXT NOT NULL,
  start_line INT,
  commit_sha TEXT,
  author TEXT,
  secret_committed_at TIMESTAMPTZ,
  present_at_head BOOLEAN NOT NULL,
  sources TEXT[] NOT NULL,
  verified BOOLEAN
);

CREATE INDEX idx_dashboard_secret_finding_snapshot_scan_run ON dashboard_secret_finding_snapshot (scan_run_id);
CREATE INDEX idx_dashboard_secret_finding_snapshot_fingerprint ON dashboard_secret_finding_snapshot (fingerprint);

--rollback DROP TABLE IF EXISTS dashboard_secret_finding_snapshot;
--rollback DROP TABLE IF EXISTS dashboard_secret_scan_run;
