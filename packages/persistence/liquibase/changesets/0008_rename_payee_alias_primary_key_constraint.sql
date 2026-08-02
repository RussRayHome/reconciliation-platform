--liquibase formatted sql

--changeset recon:0008-rename_payee_alias_primary_key_constraint
ALTER TABLE reconciliation_payee_alias
  RENAME CONSTRAINT payee_alias_pkey TO reconciliation_payee_alias_pkey;

--rollback ALTER TABLE reconciliation_payee_alias RENAME CONSTRAINT reconciliation_payee_alias_pkey TO payee_alias_pkey;
