--liquibase formatted sql

--changeset recon:0041-create_reconciliation_approval_request_tables splitStatements:false
-- Generic approval-request tables backing the five ApprovableTypes that are NOT 'import'
-- (mappingProfile, matchingRule, varianceThreshold, exceptionResolution, reportDistribution --
-- see @recon/domain's ApprovableType). Mirrors reconciliation_import_approval /
-- reconciliation_approval_history (changeset 0017) in shape, but polymorphic via
-- subject_type/subject_id instead of a dedicated source_file_id FK, since these five types each
-- point at a different existing (or, for exceptionResolution/reportDistribution, not-yet-built)
-- entity table. 'import' itself deliberately keeps using its own dedicated table rather than
-- migrating onto this one -- it already has FKs, an RLS policy, and a canonical-lineage view
-- join (changeset 0021) built around it, and migrating it is a separate, higher-risk change.
--
-- At most one PENDING approval request per subject is enforced by the partial unique index
-- below (mirrors the one_active_idx / one_draft_idx pattern in changeset 0039): a subject with a
-- rejected or approved request can get a new one once its state changes, but never two pending
-- requests at once.
CREATE TABLE IF NOT EXISTS reconciliation_approval_request (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  subject_type TEXT NOT NULL CHECK (
    subject_type IN (
      'mappingProfile',
      'matchingRule',
      'varianceThreshold',
      'exceptionResolution',
      'reportDistribution'
    )
  ),
  subject_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'OVERRIDDEN')),
  submitted_by TEXT NOT NULL,
  decided_by TEXT,
  rationale TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  CONSTRAINT reconciliation_approval_request_organization_fk
    FOREIGN KEY (organization_id) REFERENCES reconciliation_organization(id) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_approval_request_submitted_by_fk
    FOREIGN KEY (submitted_by) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_approval_request_decided_by_fk
    FOREIGN KEY (decided_by) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_approval_request_one_pending_idx
  ON reconciliation_approval_request (subject_type, subject_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS reconciliation_approval_request_status_idx
  ON reconciliation_approval_request (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS reconciliation_approval_request_submitted_by_idx
  ON reconciliation_approval_request (submitted_by, status);

CREATE INDEX IF NOT EXISTS reconciliation_approval_request_decided_by_idx
  ON reconciliation_approval_request (decided_by, status)
  WHERE decided_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_approval_request_subject_idx
  ON reconciliation_approval_request (subject_type, subject_id);

ALTER TABLE reconciliation_approval_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_approval_request_tenant_isolation
  ON reconciliation_approval_request
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- Append-only decision trail, same relationship reconciliation_approval_history has to
-- reconciliation_import_approval (changeset 0017).
CREATE TABLE IF NOT EXISTS reconciliation_approval_request_history (
  id UUID PRIMARY KEY,
  approval_request_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_approval_request_history_request_fk
    FOREIGN KEY (approval_request_id) REFERENCES reconciliation_approval_request(id) ON DELETE CASCADE,
  CONSTRAINT reconciliation_approval_request_history_organization_fk
    FOREIGN KEY (organization_id) REFERENCES reconciliation_organization(id) ON DELETE RESTRICT,
  CONSTRAINT reconciliation_approval_request_history_actor_fk
    FOREIGN KEY (actor) REFERENCES reconciliation_user(user_name) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS reconciliation_approval_request_history_request_idx
  ON reconciliation_approval_request_history (approval_request_id, created_at ASC);

ALTER TABLE reconciliation_approval_request_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_approval_request_history_tenant_isolation
  ON reconciliation_approval_request_history
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

--rollback DROP TABLE IF EXISTS reconciliation_approval_request_history CASCADE;
--rollback DROP TABLE IF EXISTS reconciliation_approval_request CASCADE;
