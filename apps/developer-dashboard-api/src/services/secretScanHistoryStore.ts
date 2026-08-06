/**
 * Durable history of every secret-integrity scan run and the findings it produced -- distinct from
 * secretActionsStore.ts, which records what a human did about a finding, not what the scanner saw.
 * Without this, "was this secret present on March 3rd" was only answerable by manually walking the
 * status-data branch's git history, not a real answer for the SOX evidence this feature exists for.
 *
 * Same Postgres, same dashboard_app_runtime role, same SELECT/INSERT-only least-privilege posture
 * as secretActionsStore.ts (see changesets 0037/0038) -- and the same in-memory fallback for local
 * dev without DASHBOARD_DATABASE_URL set.
 */
import { Pool } from 'pg';
import type pino from 'pino';

export type SecretFindingOccurrenceInput = {
  file: string;
  startLine?: number;
  commit?: string;
  author?: string;
  date?: string;
  presentAtHead: boolean;
};

/** A secret pasted into multiple files (e.g. an env file and the incident doc describing it, per
 *  ISSUE-049) is one finding with multiple occurrences -- stored as one snapshot row per
 *  occurrence, all sharing the finding's fingerprint, so no location silently gets dropped. */
export type SecretFindingInput = {
  fingerprint: string;
  maskedSecret: string;
  ruleId: string;
  description: string;
  sources: string[];
  verified: boolean | null;
  occurrences: SecretFindingOccurrenceInput[];
};

export type SecretScanRunRecord = {
  id: number;
  environment: string;
  statusCommitSha: string;
  generatedAt: string;
  status: string;
  gitleaksAvailable: boolean;
  trufflehogAvailable: boolean;
  aggregate: { critical: number; high: number; moderate: number; low: number; info: number };
  recordedAt: string;
};

export type SecretFindingHistoryEntry = {
  runId: number;
  generatedAt: string;
  statusCommitSha: string;
  presentAtHead: boolean;
  verified: boolean | null;
};

export interface SecretScanHistoryStore {
  hasRun(environment: string, statusCommitSha: string): Promise<boolean>;
  recordRun(input: {
    environment: string;
    statusCommitSha: string;
    generatedAt: string;
    status: string;
    gitleaksAvailable: boolean;
    trufflehogAvailable: boolean;
    findings: SecretFindingInput[];
  }): Promise<void>;
  listRuns(environment: string, limit?: number): Promise<SecretScanRunRecord[]>;
  findingHistory(fingerprint: string, limit?: number): Promise<SecretFindingHistoryEntry[]>;
  close(): Promise<void>;
}

/** One count per logical finding (fingerprint), not per occurrence-row -- a secret pasted into 3
 *  files must not inflate the severity aggregate 3x. */
const severityCounts = (findings: SecretFindingInput[]) => {
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  for (const finding of findings) {
    if (finding.verified === true) counts.critical += 1;
    else if (finding.occurrences.some((occurrence) => occurrence.presentAtHead)) counts.high += 1;
    else counts.moderate += 1;
  }
  return counts;
};

