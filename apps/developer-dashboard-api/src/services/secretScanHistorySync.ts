/**
 * Backfills dashboard_secret_scan_run/dashboard_secret_finding_snapshot from status-data's own
 * commit history, rather than only ever snapshotting "whatever /api/status happens to return right
 * now." A dashboard nobody opens for a few days would otherwise silently lose those nights' scans
 * -- this walks the last N commits that touched dashboard-status/<env>.json and records any this
 * store doesn't have yet, so history is complete regardless of dashboard traffic.
 *
 * Safe to call on every real (cache-miss) status fetch: hasRun() makes each commit a cheap no-op
 * once it's already recorded, and the content fetch only happens for genuinely new commits.
 */
import type pino from 'pino';

import {
  type SecretFindingInput,
  type SecretFindingOccurrenceInput,
  type SecretScanHistoryStore,
} from './secretScanHistoryStore';
import { type StatusStoreConfig, fetchStatusAtRef, listRecentStatusCommits } from './statusStore';

const SECRET_INTEGRITY_CHECK_NAME = 'Secret integrity';
const DEFAULT_BACKFILL_COMMIT_LIMIT = 20;

type ParsedSecretCheck = {
  status: string;
  gitleaksAvailable: boolean;
  trufflehogAvailable: boolean;
  findings: SecretFindingInput[];
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const parseOccurrence = (value: unknown): SecretFindingOccurrenceInput | null => {
  const source = asRecord(value);
  const file = typeof source?.file === 'string' ? source.file : null;
  if (!file) return null;

  return {
    file,
    startLine: typeof source?.startLine === 'number' ? source.startLine : undefined,
    commit: typeof source?.commit === 'string' ? source.commit : undefined,
    author: typeof source?.author === 'string' ? source.author : undefined,
    date: typeof source?.date === 'string' ? source.date : undefined,
    presentAtHead: source?.presentAtHead === true,
  };
};

const parseFinding = (value: unknown): SecretFindingInput | null => {
  const source = asRecord(value);
  const fingerprint = typeof source?.fingerprint === 'string' ? source.fingerprint : null;
  if (!fingerprint) return null;

  const occurrences = Array.isArray(source?.occurrences)
    ? source.occurrences.map(parseOccurrence).filter((entry): entry is SecretFindingOccurrenceInput => entry !== null)
    : [];
  if (occurrences.length === 0) return null;

  return {
    fingerprint,
    maskedSecret: typeof source?.maskedSecret === 'string' ? source.maskedSecret : '********',
    ruleId: typeof source?.ruleId === 'string' ? source.ruleId : 'unknown-rule',
    description: typeof source?.description === 'string' ? source.description : 'Potential secret detected.',
    sources: Array.isArray(source?.sources) ? source.sources.filter((entry): entry is string => typeof entry === 'string') : [],
    verified: source?.verified === true ? true : source?.verified === false ? false : null,
    occurrences,
  };
};

/** Pulls the Secret integrity check + its findings out of a published status payload. Returns
 *  null if the payload predates this feature (no matching check) rather than throwing -- older
 *  commits on status-data are expected to look like this. */
const parseSecretCheck = (payload: unknown): { generatedAt: string; check: ParsedSecretCheck } | null => {
  const root = asRecord(payload);
  const generatedAt = typeof root?.generatedAt === 'string' ? root.generatedAt : null;
  const checks = Array.isArray(root?.checks) ? root.checks : null;
  if (!generatedAt || !checks) return null;

  const secretCheck = checks
    .map(asRecord)
    .find((check) => check?.name === SECRET_INTEGRITY_CHECK_NAME);
  if (!secretCheck) return null;

  const tools = asRecord(secretCheck.secretScanTools);
  const findings = Array.isArray(secretCheck.secretFindings)
    ? secretCheck.secretFindings.map(parseFinding).filter((finding): finding is SecretFindingInput => finding !== null)
    : [];

  return {
    generatedAt,
    check: {
      status: secretCheck.ok === true ? 'ok' : 'failed',
      gitleaksAvailable: tools?.gitleaks === true,
      trufflehogAvailable: tools?.trufflehog === true,
      findings,
    },
  };
};

export const syncSecretScanHistory = async (
  config: StatusStoreConfig,
  historyStore: SecretScanHistoryStore,
  logger?: pino.Logger,
  commitLimit = DEFAULT_BACKFILL_COMMIT_LIMIT,
): Promise<void> => {
  const commits = await listRecentStatusCommits(config, commitLimit);

  for (const commit of commits) {
    if (await historyStore.hasRun(config.env, commit.sha)) {
      continue;
    }

    try {
      const payload = await fetchStatusAtRef(config, commit.sha);
      const parsed = parseSecretCheck(payload);
      if (!parsed) {
        continue;
      }

      await historyStore.recordRun({
        environment: config.env,
        statusCommitSha: commit.sha,
        generatedAt: parsed.generatedAt,
        status: parsed.check.status,
        gitleaksAvailable: parsed.check.gitleaksAvailable,
        trufflehogAvailable: parsed.check.trufflehogAvailable,
        findings: parsed.check.findings,
      });
    } catch (error) {
      // One bad commit (rate limit, transient network error) shouldn't stop the rest of the
      // backfill -- the next sync call will retry this same commit since it's still unrecorded.
      logger?.warn(
        { action: 'dashboard.secret_scan_history_sync.commit_failed', sha: commit.sha, err: error },
        'Failed to sync one status-data commit into secret scan history',
      );
    }
  }
};
