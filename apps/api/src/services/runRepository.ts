import type { ReconciliationRun } from '@recon/domain';

export class InMemoryRunRepository {
  private readonly runs = new Map<string, ReconciliationRun>();

  save(run: ReconciliationRun): ReconciliationRun {
    this.runs.set(run.id, run);
    return run;
  }

  findById(id: string): ReconciliationRun | undefined {
    return this.runs.get(id);
  }
}
