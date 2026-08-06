/* global process */

/**
 * Secret-integrity scanner: gitleaks provides broad, full-history pattern coverage; trufflehog
 * provides live credential verification (it actually tests a discovered secret against its
 * provider's API and reports whether it still works). Neither tool alone gives the mockup's
 * "Verified-live vs Unverified" distinction -- gitleaks has no verification capability, and
 * trufflehog's own built-in detector rules are narrower than gitleaks'. Findings are merged by a
 * sha256 fingerprint of the raw secret value so a credential both tools catch gets gitleaks' rule
 * metadata and trufflehog's verification result on one row.
 *
 * The raw secret value is only ever held in a short-lived local variable long enough to compute
 * its sha256 fingerprint and a partial display mask. It is never assigned onto any object that
 * gets serialized, logged, or written to stdout -- see maskAndFingerprint() and its two call
 * sites, which are the only places a raw value exists in this process.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const runCommand = async (
  command,
  args,
  { cwd = process.cwd(), timeout = 300000, maxBuffer = 1024 * 1024 * 24 } = {},
) => {
  try {
    const result = await execFileAsync(command, args, { cwd, env: process.env, timeout, maxBuffer });
    return { ok: true, stdout: result.stdout?.toString() ?? '', stderr: result.stderr?.toString() ?? '' };
  } catch (error) {
    const failure = error;
    return {
      ok: false,
      // gitleaks/trufflehog exit non-zero when they find something -- that's not a command
      // failure for our purposes, so stdout/stderr are still read off the error object.
      stdout: typeof failure.stdout === 'string' ? failure.stdout : (failure.stdout?.toString() ?? ''),
      stderr: typeof failure.stderr === 'string' ? failure.stderr : (failure.stderr?.toString() ?? ''),
      message: typeof failure.message === 'string' ? failure.message : 'Command failed',
    };
  }
};

const isCommandAvailable = async (command, versionArgs) => {
  const result = await runCommand(command, versionArgs, { timeout: 20000 });
  return result.ok;
};

const firstNonEmptyLine = (value) =>
  String(value || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) || '';

/** Computes the fingerprint + display mask from a raw secret value and returns only those --
 *  callers must not retain the raw value beyond this call. */
const maskAndFingerprint = (rawValue) => {
  const raw = String(rawValue ?? '');
  const fingerprint = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  if (raw.length <= 8) {
    return { fingerprint, maskedSecret: '*'.repeat(Math.max(raw.length, 4)) };
  }
  const visible = 4;
  const middleLength = Math.min(12, raw.length - visible * 2);
  return {
    fingerprint,
    maskedSecret: `${raw.slice(0, visible)}${'*'.repeat(middleLength)}${raw.slice(-visible)}`,
  };
};

