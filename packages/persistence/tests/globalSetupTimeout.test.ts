import { describe, expect, it } from 'vitest';

import { BRING_UP_TIMEOUT_MS, bringUpTimeoutMessage, withBringUpTimeout } from './globalSetup';

/**
 * Issue #285. The guard these cover exists because three separate things on the testcontainers
 * path are unbounded (vitest does not time out `globalSetup`; the reaper's file lock retries
 * forever; ryuk's container start has no startup timeout). Removing the guard would restore an
 * indefinite silent hang, so these pin both halves of it: that it fires, and that it does not
 * fire on a healthy bring-up.
 */
describe('withBringUpTimeout (issue #285)', () => {
  it('rejects once the bound elapses, instead of waiting forever', async () => {
    const neverSettles = new Promise<never>(() => {});
    await expect(withBringUpTimeout(neverSettles, 10)).rejects.toThrow(
      /did not complete within 10 ms/,
    );
  });

  it('passes through a value that arrives inside the bound', async () => {
    await expect(withBringUpTimeout(Promise.resolve('container'), 10_000)).resolves.toBe(
      'container',
    );
  });

  it('propagates the original failure rather than masking it as a timeout', async () => {
    const boom = Promise.reject(new Error('docker daemon refused the connection'));
    await expect(withBringUpTimeout(boom, 10_000)).rejects.toThrow(
      'docker daemon refused the connection',
    );
  });

  it('does not leave a pending timer behind on the success path', async () => {
    // A timer left armed would keep the event loop alive past the run. Resolving well inside a
    // long bound and returning promptly is what proves the `finally` clear happened -- without it
    // this assertion still passes but the suite would hang on teardown for the full bound.
    const started = Date.now();
    await withBringUpTimeout(Promise.resolve(1), 60_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('stops a container that finishes starting after the bound, instead of leaking it', async () => {
    // Losing the race does not cancel `.start()`. Docker finishes creating the container a moment
    // later and nothing is holding it -- verified live: forcing the bound to 1 ms left a running
    // postgres:16.14 behind until this callback existed.
    let stopped: string | undefined;
    const arrivesLate = new Promise<{ id: string; stop: () => Promise<void> }>((resolve) => {
      setTimeout(() => {
        resolve({
          id: 'late',
          stop: () => {
            stopped = 'late';
            return Promise.resolve();
          },
        });
      }, 30);
    });

    await expect(withBringUpTimeout(arrivesLate, 5, (late) => late.stop())).rejects.toThrow(
      /did not complete within 5 ms/,
    );
    expect(stopped).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(stopped).toBe('late');
  });

  it('does not raise an unhandled rejection when the work fails after the bound', async () => {
    const failsLate = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('docker start failed, too late to matter')), 30);
    });

    await expect(withBringUpTimeout(failsLate, 5)).rejects.toThrow(/did not complete within 5 ms/);
    // If the late rejection were unhandled, node would surface it during this settle window.
    await new Promise((resolve) => setTimeout(resolve, 80));
  });

  it('tells the operator how to recover and how to skip Docker entirely', () => {
    const message = bringUpTimeoutMessage(1234);
    expect(message).toContain('1234 ms');
    expect(message).toContain('testcontainers-ryuk');
    expect(message).toContain('docker rm -f');
    expect(message).toContain('npm run coverage:docker-fallback');
    expect(message).toContain('RECON_TESTCONTAINERS_TIMEOUT_MS');
  });

  it('defaults to a bound far above a healthy bring-up but far below forever', () => {
    // A clean run measured 326 s end to end for the whole coverage suite; bring-up alone is a
    // small fraction of that. 300 s leaves generous headroom while still failing in bounded time.
    expect(BRING_UP_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(BRING_UP_TIMEOUT_MS).toBeLessThanOrEqual(600_000);
  });
});
