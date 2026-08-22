--liquibase formatted sql

--changeset recon:0052-create_reconciliation_run_timeline_function splitStatements:false
-- A single queryable interface across every stage of the import/validate/approve/reconcile
-- pipeline for one reconciliation_run: import (run_source_file/import_file), file validation
-- (import_job/validation_issue), approval (columns directly on reconciliation_run itself --
-- confirmed no dedicated approval table backs this flow; reconciliation_import_approval and
-- reconciliation_approval_request are unrelated legacy/config-subject mechanisms), reconciliation
-- matching (reconciliation_job), and step-by-step messages (reconciliation_audit_event).
--
-- Plain LANGUAGE sql, not plpgsql: this is one query (a UNION ALL), not procedural logic, so a SQL
-- function is both the simpler and the more inlinable choice (the planner can fold it into the
-- caller's plan, unlike plpgsql). STABLE (not VOLATILE) since it only reads; SECURITY INVOKER
-- (the default) so RLS on every underlying table is enforced under the calling session exactly as
-- it would be for a hand-written query -- this function is not a privilege-escalation path.
--
-- p_organization_id is required defense in depth, matching the precedent already established in
-- PostgresImportRunStore.getLatestRunSummary (packages/persistence/src/importRunStore.ts) -- RLS
-- already scopes every table by the session's app.current_organization_id, but a "gather across
-- many tables by one run id" query is exactly the shape worth double-checking explicitly rather
-- than trusting RLS alone.
CREATE FUNCTION reconciliation_run_timeline(p_organization_id uuid, p_run_id uuid)
RETURNS TABLE (
  stage text,
  occurred_at timestamptz,
  event_type text,
  status text,
  actor text,
  message text,
  details jsonb
)
LANGUAGE sql
STABLE
AS $$
  -- Postgres forbids expressions (only bare output-column names) in an ORDER BY that directly
  -- follows a UNION ALL -- the whole UNION is wrapped as `timeline` so the CASE-based tiebreaker
  -- below can reference stage/event_type as ordinary columns of an outer, non-set-operation query.
  SELECT * FROM (
  WITH run AS (
    SELECT r.*
    FROM reconciliation_run r
    WHERE r.id = p_run_id
      AND r.organization_id = p_organization_id
  )

  -- Import: the run itself being created.
  SELECT
    'import' AS stage,
    run.created_at AS occurred_at,
    'run.created' AS event_type,
    run.status,
    NULL AS actor,
    format('Run "%s" created', run.label) AS message,
    jsonb_build_object(
      'label', run.label,
      'frequency', run.frequency,
      'periodYear', run.period_year,
      'periodMonth', run.period_month
    ) AS details
  FROM run

  UNION ALL

  -- Import: each source file attached to the run.
  SELECT
    'import',
    rsf.created_at,
    'file.attached',
    imp_file.validation_status,
    NULL,
    format('%s file "%s" attached', rsf.role, imp_file.original_filename),
    jsonb_build_object(
      'importFileId', imp_file.id,
      'role', rsf.role,
      'rowCount', imp_file.row_count,
      'errorCount', imp_file.error_count,
      'warningCount', imp_file.warning_count
    )
  FROM run_source_file rsf
  JOIN import_file imp_file ON imp_file.id = rsf.import_file_id
  JOIN run ON run.id = rsf.reconciliation_run_id
  WHERE rsf.organization_id = p_organization_id

  UNION ALL

  -- File validation: each import_job's queued/started/finished checkpoints.
  SELECT 'file_validation', ij.queued_at, 'validation.queued', ij.status, NULL,
    'File validation queued', jsonb_build_object('importJobId', ij.id)
  FROM import_job ij
  JOIN run ON run.id = ij.reconciliation_run_id
  WHERE ij.organization_id = p_organization_id

  UNION ALL

  SELECT 'file_validation', ij.started_at, 'validation.started', ij.status, NULL,
    'File validation started', jsonb_build_object('importJobId', ij.id)
  FROM import_job ij
  JOIN run ON run.id = ij.reconciliation_run_id
  WHERE ij.organization_id = p_organization_id
    AND ij.started_at IS NOT NULL

  UNION ALL

  -- ij.status only reflects whether the job ran to completion, not the validation verdict --
  -- a job that runs cleanly to completion and finds row-level errors still reports SUCCEEDED
  -- (confirmed against a live VALIDATION_FAILED run: ij.status='SUCCEEDED', error_summary=NULL,
  -- the failure only visible via run.status and the validation_issue rows above). The true
  -- verdict lives on reconciliation_run.status, so it drives the event type/message here, not
  -- ij.status alone; ij.status is still surfaced as its own column for job-health visibility.
  SELECT
    'file_validation',
    ij.finished_at,
    CASE
      WHEN ij.status = 'FAILED' THEN 'validation.errored'
      WHEN run.status = 'VALIDATION_FAILED' THEN 'validation.failed'
      ELSE 'validation.passed'
    END,
    ij.status,
    NULL,
    CASE
      WHEN ij.status = 'FAILED' THEN coalesce(ij.error_summary, 'File validation errored')
      WHEN run.status = 'VALIDATION_FAILED' THEN 'File validation failed'
      ELSE 'File validation passed'
    END,
    jsonb_build_object('importJobId', ij.id, 'errorSummary', ij.error_summary)
  FROM import_job ij
  JOIN run ON run.id = ij.reconciliation_run_id
  WHERE ij.organization_id = p_organization_id
    AND ij.finished_at IS NOT NULL

  UNION ALL

  -- File validation: each individual row-level issue.
  SELECT
    'file_validation',
    vi.created_at,
    'validation.issue',
    vi.severity,
    NULL,
    vi.message,
    jsonb_build_object(
      'code', vi.code,
      'field', vi.field,
      'rowNumber', vi.row_number,
      'importFileId', vi.import_file_id
    )
  FROM validation_issue vi
  JOIN import_job ij ON ij.id = vi.import_job_id
  JOIN run ON run.id = ij.reconciliation_run_id
  WHERE vi.organization_id = p_organization_id

  UNION ALL

  -- Approval: submission and decision, both recorded directly on reconciliation_run.
  SELECT
    'approval',
    run.submitted_at,
    'approval.submitted',
    run.status,
    submitter.user_name,
    format('Submitted for approval by %s', coalesce(submitter.user_name, 'unknown user')),
    '{}'::jsonb
  FROM run
  LEFT JOIN reconciliation_user submitter ON submitter.id = run.submitted_by
  WHERE run.submitted_at IS NOT NULL

  UNION ALL

  SELECT
    'approval',
    run.decided_at,
    CASE WHEN run.status = 'REJECTED' THEN 'approval.rejected' ELSE 'approval.approved' END,
    run.status,
    decider.user_name,
    format('%s by %s', initcap(run.status), coalesce(decider.user_name, 'unknown user')),
    jsonb_build_object('decisionNote', run.decision_note)
  FROM run
  LEFT JOIN reconciliation_user decider ON decider.id = run.decided_by
  WHERE run.decided_at IS NOT NULL

  UNION ALL

  -- Reconciliation matching: job creation and terminal outcome.
  SELECT 'reconciliation', j.created_at, 'matching.created', j.current_state, NULL,
    'Reconciliation matching job created', jsonb_build_object('matchingJobId', j.id)
  FROM reconciliation_job j
  JOIN run ON run.matching_job_id = j.id
  WHERE j.organization_id = p_organization_id

  UNION ALL

  SELECT
    'reconciliation',
    j.completed_at,
    CASE WHEN j.current_state = 'FAILED' THEN 'matching.failed' ELSE 'matching.completed' END,
    j.current_state,
    NULL,
    coalesce(j.failure_message, 'Reconciliation matching ' || lower(j.current_state)),
    jsonb_build_object('failureCode', j.failure_code, 'failureMessage', j.failure_message)
  FROM reconciliation_job j
  JOIN run ON run.matching_job_id = j.id
  WHERE j.organization_id = p_organization_id
    AND j.completed_at IS NOT NULL

  UNION ALL

  -- Reconciliation matching: every step-by-step audit message.
  SELECT
    'reconciliation',
    ae.created_at,
    ae.event_type,
    ae.to_state,
    ae.actor,
    coalesce(ae.details_json ->> 'message', ae.event_type),
    ae.details_json
  FROM reconciliation_audit_event ae
  JOIN run ON run.matching_job_id = ae.job_id
  WHERE ae.organization_id = p_organization_id
  ) AS timeline

  -- Same-millisecond rows (e.g. run.created and every file.attached row, all stamped in one
  -- transaction) are otherwise unordered -- break ties by pipeline stage order so the output
  -- reads top-to-bottom the way the pipeline actually runs, not alphabetically by stage name.
  ORDER BY
    occurred_at ASC NULLS LAST,
    CASE stage
      WHEN 'import' THEN 0
      WHEN 'file_validation' THEN 1
      WHEN 'approval' THEN 2
      WHEN 'reconciliation' THEN 3
      ELSE 4
    END,
    CASE event_type
      WHEN 'run.created' THEN 0
      WHEN 'file.attached' THEN 1
      WHEN 'validation.queued' THEN 0
      WHEN 'validation.started' THEN 1
      WHEN 'validation.issue' THEN 2
      WHEN 'approval.submitted' THEN 0
      WHEN 'matching.created' THEN 0
      ELSE 9
    END,
    event_type;
$$;

--rollback DROP FUNCTION IF EXISTS reconciliation_run_timeline(uuid, uuid);
