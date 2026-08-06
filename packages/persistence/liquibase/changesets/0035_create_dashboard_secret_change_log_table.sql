--liquibase formatted sql

--changeset recon:0035-create_dashboard_secret_change_log_table
-- Persisted audit trail for the Developer Dashboard's Secret Integrity panel (gitleaks +
-- trufflehog scan findings; see security-scan-secrets.mjs and ISSUE-049/ISSUE-050). Every runbook
-- action (Rotate now / Triage / Dismiss / Verify purge) taken on a finding is one row here -- an
-- append-only log, never updated or deleted, so "what happened to this secret and who did it" is
-- reconstructable the same way the SOX/ICFR audit trail work elsewhere in this schema requires.
--
-- Deliberately has no organization_id and is not added to changeset 0030's RLS policy list: this
-- is Developer Dashboard operator data (who on the team rotated/triaged a leaked credential), not
-- customer financial data, and the dashboard's own auth model (GitHub login allowlist) has no
-- tenant/organization concept to scope by. Same category exclusion as reconciliation_
-- template_definition / reconciliation_validation_rule_version in 0030 -- global, not per-tenant.
--
-- fingerprint is a sha256 prefix of the secret value the scanner computed and immediately
-- discarded the raw value for (see security-scan-secrets.mjs) -- this table, like the scanner
-- output, never holds a secret's plaintext.
CREATE TABLE dashboard_secret_change_log (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('rotate', 'triage', 'dismiss', 'verify_purge')),
  actor TEXT NOT NULL,
  ticket TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboard_secret_change_log_fingerprint ON dashboard_secret_change_log (fingerprint);

--rollback DROP TABLE IF EXISTS dashboard_secret_change_log;
