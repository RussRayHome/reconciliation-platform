--liquibase formatted sql

--changeset recon:0042-create_file_import_validation_tables splitStatements:false
-- File Imports & Validation feature: a Bank + GL two-file "reconciliation run" that passes an
-- ordered File Validation Engine (header -> column-order -> cell values) before the existing
-- GL<->Bank matching pipeline (packages/core/src/matching/*) runs against it. Deliberately a
-- separate table family from the existing reconciliation_source_file / reconciliation_job /
-- reconciliation_staged_transaction / reconciliation_validation_result tables -- this is new
-- schema per the design-handoff bundle's implementation-spec.md, not a reuse of the older import
-- path, per an explicit product decision to keep the two families independent. Every table here
-- is born tenant-scoped (organization_id NOT NULL from creation, no backfill needed) -- RLS is
-- added in changeset 0043 immediately after.
--
-- id columns are application-supplied UUIDs (no DEFAULT), matching every other table in this
-- schema (see reconciliation_organization, reconciliation_job, etc.) -- the app generates ids,
-- not Postgres.

-- ── import_file ──────────────────────────────────────────────────────────────────────────────────
-- One row per stored upload; a reconciliation_run has exactly two (Bank + GL). Raw bytes live in
-- the sibling import_file_content table, not here -- import_file is read on hot paths (run
-- summaries, review-tab listings) and keeping BYTEA off it matches the same reasoning
-- reconciliation_source_file_content's own changeset (0019) already established for the older
-- import path.
CREATE TABLE IF NOT EXISTS import_file (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  original_filename TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK (file_format IN ('CSV', 'XLSX')),
  -- Detected from filename, analyst-overridable at upload time (SourceDropZone slot picker).
  file_type TEXT NOT NULL CHECK (file_type IN ('BANK', 'GL')),
  content_sha256 CHAR(64) NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  validation_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (validation_status IN ('PENDING', 'VALID', 'VALID_WITH_WARNINGS', 'INVALID')),
  row_count INTEGER,
  error_count INTEGER,
  warning_count INTEGER,
  date_range_start DATE,
  date_range_end DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS import_file_organization_idx ON import_file (organization_id);
-- Lookup for app-layer dedupe (re-upload of identical bytes) -- deliberately not UNIQUE: the same
-- file legitimately gets re-uploaded across different runs/periods, so the app decides whether to
-- reuse or create a new row, matching reconciliation_source_file_content's own non-unique index.
CREATE INDEX IF NOT EXISTS import_file_content_sha256_idx ON import_file (content_sha256);

-- ── import_file_content ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_file_content (
  -- PK *is* the FK: exactly one content row per import_file, enforced structurally, matching
  -- reconciliation_source_file_content's own design.
  import_file_id UUID PRIMARY KEY REFERENCES import_file (id) ON DELETE CASCADE,
  -- Denormalized from import_file.organization_id (not derivable via a cheap RLS-policy join) --
  -- same reasoning as reconciliation_source_file_content.organization_id, added in changeset 0028.
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  content BYTEA NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT import_file_content_length_matches_check CHECK (octet_length(content) = byte_size)
);

CREATE INDEX IF NOT EXISTS import_file_content_organization_idx ON import_file_content (organization_id);

-- ── reconciliation_run ───────────────────────────────────────────────────────────────────────────
-- The unit a senior-analyst submits: bundles the Bank + GL import_file pair with run config.
-- status is the full DRAFT..RECONCILED/REJECTED lifecycle from the design handoff. Note (product
-- decision, not implied by the schema alone): the transition VALIDATING -> PENDING_APPROVAL does
-- NOT gate the GL<->Bank matching pipeline -- matching still fires immediately once validation
-- passes, same as today's existing atomic reconciliation flow. PENDING_APPROVAL/APPROVED/REJECTED
-- exist as a parallel Comptroller review trail, not an execution gate.
CREATE TABLE IF NOT EXISTS reconciliation_run (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  label TEXT NOT NULL,
  account_identifier TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('MONTHLY', 'ANNUAL')),
  period_year INTEGER NOT NULL,
  period_month INTEGER CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12),
  bank_file_id UUID NOT NULL REFERENCES import_file (id),
  gl_file_id UUID NOT NULL REFERENCES import_file (id),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT', 'VALIDATING', 'VALIDATION_FAILED', 'PENDING_APPROVAL',
      'APPROVED', 'RECONCILING', 'RECONCILED', 'REJECTED'
    )),
  -- References reconciliation_user(id) (the UUID surrogate key added by changeset 0024), not the
  -- user_name primary key -- 0024's own comment names this as the intended FK target for new
  -- tables going forward.
  submitted_by UUID REFERENCES reconciliation_user (id),
  submitted_at TIMESTAMPTZ,
  decided_by UUID REFERENCES reconciliation_user (id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  excluded_row_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Segregation of duty (implementation-spec.md §5.1): the analyst who submitted a run may never
  -- also be its approver. Enforced here rather than only at the application layer -- both columns
  -- live on the same row, so a single-row CHECK is sufficient (no need for a trigger). Trivially
  -- satisfied while decided_by is still NULL (not yet decided).
  CONSTRAINT reconciliation_run_segregation_of_duty_check
    CHECK (decided_by IS NULL OR submitted_by IS DISTINCT FROM decided_by)
);

CREATE INDEX IF NOT EXISTS reconciliation_run_organization_idx ON reconciliation_run (organization_id);
CREATE INDEX IF NOT EXISTS reconciliation_run_status_submitted_by_idx
  ON reconciliation_run (status, submitted_by);

-- ── import_job ───────────────────────────────────────────────────────────────────────────────────
-- Async work unit for validating one run's two files. Processing state (QUEUED/RUNNING/...) is
-- distinct from reconciliation_run.status, matching the existing split between
-- reconciliation_job.current_state (processing) and any higher-level run concept elsewhere in
-- this schema.
CREATE TABLE IF NOT EXISTS import_job (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  reconciliation_run_id UUID NOT NULL REFERENCES reconciliation_run (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  error_summary TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS import_job_organization_idx ON import_job (organization_id);
CREATE INDEX IF NOT EXISTS import_job_reconciliation_run_idx ON import_job (reconciliation_run_id);

-- ── validation_issue ─────────────────────────────────────────────────────────────────────────────
-- One row per File Validation Engine finding (STRUCT_*/BANK_*/GL_* codes from
-- transaction-csv-spec.md). row_number is 1-based and excludes the header row, matching
-- schema.ts's own ValidationIssue.rowNumber convention.
CREATE TABLE IF NOT EXISTS validation_issue (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  import_job_id UUID NOT NULL REFERENCES import_job (id) ON DELETE CASCADE,
  import_file_id UUID NOT NULL REFERENCES import_file (id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('ERROR', 'WARNING')),
  code TEXT NOT NULL,
  row_number INTEGER,
  entry_id TEXT,
  field TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS validation_issue_organization_idx ON validation_issue (organization_id);
CREATE INDEX IF NOT EXISTS validation_issue_import_job_idx ON validation_issue (import_job_id);
CREATE INDEX IF NOT EXISTS validation_issue_import_file_idx ON validation_issue (import_file_id);

-- ── normalized_record ────────────────────────────────────────────────────────────────────────────
-- Reconciliation-ready output of a passed validation, mirroring schema.ts's NormalizedRecord.
-- reconciliation_run_id is denormalized alongside import_job_id/import_file_id purely for query
-- convenience (list every normalized row for a run without an import_job join), matching the
-- denormalization style already used elsewhere in this schema (e.g. reconciliation_canonical_row).
CREATE TABLE IF NOT EXISTS normalized_record (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id),
  import_job_id UUID NOT NULL REFERENCES import_job (id) ON DELETE CASCADE,
  import_file_id UUID NOT NULL REFERENCES import_file (id) ON DELETE CASCADE,
  reconciliation_run_id UUID NOT NULL REFERENCES reconciliation_run (id) ON DELETE CASCADE,
  source_system TEXT NOT NULL CHECK (source_system IN ('BANK', 'GL')),
  record_id TEXT NOT NULL,
  source_line_number INTEGER NOT NULL,
  account TEXT NOT NULL,
  txn_date DATE NOT NULL,
  currency_code CHAR(3) NOT NULL,
  signed_amount NUMERIC(20, 4) NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INFLOW', 'OUTFLOW')),
  magnitude NUMERIC(20, 4) NOT NULL,
  excluded BOOLEAN NOT NULL DEFAULT FALSE,
  exclusion_reason TEXT,
  description TEXT NOT NULL,
  reference TEXT,
  raw JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS normalized_record_organization_idx ON normalized_record (organization_id);
CREATE INDEX IF NOT EXISTS normalized_record_reconciliation_run_idx ON normalized_record (reconciliation_run_id);
CREATE INDEX IF NOT EXISTS normalized_record_account_txn_date_idx ON normalized_record (account, txn_date);
CREATE INDEX IF NOT EXISTS normalized_record_signed_amount_idx ON normalized_record (signed_amount);

--rollback DROP TABLE IF EXISTS normalized_record CASCADE;
--rollback DROP TABLE IF EXISTS validation_issue CASCADE;
--rollback DROP TABLE IF EXISTS import_job CASCADE;
--rollback DROP TABLE IF EXISTS reconciliation_run CASCADE;
--rollback DROP TABLE IF EXISTS import_file_content CASCADE;
--rollback DROP TABLE IF EXISTS import_file CASCADE;
