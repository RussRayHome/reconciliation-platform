--liquibase formatted sql

--changeset recon:0038-grant_dashboard_app_runtime_scan_history splitStatements:false
-- Extends dashboard_app_runtime (0036) to the two scan-history tables (0037). SELECT + INSERT
-- only, same reasoning as 0036's grant on dashboard_secret_change_log: the sync job that writes
-- these rows never updates or deletes one, a scan snapshot is immutable once recorded.
GRANT SELECT, INSERT ON dashboard_secret_scan_run TO dashboard_app_runtime;
GRANT USAGE, SELECT ON SEQUENCE dashboard_secret_scan_run_id_seq TO dashboard_app_runtime;

GRANT SELECT, INSERT ON dashboard_secret_finding_snapshot TO dashboard_app_runtime;
GRANT USAGE, SELECT ON SEQUENCE dashboard_secret_finding_snapshot_id_seq TO dashboard_app_runtime;

--rollback REVOKE ALL ON SEQUENCE dashboard_secret_finding_snapshot_id_seq FROM dashboard_app_runtime;
--rollback REVOKE ALL ON dashboard_secret_finding_snapshot FROM dashboard_app_runtime;
--rollback REVOKE ALL ON SEQUENCE dashboard_secret_scan_run_id_seq FROM dashboard_app_runtime;
--rollback REVOKE ALL ON dashboard_secret_scan_run FROM dashboard_app_runtime;
