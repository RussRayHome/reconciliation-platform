--liquibase formatted sql

--changeset recon:0010-drop_legacy_schema_migrations_table
DROP TABLE IF EXISTS schema_migrations;

--rollback CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
