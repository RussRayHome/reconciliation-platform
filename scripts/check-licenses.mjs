/* global process, console */

/**
 * License-inventory scanner for the production dependency tree (ISSUE-036).
 *
 * Reads package-lock.json's own `packages` map directly rather than running `npm ls --all
 * --omit=dev --json --long` against the live install. npm ls reflects whatever actually got
 * installed on the *current* machine, and that's platform-dependent: this repo has 6 real
 * production optional native builds (@msgpackr-extract/msgpackr-extract-{darwin,linux,win32}-*),
 * and npm only resolves the one matching the host OS -- so the generated report differed between
 * a local macOS run and Linux CI even with an identical lockfile and zero real dependency
 * changes (surfaced 2026-08-09: docs/dependency-licenses.generated.json kept failing CI's
 * `--check` after a clean, verified-correct macOS regeneration). package-lock.json's own
 * `packages` entries already carry `license`, `optional`, and `os`/`cpu` -- everything needed to
 * both build the report and exclude host-specific optional builds -- deterministically, the same
 * on every platform. (license-checker-rseidelsohn was tried first and reliably failed with "No
 * packages found in this path..." once installed as a local devDependency in this workspace
 * layout -- a legacy `read-installed-packages` incompatibility, not a config mistake; not worth
 * carrying a dependency that doesn't work.)
 *
 * "Production" mirrors `npm ls --omit=dev`: excludes entries marked `dev: true` in the lockfile
 * (dev-only tooling -- Playwright, ESLint, tsx, etc. -- never ships in a built image) and, new
 * here, excludes `optional: true` entries restricted to a specific `os`/`cpu` -- exactly one of
 * those ever ships in any single build, so listing all platform variants as if they're
 * simultaneously "production dependencies" overstated the surface even before this file's
 * platform-nondeterminism was the more pressing problem.
 *
 * Two modes, mirroring scripts/generate-openapi-docs.ts's --check convention:
 *   --generate (default): scan, then overwrite docs/dependency-licenses.generated.json.
 *   --check: scan, then (a) fail if the committed file is stale and (b) fail if any package's
 *            license isn't covered by scripts/ops/license-allowlist.txt. Never writes.
 *
 * The allowlist lives in scripts/ops/license-allowlist.txt (same convention as
 * scripts/ops/db-cve-allowlist.txt and scripts/ops/secret-scan-allowlist.txt) so approving a new
 * license -- or a specific package with a documented, manually-reviewed exception -- is a
 * reviewable one-line diff with a required reason, not a code change.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** SPDX "AND"/"OR" splitter -- deliberately simple (no nested-parens grouping), since every
 * compound expression actually seen in this tree so far is a flat "(X AND Y)"/"(X OR Y)". A
 * genuinely nested expression would need a real SPDX parser; this throws loudly instead of
 * silently mis-evaluating one. */
const splitCompoundLicense = (license) => {
  const stripped = license.replace(/^\(/, '').replace(/\)$/, '');
  if (/ AND /.test(stripped)) {
    return { op: 'AND', parts: stripped.split(' AND ').map((p) => p.trim()) };
  }
  if (/ OR /.test(stripped)) {
    return { op: 'OR', parts: stripped.split(' OR ').map((p) => p.trim()) };
  }
  return null;
};

const repoRoot = process.cwd();
const outputPath = path.join(repoRoot, 'docs', 'dependency-licenses.generated.json');
const allowlistPath = path.join(repoRoot, 'scripts', 'ops', 'license-allowlist.txt');
const lockfilePath = path.join(repoRoot, 'package-lock.json');

// Workspace packages are internal and private (see each workspace's own package.json) -- not
// real external dependencies, so they're excluded rather than allowlisted.
const isInternalPackage = (name) => name === 'reconciliation-platform' || name.startsWith('@recon/');

const loadAllowlist = () => {
  if (!existsSync(allowlistPath)) {
    throw new Error(`Missing ${allowlistPath}`);
  }

  const licenses = new Set();
  const packageExceptions = new Map();

  for (const rawLine of readFileSync(allowlistPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('pkg:')) {
      const [nameAndVersion, reason] = line.slice('pkg:'.length).split('|');
      if (!nameAndVersion || !reason) {
        throw new Error(`Malformed pkg: allowlist line (expected "pkg:name@version|reason"): ${line}`);
      }
      packageExceptions.set(nameAndVersion.trim(), reason.trim());
    } else {
      licenses.add(line);
    }
  }

  return { licenses, packageExceptions };
};

/** Extracts a license identifier from either the modern `license` field or the legacy
 * `licenses: [{type, url}]` array format (still used by some pre-2013 packages). */
const licenseFor = (entry) => {
  if (typeof entry.license === 'string' && entry.license) {
    return entry.license;
  }
  if (Array.isArray(entry.licenses) && entry.licenses[0]?.type) {
    return entry.licenses[0].type;
  }
  return null;
};

/** package-lock.json's own entries don't always carry a `license` field -- it normalize/backfills
 * from each package's package.json at lockfile-write time, but a handful of legacy pre-2013
 * packages (busboy@1.6.0, streamsearch@1.1.0, buffers@0.1.1 confirmed) predate the `licenses:
 * [{type, url}]` -> `license` string convention and npm never backfilled them. For anything with
 * no license, read that package's own on-disk package.json (installNodeModulesPath already gives
 * us exactly where npm put it) before giving up. */
