import { describe, expect, it } from 'vitest';

/**
 * Issue #209: several unrelated integration tests (auth-endpoints, cors, session-logging,
 * reconciliation, mapping-endpoints) intermittently fail only when the full suite runs, always
 * pass in isolation. None of them share application logic or talk to a real Redis -- the working
 * hypothesis is general event-loop/scheduler starvation from many parallel Vitest fork workers
 * each running a full Express app, not an app-level race condition.
 *
 * This test carries zero application logic on purpose -- it only measures how late a trivial,
 * already-queued macrotask actually runs. If elapsed times spike specifically during full-suite
 * runs (compare against isolated runs of this same file), that's direct evidence of scheduler
 * starvation independent of anything the app does, which would rule out an app-level race as the
 * cause of the other tests' flakes. Logs every measurement (not just failures) so the full
 * distribution across a run is visible, not just a pass/fail verdict.
 */
describe('event-loop starvation canary (issue #209 diagnostic)', () => {
  it('a bare setTimeout(0) resolves within a small threshold', async () => {
    const start = process.hrtime.bigint();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    console.log(`[canary] setTimeout(0) elapsed: ${elapsedMs.toFixed(2)}ms`);

    // Generous on purpose: this isn't asserting the app is fast, it's asserting the process
    // wasn't so starved that a bare timer queued for "as soon as possible" took a meaningfully
    // long time to actually fire. A failure here is itself the diagnostic signal.
    expect(elapsedMs).toBeLessThan(200);
  });

  it('ten consecutive setImmediate hops complete within a small threshold', async () => {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 10; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    console.log(`[canary] 10x setImmediate elapsed: ${elapsedMs.toFixed(2)}ms`);

    expect(elapsedMs).toBeLessThan(200);
  });
});
