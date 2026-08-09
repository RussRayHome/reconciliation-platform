/**
 * Merges N e2e job artifacts (each its own meta.json + e2e-results.json, written by
 * run-check.ts / Playwright's JSON reporter) into the single .ci-artifacts/e2e/ layout
 * aggregate-dashboard-status.ts already expects, so that script stays lane/shard-agnostic.
 * parsePlaywrightJsonSpecs only reads the top-level `suites` array, so merging is just
 * concatenating each input's `suites` into one.
 *
 * Takes an explicit, comma-separated list of artifact directory names via --dirs rather than
 * assuming a uniform e2e-{1..N} naming scheme -- the functional and visual lanes shard
 * differently (functional: e2e-functional-1..4; visual: a single unsharded e2e-visual), so there
 * is no one numeric range that covers both.
 *
 * Usage:
 *   tsx scripts/ci/merge-e2e-shards.ts --artifacts .ci-artifacts \
 *     --dirs e2e-functional-1,e2e-functional-2,e2e-functional-3,e2e-functional-4,e2e-visual \
 *     --out .ci-artifacts/e2e
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const args = process.argv.slice(2);
const readFlag = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? (args[index + 1] as string) : fallback;
};

const artifactsDir = resolve(repoRoot, readFlag('artifacts', '.ci-artifacts'));
const dirNames = readFlag('dirs', '')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name.length > 0);
const outDir = resolve(repoRoot, readFlag('out', '.ci-artifacts/e2e'));

if (dirNames.length === 0) {
  console.error('Missing required --dirs (comma-separated artifact directory names)');
  process.exit(2);
}

type CheckMeta = { name: string; command: string; exitCode: number; ok: boolean; durationMs: number };

const readJson = <T,>(path: string): T | null => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

mkdirSync(outDir, { recursive: true });

const metas: CheckMeta[] = [];
const suites: unknown[] = [];
let missingDirs = 0;

for (const dirName of dirNames) {
  const shardDir = join(artifactsDir, dirName);
  const meta = readJson<CheckMeta>(join(shardDir, 'meta.json'));
  if (!meta) {
    missingDirs += 1;
    continue;
  }
  metas.push(meta);

  const results = readJson<{ suites?: unknown[] }>(join(shardDir, 'e2e-results.json'));
  if (results?.suites) {
    suites.push(...results.suites);
  }
}

// A missing dir (its job never reached the upload step, e.g. killed by its own timeout) is a
// failure, same as readCheckMeta's handling of a missing meta.json for the other 7 checks --
// partial shard data still beats crashing the whole aggregate step.
const mergedMeta: CheckMeta = {
  name: 'E2E tests',
  command: `npm run test:e2e:functional / test:e2e:visual:container (merged x${dirNames.length})`,
  exitCode: missingDirs > 0 || metas.some((m) => !m.ok) ? 1 : 0,
  ok: missingDirs === 0 && metas.length === dirNames.length && metas.every((m) => m.ok),
  durationMs: metas.reduce((sum, m) => sum + m.durationMs, 0),
};

writeFileSync(join(outDir, 'meta.json'), JSON.stringify(mergedMeta, null, 2), 'utf8');
writeFileSync(join(outDir, 'e2e-results.json'), JSON.stringify({ suites }, null, 2), 'utf8');

console.log(
  `[merge-e2e-shards] merged ${metas.length}/${dirNames.length} dir(s) (${missingDirs} missing), ok=${mergedMeta.ok}, suites=${suites.length}`,
);
