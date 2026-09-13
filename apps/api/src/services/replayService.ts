import { createHash, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import type { MatchingConfigVersion, SourceFile } from '@recon/domain';
import {
  listMatchingConfigVersions,
  listNormalizedTransactionsForRun,
} from '@recon/persistence';

import { executeReconciliationFromNormalized } from './reconciliationService';

/**
 * What a DRAFT matching-config version would have produced against one already-closed period
 * (ADR-0018, Issue #531).
 *
 * Every delta is **draft minus active**: "12 fewer exceptions" is `-12`.
 */
export interface ReplayDeltas {
  exceptionsDelta: number;
  probableMatchesDelta: number;
  /** Signed amount, as a string. Money an approver signs against never becomes a JS number. */
  unresolvedExposureDelta: string;
  engineBuild: string;
  draftOverridesFingerprint: string;
}

/**
 * Raised when a replay cannot be computed at all, as distinct from computing to no difference.
 *
 * The distinction is the point: three zeros read as "this change does nothing", so a period with
 * nothing to replay against has to say so in its own words rather than borrow that shape.
 */
export class ReplayNotPossibleError extends Error {
  /**
   * @param message Operator-facing reason, shown rather than logged.
   * @param reason Which case this is, so a caller can distinguish a missing draft from a period
   * with no retained rows without parsing the message.
   */
  constructor(
    message: string,
    readonly reason: 'no-draft' | 'no-records',
  ) {
    super(message);
    this.name = 'ReplayNotPossibleError';
  }
}

/**
 * Identifies the build both sides of a diff ran in.
 *
 * Not decoration. ADR-0018 decision 1 requires both executions to happen in the same build, and
 * this is what lets a later reader tell whether two stored estimates are comparable with each
 * other. Falls back to a dev marker rather than throwing: an estimate computed on a developer's
 * machine is still a correct estimate, it is just not comparable with a deployed one, and saying so
 * is better than refusing to compute.
 */
export const engineBuildIdentifier = (): string =>
  process.env.APP_BUILD_SHA ?? process.env.GIT_COMMIT ?? 'dev';

/**
 * A stable digest of the overrides an estimate was computed FROM.
 *
 * A draft is one mutable row, so its overrides can change after an estimate was stored. The
 * fingerprint travels with the estimate so a reader compares rather than trusts. Keys are sorted so
 * the same overrides always produce the same digest regardless of insertion order -- otherwise an
 * estimate would appear stale purely because an object was rebuilt.
 */
export const fingerprintOverrides = (overrides: Record<string, number>): string => {
  const canonical = Object.keys(overrides)
    .sort()
    .map((key) => `${key}=${overrides[key]}`)
    .join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
};

/** Placeholder source files. The engine wants the shape; a replay parses nothing. */
const replaySourceFiles = (): SourceFile[] => [];

const unresolvedExposureOf = (summary: { unresolvedExposure: number }): number =>
  summary.unresolvedExposure;

/**
 * Executes the engine twice against one closed period and reports the difference.
 *
 * **Both sides run here, in this build, against the same rows.** The obvious implementation --
 * replay the draft and diff against what the closed run actually stored -- conflates two different
 * changes: the proposed rule, and every engine change shipped since that period ran. A matching fix
 * from last month would then surface as an effect of the proposed tolerance. Running the ACTIVE
 * overrides through the same code path removes that variable, which is the whole reason the numbers
 * can be trusted.
 *
 * **Nothing is written.** `lifecycleStore`, `openItemStore` and `reconciliationRunId` are all
 * optional inputs to `executeReconciliationFromNormalized`, and a replay omits all three -- so
 * there is no store for the engine to write through. `rawRows` is empty for the same reason: its
 * only consumer is `lifecycleStore.persistParsedRows`, which cannot run. The guarantee is
 * structural rather than a rule someone has to remember.
 */
export const computeReplayEstimate = async (input: {
  pool: Pool;
  organizationId: string;
  draftVersionId: string;
  replayedRunId: string;
  correlationId?: string;
}): Promise<ReplayDeltas> => {
  const versions = await listMatchingConfigVersions(input.pool, input.organizationId);
  const draft = versions.find((version) => version.id === input.draftVersionId);
  if (!draft) {
    throw new ReplayNotPossibleError(
      'That matching-config version does not exist for this organization.',
      'no-draft',
    );
  }

  const active: MatchingConfigVersion | undefined = versions.find(
    (version) => version.status === 'ACTIVE',
  );
  // An organization with no ACTIVE version is running engine defaults, which is the correct
  // baseline to compare against -- an empty override set, not a refusal.
  const activeOverrides = active?.varianceOverrides ?? {};
  const draftOverrides = draft.varianceOverrides ?? {};

  const normalizedTransactions = await listNormalizedTransactionsForRun(
    input.pool,
    input.organizationId,
    input.replayedRunId,
  );
  if (normalizedTransactions.length === 0) {
    // Distinct from "no difference". A period with no retained rows cannot be replayed at all, and
    // reporting three zeros for it would read as "this change does nothing" -- the same
    // absent-versus-zero rule the rail badges follow.
    throw new ReplayNotPossibleError(
      'That period has no retained transactions to replay against.',
      'no-records',
    );
  }

  const runOnce = async (varianceOverrides: Record<string, number>) =>
    executeReconciliationFromNormalized({
      correlationId: input.correlationId ?? randomUUID(),
      // A synthetic id: this run is never persisted, and reusing the replayed period's id would
      // risk a future writer keying something to it.
      runId: randomUUID(),
      organizationId: input.organizationId,
      sourceFiles: replaySourceFiles(),
      rawRows: [],
      normalizedTransactions,
      varianceOverrides,
    });

  const [activeRun, draftRun] = [await runOnce(activeOverrides), await runOnce(draftOverrides)];

  const exposureDelta =
    unresolvedExposureOf(draftRun.summary) - unresolvedExposureOf(activeRun.summary);

  return {
    exceptionsDelta: draftRun.exceptions.length - activeRun.exceptions.length,
    probableMatchesDelta: draftRun.summary.probableMatches - activeRun.summary.probableMatches,
    // Fixed to four places to match the column's NUMERIC(20,4). toFixed rather than String(): the
    // engine's summary is a JS number, so this is the one place the value is narrowed, and it
    // should narrow to exactly what the column stores rather than to whatever float text happens
    // to render.
    unresolvedExposureDelta: exposureDelta.toFixed(4),
    engineBuild: engineBuildIdentifier(),
    draftOverridesFingerprint: fingerprintOverrides(draftOverrides),
  };
};
