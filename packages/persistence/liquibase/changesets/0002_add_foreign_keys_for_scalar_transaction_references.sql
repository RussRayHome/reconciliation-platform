--liquibase formatted sql

--changeset recon:0002-add_foreign_keys_for_scalar_transaction_references
ALTER TABLE reconciliation_match_result
  ADD CONSTRAINT reconciliation_match_result_bank_transaction_fk
  FOREIGN KEY (bank_transaction_id)
  REFERENCES reconciliation_canonical_row(id)
  ON DELETE SET NULL;

ALTER TABLE reconciliation_match_result
  ADD CONSTRAINT reconciliation_match_result_qbo_transaction_fk
  FOREIGN KEY (qbo_transaction_id)
  REFERENCES reconciliation_canonical_row(id)
  ON DELETE SET NULL;

ALTER TABLE reconciliation_rule_result
  ADD CONSTRAINT reconciliation_rule_result_candidate_transaction_fk
  FOREIGN KEY (candidate_transaction_id)
  REFERENCES reconciliation_canonical_row(id)
  ON DELETE SET NULL;

ALTER TABLE reconciliation_exception
  ADD CONSTRAINT reconciliation_exception_canonical_row_fk
  FOREIGN KEY (canonical_row_id)
  REFERENCES reconciliation_canonical_row(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reconciliation_match_result_bank_transaction_idx
  ON reconciliation_match_result (bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_match_result_qbo_transaction_idx
  ON reconciliation_match_result (qbo_transaction_id)
  WHERE qbo_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_rule_result_candidate_transaction_idx
  ON reconciliation_rule_result (candidate_transaction_id)
  WHERE candidate_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reconciliation_exception_canonical_row_idx
  ON reconciliation_exception (canonical_row_id)
  WHERE canonical_row_id IS NOT NULL;

--rollback DROP INDEX IF EXISTS reconciliation_exception_canonical_row_idx;
--rollback DROP INDEX IF EXISTS reconciliation_rule_result_candidate_transaction_idx;
--rollback DROP INDEX IF EXISTS reconciliation_match_result_qbo_transaction_idx;
--rollback DROP INDEX IF EXISTS reconciliation_match_result_bank_transaction_idx;
--rollback ALTER TABLE reconciliation_exception DROP CONSTRAINT IF EXISTS reconciliation_exception_canonical_row_fk;
--rollback ALTER TABLE reconciliation_rule_result DROP CONSTRAINT IF EXISTS reconciliation_rule_result_candidate_transaction_fk;
--rollback ALTER TABLE reconciliation_match_result DROP CONSTRAINT IF EXISTS reconciliation_match_result_qbo_transaction_fk;
--rollback ALTER TABLE reconciliation_match_result DROP CONSTRAINT IF EXISTS reconciliation_match_result_bank_transaction_fk;
