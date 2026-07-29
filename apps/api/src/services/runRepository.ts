import type { OutputWorkbook, ReconciliationRun, ReviewerDecision } from '@recon/domain';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Storage abstraction for reconciliation runs and reviewer decisions, implemented by in-memory and file-backed variants. */
export interface RunRepository {
  save(run: ReconciliationRun): ReconciliationRun;
  findById(id: string): ReconciliationRun | undefined;
  findLatest(): ReconciliationRun | undefined;
  saveReviewerDecision(runId: string, decision: ReviewerDecision): ReviewerDecision;
  deleteReviewerDecision(
    runId: string,
    targetType: ReviewerDecision['targetType'],
    targetId: string,
  ): boolean;
  listReviewerDecisions(runId: string): ReviewerDecision[];
}

type PersistedOutputWorkbook = Omit<OutputWorkbook, 'binary'> & {
  binaryBase64: string;
};

type PersistedReconciliationRun = Omit<
  ReconciliationRun,
  'rawRows' | 'normalizedTransactions' | 'matchResults' | 'auditEvents' | 'outputWorkbook'
> & {
  outputWorkbook?: PersistedOutputWorkbook;
};

type RunRepositorySnapshot = {
  version: 1 | 2;
  latestRun: PersistedReconciliationRun | null;
};

const normalizeRun = (run: ReconciliationRun): ReconciliationRun => ({
  ...run,
  groupedMatchResults: run.groupedMatchResults ?? [],
  reviewerDecisions: run.reviewerDecisions ?? [],
});

const serializeRun = (run: ReconciliationRun): PersistedReconciliationRun => ({
  id: run.id,
  correlationId: run.correlationId,
  accountIdentifier: run.accountIdentifier,
  periodLabel: run.periodLabel,
  reconciliationFrequency: run.reconciliationFrequency,
  status: run.status,
  startedAt: run.startedAt,
  completedAt: run.completedAt,
  sourceFiles: run.sourceFiles,
  groupedMatchResults: run.groupedMatchResults ?? [],
  probableMatches: run.probableMatches,
  exceptions: run.exceptions,
  summary: run.summary,
  reviewerObservations: run.reviewerObservations,
  reviewerDecisions: run.reviewerDecisions ?? [],
  outputWorkbook: run.outputWorkbook
    ? {
        fileName: run.outputWorkbook.fileName,
        generatedAt: run.outputWorkbook.generatedAt,
        tabNames: run.outputWorkbook.tabNames,
        binaryBase64: Buffer.from(run.outputWorkbook.binary).toString('base64'),
      }
    : undefined,
});

const deserializeRun = (run: PersistedReconciliationRun): ReconciliationRun =>
  normalizeRun({
    ...run,
    rawRows: [],
    normalizedTransactions: [],
    matchResults: [],
    auditEvents: [],
    outputWorkbook: run.outputWorkbook
      ? {
          fileName: run.outputWorkbook.fileName,
          generatedAt: run.outputWorkbook.generatedAt,
          tabNames: run.outputWorkbook.tabNames,
          binary: Uint8Array.from(Buffer.from(run.outputWorkbook.binaryBase64, 'base64')),
        }
      : undefined,
  });

/**
 * Stores completed reconciliation runs in process memory for local development
 * and short-lived diagnostic workflows.
 *
 * This repository is intentionally simple and non-durable. It provides a narrow
 * seam that can be replaced later with a persistent implementation.
 */
