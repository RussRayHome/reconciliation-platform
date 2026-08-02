--liquibase formatted sql

--changeset recon:0004-enable_pgaudit_extension_when_preloaded splitStatements:false
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgaudit')
    AND POSITION('pgaudit' IN current_setting('shared_preload_libraries', true)) > 0 THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pgaudit;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'Skipping pgaudit extension initialization: %', SQLERRM;
    END;
  END IF;
END
$$;

--rollback DROP EXTENSION IF EXISTS pgaudit;