const licenseForWithFallback = (entry, installNodeModulesPath) => {
  const direct = licenseFor(entry);
  if (direct) return direct;

  try {
    const pkgJson = JSON.parse(
      readFileSync(path.join(repoRoot, installNodeModulesPath, 'package.json'), 'utf8'),
    );
    const fallback = licenseFor(pkgJson);
    if (fallback) return fallback;
  } catch {
    // Fall through to UNKNOWN -- a missing/unparseable package.json is itself a real finding.
  }

  return null;
};

/** Extracts the installed package name from a package-lock.json `packages` key -- everything
 * after the *last* "node_modules/" segment, which is exactly npm's own convention for both
 * root-hoisted packages ("node_modules/lodash") and packages pinned to a different version
 * inside a specific dependent's own node_modules ("node_modules/@babel/core/node_modules/semver",
 * "apps/web/node_modules/react-router"). Scoped names ("@babel/core") keep their single internal
 * slash since node_modules/ never appears inside a scope segment. */
const packageNameFromLockKey = (key) => {
  const marker = 'node_modules/';
  return key.slice(key.lastIndexOf(marker) + marker.length);
};

/** Walks package-lock.json's flat `packages` map, deduping by name@version. Skips the root
 * project entry and workspace-member entries themselves (neither key contains "node_modules/"),
 * dev-only entries (mirrors `npm ls --omit=dev`), optional entries restricted to a specific
 * `os`/`cpu` (platform-alternative native builds -- exactly one ships in any real build, so they
 * can never be uniformly "this project's production dependencies" the way every other entry
 * here is), and internal workspace packages reached via a node_modules symlink. */
const collectPackages = (lockPackages) => {
  const seen = new Map();

  for (const [lockKey, entry] of Object.entries(lockPackages)) {
    if (!lockKey.includes('node_modules/')) continue;
    if (entry.dev) continue;
    if (entry.optional && (entry.os || entry.cpu)) continue;
    if (!entry.version) continue;

    const name = packageNameFromLockKey(lockKey);
    if (isInternalPackage(name)) continue;

    const key = `${name}@${entry.version}`;
    if (!seen.has(key)) {
      seen.set(key, { package: key, license: licenseForWithFallback(entry, lockKey) ?? 'UNKNOWN' });
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.package.localeCompare(b.package));
};

const buildReport = (packages) => ({
  generatedAt: new Date().toISOString(),
  scope: 'production dependencies only (--omit=dev); internal @recon/* workspace packages excluded',
  packageCount: packages.length,
  packages,
});

/** A license is approved if it's a plain allowlisted identifier, OR a compound "X AND Y"
 * expression where every part is approved (all parts apply simultaneously -- all must be safe),
 * OR a compound "X OR Y" expression where at least one part is approved (the consumer -- us --
 * gets to pick whichever license applies, so picking the permissive one is always legitimate). */
const isApprovedLicense = (license, licenses) => {
  if (licenses.has(license)) return true;

  const compound = splitCompoundLicense(license);
  if (!compound) return false;

  return compound.op === 'AND'
    ? compound.parts.every((part) => licenses.has(part))
    : compound.parts.some((part) => licenses.has(part));
};

const findViolations = (report, { licenses, packageExceptions }) =>
  report.packages.filter(
    (entry) => !isApprovedLicense(entry.license, licenses) && !packageExceptions.has(entry.package),
  );

const main = async () => {
  const checkOnly = process.argv.includes('--check');

  const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  const packages = collectPackages(lockfile.packages);
  const report = buildReport(packages);
  const allowlist = loadAllowlist();
  const violations = findViolations(report, allowlist);

  if (violations.length > 0) {
    console.error(`License check failed: ${violations.length} package(s) outside the approved allowlist.`);
    for (const entry of violations) {
      console.error(`  ${entry.package}: ${entry.license}`);
    }
    console.error(
      `\nApprove a new license by adding it to ${path.relative(repoRoot, allowlistPath)}, or add a ` +
        `named "pkg:name@version|reason" exception for a specific package, or replace the dependency.`,
    );
    process.exitCode = 1;
    return;
  }

  const exceptionsUsed = report.packages.filter((entry) => allowlist.packageExceptions.has(entry.package));
  console.log(`License check passed: ${report.packageCount} production packages, all licenses on the approved allowlist.`);
  if (exceptionsUsed.length > 0) {
    console.log(`  (${exceptionsUsed.length} via named package exception: ${exceptionsUsed.map((e) => e.package).join(', ')})`);
  }

  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  if (checkOnly) {
    if (!existsSync(outputPath)) {
      console.error(`${path.relative(repoRoot, outputPath)} is missing. Generate it with: npm run licenses:generate`);
      process.exitCode = 1;
      return;
    }

    const committed = readFileSync(outputPath, 'utf8');
    // generatedAt is expected to differ on every run -- compare everything else.
    const stripTimestamp = (text) => text.replace(/"generatedAt": ".*?"/, '"generatedAt": ""');
    if (stripTimestamp(committed) !== stripTimestamp(serialized)) {
      console.error(
        `${path.relative(repoRoot, outputPath)} is out of date with the current dependency tree. Regenerate it with: npm run licenses:generate`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(`${path.relative(repoRoot, outputPath)} is up to date.`);
    return;
  }

  writeFileSync(outputPath, serialized, 'utf8');
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
};

await main();