export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, ReconciliationRun>();
  private latestRunId: string | undefined;

  /**
   * Persists a reconciliation run in memory under its run identifier.
   *
   * @param run Fully populated reconciliation run payload.
   * @returns The same run object after it has been stored.
   */
  save(run: ReconciliationRun): ReconciliationRun {
    const normalizedRun = normalizeRun(run);
    this.runs.set(normalizedRun.id, normalizedRun);
    this.latestRunId = normalizedRun.id;
    return normalizedRun;
  }

  /**
   * Looks up a previously stored reconciliation run by identifier.
   *
   * @param id Reconciliation run identifier.
   * @returns The stored run when found; otherwise `undefined`.
   */
  findById(id: string): ReconciliationRun | undefined {
    return this.runs.get(id);
  }

  /**
   * Returns the most recently saved reconciliation run.
   *
   * @returns The latest stored run when present; otherwise `undefined`.
   */
  findLatest(): ReconciliationRun | undefined {
    if (!this.latestRunId) {
      return undefined;
    }

    return this.runs.get(this.latestRunId);
  }

  /**
   * Upserts a reviewer decision for a run and returns the persisted decision payload.
   * Existing decisions for the same target are replaced while preserving original identity fields.
   */
  saveReviewerDecision(runId: string, decision: ReviewerDecision): ReviewerDecision {
    const run = this.findById(runId);

    if (!run) {
      throw new Error(`Reconciliation run not found: ${runId}`);
    }

    const existingDecision = run.reviewerDecisions.find(
      (item) => item.targetType === decision.targetType && item.targetId === decision.targetId,
    );
    const nextDecision = existingDecision
      ? {
          ...decision,
          id: existingDecision.id,
          createdAt: existingDecision.createdAt,
        }
      : decision;

    const nextRun: ReconciliationRun = {
      ...run,
      reviewerDecisions: [
        ...run.reviewerDecisions.filter(
          (item) =>
            !(
              item.targetType === nextDecision.targetType && item.targetId === nextDecision.targetId
            ),
        ),
        nextDecision,
      ],
    };

    this.save(nextRun);
    return nextDecision;
  }

  /**
   * Lists reviewer decisions for a run, or an empty array when the run is not found.
   */
  listReviewerDecisions(runId: string): ReviewerDecision[] {
    return this.findById(runId)?.reviewerDecisions ?? [];
  }

  /**
   * Removes the reviewer decision for a run/target, returning `true` when one was removed.
   * Clearing a decision returns the target to an undecided state (idempotent).
   */
  deleteReviewerDecision(
    runId: string,
    targetType: ReviewerDecision['targetType'],
    targetId: string,
  ): boolean {
    const run = this.findById(runId);

    if (!run) {
      throw new Error(`Reconciliation run not found: ${runId}`);
    }

    const remaining = run.reviewerDecisions.filter(
      (item) => !(item.targetType === targetType && item.targetId === targetId),
    );

    if (remaining.length === run.reviewerDecisions.length) {
      return false;
    }

    this.save({ ...run, reviewerDecisions: remaining });
    return true;
  }
}

/**
 * Stores reconciliation runs in memory while also persisting the latest
 * completed run to disk so it survives API restarts.
 */
export class FileBackedRunRepository extends InMemoryRunRepository {
  private hydrated = false;

  /**
   * Creates a file-backed repository that persists the latest run snapshot to disk.
   *
   * @param filePath Absolute or repository-relative path to the snapshot JSON file.
   */
  constructor(private readonly filePath: string) {
    super();
  }

  override save(run: ReconciliationRun): ReconciliationRun {
    this.hydrateFromDisk();
    const savedRun = super.save(run);
    this.persistLatestRun(savedRun);
    return savedRun;
  }

  override findById(id: string): ReconciliationRun | undefined {
    this.hydrateFromDisk();
    return super.findById(id);
  }

  override findLatest(): ReconciliationRun | undefined {
    this.hydrateFromDisk();
    return super.findLatest();
  }

  private hydrateFromDisk(): void {
    if (this.hydrated) {
      return;
    }

    this.hydrated = true;

    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const rawSnapshot = readFileSync(this.filePath, 'utf8');
      const snapshot = JSON.parse(rawSnapshot) as RunRepositorySnapshot;

      if (!snapshot.latestRun) {
        return;
      }

      super.save(deserializeRun(snapshot.latestRun));
    } catch {
      // Ignore corrupt or missing snapshots and fall back to a clean repository.
    }
  }

  private persistLatestRun(run: ReconciliationRun): void {
    const directoryPath = path.dirname(this.filePath);
    mkdirSync(directoryPath, { recursive: true });

    const snapshot: RunRepositorySnapshot = {
      version: 2,
      latestRun: serializeRun(run),
    };

    writeFileSync(this.filePath, JSON.stringify(snapshot), 'utf8');
  }
}
