--liquibase formatted sql

--changeset recon:0076-payee_alias_approval_subject_type splitStatements:false
-- Issue #311 (PR B). A payee alias can now be PROPOSED from a reviewer's confirmed probable match
-- rather than typed in by an admin: the row is inserted with is_active = false and a generic
-- approval request opens against it, so the same maker-checker gate that guards matching-rule
-- changes (0041) also guards what the matching engine is allowed to learn. The subject_type CHECK
-- on reconciliation_approval_request was written inline in 0041, so Postgres named it
-- reconciliation_approval_request_subject_type_check; widening it means drop-and-recreate.
-- Nothing else about the table changes, and the one-PENDING-per-subject partial index from 0041
-- applies to alias proposals unchanged.
ALTER TABLE reconciliation_approval_request
  DROP CONSTRAINT reconciliation_approval_request_subject_type_check;
ALTER TABLE reconciliation_approval_request
  ADD CONSTRAINT reconciliation_approval_request_subject_type_check CHECK (
    subject_type IN (
      'mappingProfile',
      'matchingRule',
      'varianceThreshold',
      'exceptionResolution',
      'reportDistribution',
      'payeeAlias'
    )
  );
--rollback DELETE FROM reconciliation_approval_request WHERE subject_type = 'payeeAlias';
--rollback ALTER TABLE reconciliation_approval_request DROP CONSTRAINT reconciliation_approval_request_subject_type_check;
--rollback ALTER TABLE reconciliation_approval_request ADD CONSTRAINT reconciliation_approval_request_subject_type_check CHECK (subject_type IN ('mappingProfile', 'matchingRule', 'varianceThreshold', 'exceptionResolution', 'reportDistribution'));