const createPostgresSecretScanHistoryStore = (connectionString: string): SecretScanHistoryStore => {
  const pool = new Pool({ connectionString, max: 5 });

  return {
    async hasRun(environment, statusCommitSha) {
      const result = await pool.query(
        `SELECT 1 FROM dashboard_secret_scan_run WHERE environment = $1 AND status_commit_sha = $2`,
        [environment, statusCommitSha],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async recordRun({ environment, statusCommitSha, generatedAt, status, gitleaksAvailable, trufflehogAvailable, findings }) {
      const counts = severityCounts(findings);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const runResult = await client.query<{ id: string }>(
          `INSERT INTO dashboard_secret_scan_run
             (environment, status_commit_sha, generated_at, status, gitleaks_available,
              trufflehog_available, critical_count, high_count, moderate_count, low_count, info_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (environment, status_commit_sha) DO NOTHING
           RETURNING id`,
          [
            environment,
            statusCommitSha,
            generatedAt,
            status,
            gitleaksAvailable,
            trufflehogAvailable,
            counts.critical,
            counts.high,
            counts.moderate,
            counts.low,
            counts.info,
          ],
        );

        const runId = runResult.rows[0]?.id;
        if (!runId) {
          // Another concurrent sync already recorded this exact commit -- nothing left to do.
          await client.query('ROLLBACK');
          return;
        }

        for (const finding of findings) {
          for (const occurrence of finding.occurrences) {
            await client.query(
              `INSERT INTO dashboard_secret_finding_snapshot
                 (scan_run_id, fingerprint, masked_secret, rule_id, description, file, start_line,
                  commit_sha, author, secret_committed_at, present_at_head, sources, verified)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [
                runId,
                finding.fingerprint,
                finding.maskedSecret,
                finding.ruleId,
                finding.description,
                occurrence.file,
                occurrence.startLine ?? null,
                occurrence.commit ?? null,
                occurrence.author ?? null,
                occurrence.date ?? null,
                occurrence.presentAtHead,
                finding.sources,
                finding.verified,
              ],
            );
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async listRuns(environment, limit = 30) {
      const result = await pool.query<{
        id: string;
        environment: string;
        status_commit_sha: string;
        generated_at: Date;
        status: string;
        gitleaks_available: boolean;
        trufflehog_available: boolean;
        critical_count: number;
        high_count: number;
        moderate_count: number;
        low_count: number;
        info_count: number;
        recorded_at: Date;
      }>(
        `SELECT id, environment, status_commit_sha, generated_at, status, gitleaks_available,
                trufflehog_available, critical_count, high_count, moderate_count, low_count,
                info_count, recorded_at
         FROM dashboard_secret_scan_run
         WHERE environment = $1
         ORDER BY generated_at DESC, id DESC
         LIMIT $2`,
        [environment, limit],
      );
      return result.rows.map((row) => ({
        id: Number(row.id),
        environment: row.environment,
        statusCommitSha: row.status_commit_sha,
        generatedAt: row.generated_at.toISOString(),
        status: row.status,
        gitleaksAvailable: row.gitleaks_available,
        trufflehogAvailable: row.trufflehog_available,
        aggregate: {
          critical: row.critical_count,
          high: row.high_count,
          moderate: row.moderate_count,
          low: row.low_count,
          info: row.info_count,
        },
        recordedAt: row.recorded_at.toISOString(),
      }));
    },

    async findingHistory(fingerprint, limit = 30) {
      // A finding can have multiple occurrence rows per run (same secret, several files) --
      // grouped down to one row per run here. bool_or is safe for `verified` specifically because
      // every occurrence row for a given (run, fingerprint) is written with the same verified
      // value (it's a property of the secret, not of any one occurrence) -- see recordRun.
      const result = await pool.query<{
        run_id: string;
        generated_at: Date;
        status_commit_sha: string;
        present_at_head: boolean;
        verified: boolean | null;
      }>(
        `SELECT run.id AS run_id, run.generated_at, run.status_commit_sha,
                bool_or(snap.present_at_head) AS present_at_head, bool_or(snap.verified) AS verified
         FROM dashboard_secret_finding_snapshot snap
         INNER JOIN dashboard_secret_scan_run run ON run.id = snap.scan_run_id
         WHERE snap.fingerprint = $1
         GROUP BY run.id, run.generated_at, run.status_commit_sha
         ORDER BY run.generated_at DESC, run.id DESC
         LIMIT $2`,
        [fingerprint, limit],
      );
      return result.rows.map((row) => ({
        runId: Number(row.run_id),
        generatedAt: row.generated_at.toISOString(),
        statusCommitSha: row.status_commit_sha,
        presentAtHead: row.present_at_head,
        verified: row.verified,
      }));
    },

    async close() {
      await pool.end();
    },
  };
};

const createInMemorySecretScanHistoryStore = (): SecretScanHistoryStore => {
  const runs: Array<SecretScanRunRecord & { findings: SecretFindingInput[] }> = [];
  let nextId = 1;

  return {
    hasRun(environment, statusCommitSha) {
      return Promise.resolve(
        runs.some((run) => run.environment === environment && run.statusCommitSha === statusCommitSha),
      );
    },
    recordRun({ environment, statusCommitSha, generatedAt, status, gitleaksAvailable, trufflehogAvailable, findings }) {
      if (runs.some((run) => run.environment === environment && run.statusCommitSha === statusCommitSha)) {
        return Promise.resolve();
      }
      runs.push({
        id: nextId++,
        environment,
        statusCommitSha,
        generatedAt,
        status,
        gitleaksAvailable,
        trufflehogAvailable,
        aggregate: severityCounts(findings),
        recordedAt: new Date().toISOString(),
        findings,
      });
      return Promise.resolve();
    },
    listRuns(environment, limit = 30) {
      return Promise.resolve(
        runs
          .filter((run) => run.environment === environment)
          .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || b.id - a.id)
          .slice(0, limit)
          .map(({ findings: _findings, ...run }) => run),
      );
    },
    findingHistory(fingerprint, limit = 30) {
      return Promise.resolve(
        runs
          .filter((run) => run.findings.some((finding) => finding.fingerprint === fingerprint))
          .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || b.id - a.id)
          .slice(0, limit)
          .map((run) => {
            const finding = run.findings.find((item) => item.fingerprint === fingerprint);
            return {
              runId: run.id,
              generatedAt: run.generatedAt,
              statusCommitSha: run.statusCommitSha,
              presentAtHead: finding?.occurrences.some((occurrence) => occurrence.presentAtHead) ?? false,
              verified: finding?.verified ?? null,
            };
          }),
      );
    },
    close() {
      return Promise.resolve();
    },
  };
};

export const createSecretScanHistoryStore = (logger?: pino.Logger): SecretScanHistoryStore => {
  const connectionString = process.env.DASHBOARD_DATABASE_URL?.trim();
  if (connectionString) {
    return createPostgresSecretScanHistoryStore(connectionString);
  }

  logger?.warn(
    { action: 'dashboard.secret_scan_history_store.in_memory' },
    'DASHBOARD_DATABASE_URL not set; secret-scan history is in-memory only and will be lost on restart.',
  );
  return createInMemorySecretScanHistoryStore();
};
