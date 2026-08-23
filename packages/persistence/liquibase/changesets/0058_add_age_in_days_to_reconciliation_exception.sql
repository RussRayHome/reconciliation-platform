--liquibase formatted sql

--changeset recon:0058-add_age_in_days_to_reconciliation_exception
ALTER TABLE reconciliation_exception
  ADD COLUMN age_in_days INTEGER;

--rollback ALTER TABLE reconciliation_exception DROP COLUMN IF EXISTS age_in_days;
