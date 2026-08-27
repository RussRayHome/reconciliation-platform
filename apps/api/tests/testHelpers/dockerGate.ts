import { spawnSync } from 'node:child_process';
import { it } from 'vitest';

export const hasCommand = (command: string): boolean =>
  spawnSync('sh', ['-c', `command -v ${command} >/dev/null 2>&1`], { stdio: 'ignore' }).status ===
  0;

export const commandSucceeded = (command: string, timeout = 5000): boolean =>
  spawnSync('sh', ['-c', command], { stdio: 'ignore', timeout }).status === 0;

const skipDockerTestsAllowed = process.env.ALLOW_SKIP_DOCKER_TESTS === '1';

/**
 * Drift review finding #01: a Docker-gated test that silently skips when its prerequisite is
 * missing reports green in CI while validating nothing -- confirmed for real on
 * nginx-config.test.ts, whose required image is never pre-pulled there. This inverts the default:
 * a missing prerequisite is a loud failure unless ALLOW_SKIP_DOCKER_TESTS=1 is explicitly set
 * (never set in CI), so a developer without Docker locally can still opt out deliberately.
 *
 * Deliberately doesn't wrap `it` itself -- vitest's `it()` has several overloaded call signatures
 * (name+fn, name+options+fn, name+timeout+fn), and a generic wrapper that intercepts all of them
 * safely is more fragile than the problem it solves. Instead: `.test` is always a real `it` unless
 * explicitly allowed to skip, and `.assertAvailable` is a `beforeAll` that throws a clear error
 * before any test body runs -- a `beforeAll` failure marks every non-skipped test in that describe
 * as FAILED, not skipped, which is the actual behavior change this exists to make.
 */
export const dockerGate = (prerequisiteMet: boolean, missingDescription: string) => ({
  test: prerequisiteMet || !skipDockerTestsAllowed ? it : it.skip,
  assertAvailable: (): void => {
    if (!prerequisiteMet && !skipDockerTestsAllowed) {
      throw new Error(
        `${missingDescription} is required for this test file. Set ALLOW_SKIP_DOCKER_TESTS=1 ` +
          'to skip these tests deliberately (this variable must never be set in CI).',
      );
    }
  },
});
