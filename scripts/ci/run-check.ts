/**
 * Thin wrapper for one dashboard-status check job: runs a command with its output streamed live
 * (stdio: 'inherit' -- no custom buffering/piping, so GitHub Actions' own log shows progress in
 * real time), then writes a small meta.json with the timing/exit-code aggregate-dashboard-
 * status.ts needs but can't get from a raw test/lint/coverage report file alone.
 *
 * Deliberately has no timeout logic of its own -- each check now runs as its own GitHub Actions
 * job with its own `timeout-minutes`, which kills a hung command at the job level. That replaced
 * an earlier version of this whole pipeline that ran every check sequentially inside one script
 * with no per-check timeout: E2E hung with zero output for 35+ minutes on its first real run,
 * and killing the *whole* job at the 45-minute mark discarded the 7 other checks that had already
 * succeeded. One job per check means a hang only costs that one check's result, not everyone
 * else's.
 *
 * Usage:
 *   tsx scripts/ci/run-check.ts --name "Unit tests" --meta .ci-meta/unit.json -- \
 *     npm run test:unit -- --reporter=json --outputFile.json=artifacts/unit-results.json
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const rawArgs = process.argv.slice(2);
const separatorIndex = rawArgs.indexOf('--');
if (separatorIndex === -1) {
  console.error('Usage: tsx scripts/ci/run-check.ts --name <name> --meta <path> -- <command...>');
  process.exit(2);
}

const flagArgs = rawArgs.slice(0, separatorIndex);
const commandArgs = rawArgs.slice(separatorIndex + 1);

const readFlag = (flagName: string): string => {
  const index = flagArgs.indexOf(`--${flagName}`);
  const value = index !== -1 ? flagArgs[index + 1] : undefined;
  if (!value) {
    console.error(`Missing required --${flagName}`);
    process.exit(2);
  }
  return value;
};

const name = readFlag('name');
const metaPath = readFlag('meta');

if (commandArgs.length === 0) {
  console.error('No command given after --');
  process.exit(2);
}

const [command, ...args] = commandArgs;
const formattedCommand = [command, ...args].join(' ');

const started = Date.now();
const result = spawnSync(command as string, args, { stdio: 'inherit' });
const durationMs = Date.now() - started;
const exitCode = result.error ? 1 : (result.status ?? 1);

mkdirSync(dirname(metaPath), { recursive: true });
writeFileSync(
  metaPath,
  JSON.stringify({ name, command: formattedCommand, exitCode, ok: exitCode === 0, durationMs }, null, 2),
  'utf8',
);

if (result.error) {
  console.error(`[run-check] ${name}: failed to start -- ${result.error.message}`);
}
console.log(`[run-check] ${name}: exitCode=${exitCode} (${durationMs}ms)`);

process.exit(exitCode);
