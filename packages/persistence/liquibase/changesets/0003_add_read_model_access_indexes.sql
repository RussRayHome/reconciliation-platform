--liquibase formatted sql

--changeset recon:0003-add_read_model_access_indexes
CREATE INDEX IF NOT EXISTS reconciliation_job_completed_report_idx
  ON reconciliation_job (completed_at DESC, created_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_match_result_job_result_bucket_created_idx
  ON reconciliation_match_result (job_id, result_bucket, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS reconciliation_match_result_job_bank_transaction_lookup_idx
  ON reconciliation_match_result (job_id, bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_match_result_job_qbo_transaction_lookup_idx
  ON reconciliation_match_result (job_id, qbo_transaction_id)
  WHERE qbo_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_exception_job_line_order_idx
  ON reconciliation_exception (job_id, line_number ASC, id ASC);

CREATE INDEX IF NOT EXISTS reconciliation_exception_job_category_line_order_idx
  ON reconciliation_exception (job_id, category, line_number ASC, id ASC);

CREATE INDEX IF NOT EXISTS reconciliation_review_decision_job_created_idx
  ON reconciliation_review_decision (job_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS reconciliation_review_observation_job_created_idx
  ON reconciliation_review_observation (job_id, created_at ASC, id ASC);

--rollback DROP INDEX IF EXISTS reconciliation_review_observation_job_created_idx;
--rollback DROP INDEX IF EXISTS reconciliation_review_decision_job_created_idx;
--rollback DROP INDEX IF EXISTS reconciliation_exception_job_category_line_order_idx;
--rollback DROP INDEX IF EXISTS reconciliation_exception_job_line_order_idx;
--rollback DROP INDEX IF EXISTS reconciliation_match_result_job_qbo_transaction_lookup_idx;
--rollback DROP INDEX IF EXISTS reconciliation_match_result_job_bank_transaction_lookup_idx;
--rollback DROP INDEX IF EXISTS reconciliation_match_result_job_result_bucket_created_idx;
--rollback DROP INDEX IF EXISTS reconciliation_job_completed_report_idx;