const readActiveSecretAllowlist = (repoRoot) => {
  const allowlistPath = path.join(repoRoot, 'scripts', 'ops', 'secret-scan-allowlist.txt');
  if (!existsSync(allowlistPath)) return new Set();
  const today = new Date().toISOString().slice(0, 10);
  const active = new Set();
  for (const line of readFileSync(allowlistPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [fingerprint, expiresOn] = trimmed.split('|');
    const value = fingerprint?.trim();
    const expires = expiresOn?.trim();
    if (!value) continue;
    if (expires && expires < today) continue;
    active.add(value.toLowerCase());
  }
  return active;
};

// --- gitleaks -----------------------------------------------------------------------------

const runGitleaks = async (repoRoot, mode) => {
  const reportDir = mkdtempSync(path.join(tmpdir(), 'gitleaks-'));
  const reportPath = path.join(reportDir, 'report.json');
  const args = [
    'detect',
    '--source',
    '.',
    '--report-format',
    'json',
    '--report-path',
    reportPath,
    '--exit-code',
    '0',
    '--no-banner',
  ];
  if (mode === 'working-tree') {
    args.push('--no-git');
  }

  const response = await runCommand('gitleaks', args, { cwd: repoRoot, timeout: 240000 });
  try {
    if (!existsSync(reportPath)) {
      return { ok: response.ok, findings: [], note: response.ok ? '' : firstNonEmptyLine(response.stderr || response.message) };
    }
    const parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
    return { ok: true, findings: Array.isArray(parsed) ? parsed : [], note: '' };
  } catch (error) {
    return { ok: false, findings: [], note: error instanceof Error ? error.message : 'gitleaks report was not parseable.' };
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
};

/** Maps one gitleaks report entry into a sanitized finding with a single occurrence. The raw
 *  `Secret` value is read once, here, to compute the fingerprint/mask, then discarded -- never
 *  stored on the return value. Callers merge same-fingerprint entries' occurrences together --
 *  the same secret value pasted into N files must show up as N occurrences of one finding, not
 *  silently collapse to whichever file happened to be processed last (see mergeFindings). */
const sanitizeGitleaksEntry = (entry, presentAtHead) => {
  const { fingerprint, maskedSecret } = maskAndFingerprint(entry.Secret);
  return {
    fingerprint,
    maskedSecret,
    ruleId: entry.RuleID || 'unknown-rule',
    description: entry.Description || 'Potential secret detected.',
    sources: ['gitleaks'],
    verified: null,
    occurrence: {
      file: entry.File || 'unknown file',
      startLine: typeof entry.StartLine === 'number' ? entry.StartLine : undefined,
      commit: entry.Commit ? String(entry.Commit).slice(0, 12) : undefined,
      author: entry.Author || undefined,
      date: entry.Date || undefined,
      presentAtHead,
    },
  };
};

// --- trufflehog -----------------------------------------------------------------------------

const runTrufflehog = async (repoRoot) => {
  const response = await runCommand(
    'trufflehog',
    ['git', `file://${repoRoot}`, '--json', '--no-update'],
    { cwd: repoRoot, timeout: 240000 },
  );
  // trufflehog exits non-zero when verified secrets are found -- stdout is still the report.
  const lines = String(response.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const results = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && 'SourceMetadata' in parsed) {
        results.push(parsed);
      }
    } catch {
      // trufflehog interleaves human-readable progress lines with JSON on some versions -- skip
      // anything that isn't valid JSON rather than failing the whole scan.
    }
  }

  return { ok: response.ok || results.length > 0, results, note: response.ok ? '' : firstNonEmptyLine(response.stderr || response.message) };
};

/** Maps one trufflehog result into a sanitized finding with a single occurrence. Reads
 *  `Raw`/`RawV2` once, here, to compute the fingerprint, then discards both -- never stored on
 *  the return value. */
const sanitizeTrufflehogResult = (result, repoRoot) => {
  const rawValue = result.Raw || result.RawV2 || '';
  const { fingerprint, maskedSecret } = maskAndFingerprint(rawValue);
  const gitMeta = result.SourceMetadata?.Data?.Git;
  const file = gitMeta?.file || 'unknown file';
  return {
    fingerprint,
    maskedSecret,
    ruleId: result.DetectorName || 'trufflehog-detector',
    description: `Verified by trufflehog (${result.DetectorName || 'unknown detector'}).`,
    sources: ['trufflehog'],
    verified: result.Verified === true ? true : result.Verified === false ? false : null,
    occurrence: {
      file,
      startLine: typeof gitMeta?.line === 'number' ? gitMeta.line : undefined,
      commit: gitMeta?.commit ? String(gitMeta.commit).slice(0, 12) : undefined,
      author: gitMeta?.email || undefined,
      date: gitMeta?.timestamp || undefined,
      // Cheaper proxy than gitleaks' two-pass diff: does the file still exist in the checked-out
      // tree at all. Confirms nothing about the specific line/secret still being there -- good
      // enough to separate "this file is gone" from "worth a closer look."
      presentAtHead: file !== 'unknown file' && existsSync(path.join(repoRoot, file)),
    },
  };
};

// --- merge + scoring ------------------------------------------------------------------------

/** Key identifying one physical occurrence of a secret (not the secret itself) -- used only to
 *  avoid pushing an exact duplicate occurrence twice, e.g. if a future third scanner reported the
 *  same file/line/commit gitleaks already found. */
const occurrenceKey = (occurrence) => `${occurrence.file}|${occurrence.startLine ?? ''}|${occurrence.commit ?? ''}`;

/**
 * Merges gitleaks + trufflehog entries by fingerprint (the secret value's content hash). Same
 * fingerprint, different files -- e.g. a secret pasted into both an env file and the incident
 * doc describing it, exactly the scenario ISSUE-049 documents -- accumulates as multiple
 * occurrences on ONE finding, rather than each new entry silently overwriting the last (the
 * original bug here: a Map keyed by fingerprint that did `.set()` per entry, so only the final
 * file processed survived). `verified` is a property of the secret value, not of any one
 * occurrence, so trufflehog's result (whichever entry carries a non-null verified) wins for the
 * whole finding once merged.
 */
