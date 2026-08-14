--liquibase formatted sql

--changeset recon:0049-grant_app_user_file_import_sequences splitStatements:false
-- 0031's ALTER DEFAULT PRIVILEGES only covered future TABLES, never SEQUENCES -- so the
-- BIGSERIAL id columns 0042 added (validation_issue, normalized_record; the latter renamed to
-- canonical_record by 0046, but ALTER TABLE RENAME does not rename the sequence Postgres
-- auto-created alongside it) were never granted to app_user. Every INSERT into either table
-- fails at runtime with "permission denied for sequence ..._id_seq" as soon as the DEFAULT
-- nextval() fires, discovered running the File Imports & Validation upload flow end-to-end
-- against a freshly migrated database. Grants both existing sequences explicitly and adds the
-- missing default-privilege clause so no future SERIAL/BIGSERIAL table repeats this.
GRANT USAGE, SELECT ON SEQUENCE validation_issue_id_seq TO app_user;
GRANT USAGE, SELECT ON SEQUENCE normalized_record_id_seq TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

--rollback ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM app_user;
--rollback REVOKE ALL ON SEQUENCE normalized_record_id_seq FROM app_user;
--rollback REVOKE ALL ON SEQUENCE validation_issue_id_seq FROM app_user;
