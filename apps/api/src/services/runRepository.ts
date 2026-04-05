import type { OutputWorkbook, ReconciliationRun } from '@recon/domain';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface RunRepository {
  save(run: ReconciliationRun): ReconciliationRun;
  findById(id: string): ReconciliationRun | undefined;
  findLatest(): ReconciliationRun | undefined;
}

type PersistedOutputWorkbook = Omit<OutputWorkbook, 'binary'> & {
  binaryBase64: string;
};

type PersistedReconciliationRun = Omit<ReconciliationRun, 'outputWorkbook'> & {
  outputWorkbook?: PersistedOutputWorkbook;
};

type RunRepositorySnapshot = {
  version: 1;
  latestRun: PersistedReconciliationRun | null;
};

const serializeRun = (run: ReconciliationRun): PersistedReconciliationRun => ({
  ...run,
  outputWorkbook: run.outputWorkbook
    ? {
        fileName: run.outputWorkbook.fileName,
        generatedAt: run.outputWorkbook.generatedAt,
        tabNames: run.outputWorkbook.tabNames,
        binaryBase64: Buffer.from(run.outputWorkbook.binary).toString('base64'),
      }
    : undefined,
});

const deserializeRun = (run: PersistedReconciliationRun): ReconciliationRun => ({
  ...run,
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
    this.runs.set(run.id, run);
    this.latestRunId = run.id;
    return run;
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
}

/**
 * Stores reconciliation runs in memory while also persisting the latest
 * completed run to disk so it survives API restarts.
 */
export class FileBackedRunRepository extends InMemoryRunRepository {
  private hydrated = false;

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
      version: 1,
      latestRun: serializeRun(run),
    };

    writeFileSync(this.filePath, JSON.stringify(snapshot), 'utf8');
  }
}