const mergeFindings = (gitleaksEntries, trufflehogEntries) => {
  const byFingerprint = new Map();

  const addEntry = (entry) => {
    const existing = byFingerprint.get(entry.fingerprint);
    if (!existing) {
      byFingerprint.set(entry.fingerprint, {
        fingerprint: entry.fingerprint,
        maskedSecret: entry.maskedSecret,
        ruleId: entry.ruleId,
        description: entry.description,
        sources: new Set(entry.sources),
        verified: entry.verified,
        occurrenceKeys: new Set([occurrenceKey(entry.occurrence)]),
        occurrences: [entry.occurrence],
      });
      return;
    }

    for (const source of entry.sources) existing.sources.add(source);
    if (entry.verified !== null) existing.verified = entry.verified;

    const key = occurrenceKey(entry.occurrence);
    if (!existing.occurrenceKeys.has(key)) {
      existing.occurrenceKeys.add(key);
      existing.occurrences.push(entry.occurrence);
    }
  };

  for (const entry of gitleaksEntries) addEntry(entry);
  for (const entry of trufflehogEntries) addEntry(entry);

  return [...byFingerprint.values()].map((entry) => ({
    fingerprint: entry.fingerprint,
    maskedSecret: entry.maskedSecret,
    ruleId: entry.ruleId,
    description: entry.description,
    verified: entry.verified,
    occurrences: entry.occurrences,
    sources: [...entry.sources],
  }));
};

const severityFor = (finding) => {
  if (finding.verified === true) return 'critical';
  if (finding.occurrences.some((occurrence) => occurrence.presentAtHead)) return 'high';
  return 'moderate';
};

const zeroScore = () => ({ critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 });

const scoreFindings = (findings) => {
  const score = zeroScore();
  for (const finding of findings) {
    score[severityFor(finding)] += 1;
  }
  score.total = score.critical + score.high + score.moderate + score.low + score.info;
  return score;
};

const main = async () => {
  const repoRoot = process.cwd();
  const gitleaksAvailable = await isCommandAvailable('gitleaks', ['version']);
  const trufflehogAvailable = await isCommandAvailable('trufflehog', ['--version']);
  const notes = [];

  let gitleaksFindings = [];
  if (gitleaksAvailable) {
    const [historyRun, workingTreeRun] = await Promise.all([
      runGitleaks(repoRoot, 'history'),
      runGitleaks(repoRoot, 'working-tree'),
    ]);
    if (historyRun.note) notes.push(`gitleaks (history): ${historyRun.note}`);
    if (workingTreeRun.note) notes.push(`gitleaks (working tree): ${workingTreeRun.note}`);

    const workingTreeFingerprints = new Set(
      workingTreeRun.findings.map((entry) => maskAndFingerprint(entry.Secret).fingerprint),
    );
    gitleaksFindings = historyRun.findings.map((entry) =>
      sanitizeGitleaksEntry(entry, workingTreeFingerprints.has(maskAndFingerprint(entry.Secret).fingerprint)),
    );
  } else {
    notes.push('gitleaks is not installed in this runtime.');
  }

  let trufflehogFindings = [];
  if (trufflehogAvailable) {
    const trufflehogRun = await runTrufflehog(repoRoot);
    if (trufflehogRun.note) notes.push(`trufflehog: ${trufflehogRun.note}`);
    trufflehogFindings = trufflehogRun.results.map((result) => sanitizeTrufflehogResult(result, repoRoot));
  } else {
    notes.push('trufflehog is not installed in this runtime.');
  }

  const merged = mergeFindings(gitleaksFindings, trufflehogFindings);

  const activeAllowlist = readActiveSecretAllowlist(repoRoot);
  const findings = merged.filter((finding) => !activeAllowlist.has(finding.fingerprint.toLowerCase()));

  const aggregate = scoreFindings(findings);
  const status = !gitleaksAvailable && !trufflehogAvailable ? 'skipped' : 'ok';

  const payload = {
    generatedAt: new Date().toISOString(),
    status,
    note: notes.join(' | '),
    findings,
    aggregate,
    tools: { gitleaks: gitleaksAvailable, trufflehog: trufflehogAvailable },
    policy: { failOnVerifiedOrPresentAtHead: true },
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  const hasBlockingSeverity = aggregate.critical > 0 || aggregate.high > 0;
  process.exitCode = status === 'ok' && hasBlockingSeverity ? 1 : 0;
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`secret scan failed: ${message}\n`);
  process.exitCode = 1;
}
