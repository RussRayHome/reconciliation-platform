/**
 * Merges N sharded e2e job artifacts (each its own meta.json + e2e-results.json, written by
 * run-check.ts / Playwright's JSON reporter) into the single .ci-artifacts/e2e/ layout
 * aggregate-dashboard-status.ts already expects -- keeps that script shard-count-agnostic.
 * parsePlaywrightJsonSpecs only reads the top-level `suites` array, so merging is just
 * concatenating each shard's `suites` into one.
 *
 * Usage: tsx scripts/ci/merge-e2e-shards.ts --artifacts .ci-artifacts --shards 4 --out .ci-artifacts/e2e
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
const shardCount = Number.parseInt(readFlag('shards', '4'), 10);
const outDir = resolve(repoRoot, readFlag('out', '.ci-artifacts/e2e'));

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
let missingShards = 0;

for (let shard = 1; shard <= shardCount; shard += 1) {
  const shardDir = join(artifactsDir, `e2e-${shard}`);
  const meta = readJson<CheckMeta>(join(shardDir, 'meta.json'));
  if (!meta) {
    missingShards += 1;
    continue;
  }
  metas.push(meta);

  const results = readJson<{ suites?: unknown[] }>(join(shardDir, 'e2e-results.json'));
  if (results?.suites) {
    suites.push(...results.suites);
  }
}

// A missing shard (its job never reached the upload step, e.g. killed by its own timeout) is a
// failure, same as readCheckMeta's handling of a missing meta.json for the other 7 checks --
// partial shard data still beats crashing the whole aggregate step.
const mergedMeta: CheckMeta = {
  name: 'E2E tests',
  command: `npm run test:e2e (sharded x${shardCount})`,
  exitCode: missingShards > 0 || metas.some((m) => !m.ok) ? 1 : 0,
  ok: missingShards === 0 && metas.length === shardCount && metas.every((m) => m.ok),
  durationMs: metas.reduce((sum, m) => sum + m.durationMs, 0),
};

writeFileSync(join(outDir, 'meta.json'), JSON.stringify(mergedMeta, null, 2), 'utf8');
writeFileSync(join(outDir, 'e2e-results.json'), JSON.stringify({ suites }, null, 2), 'utf8');

console.log(
  `[merge-e2e-shards] merged ${metas.length}/${shardCount} shard(s) (${missingShards} missing), ok=${mergedMeta.ok}, suites=${suites.length}`,
);
