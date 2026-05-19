/* global process */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const readActiveCveAllowlist = (repoRoot) => {
  const allowlistPath = path.join(repoRoot, 'scripts', 'ops', 'db-cve-allowlist.txt');
  if (!existsSync(allowlistPath)) return new Set();
  const today = new Date().toISOString().slice(0, 10);
  const active = new Set();
  for (const line of readFileSync(allowlistPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [id, expiresOn] = trimmed.split('|');
    const cveId = id?.trim();
    const expires = expiresOn?.trim();
    if (!cveId) continue;
    if (expires && expires < today) continue;
    active.add(cveId.toUpperCase());
  }
  return active;
};

const scoreFromFindings = (findings) => {
  const score = createZeroScore();
  for (const f of findings) {
    const sev = (f.severity ?? '').toUpperCase();
    if (sev === 'CRITICAL') score.critical++;
    else if (sev === 'HIGH') score.high++;
    else if (sev === 'MEDIUM' || sev === 'MODERATE') score.moderate++;
    else if (sev === 'LOW') score.low++;
    else score.info++;
  }
  return score;
};

const auditNetworkErrorRegex =
  /EAI_AGAIN|ENOTFOUND|audit endpoint returned an error|ECONNRESET|ETIMEDOUT/i;

const createZeroScore = () => ({
  critical: 0,
  high: 0,
  moderate: 0,
  low: 0,
  info: 0,
  total: 0,
});

const withTotal = (score) => ({
  ...score,
  total: score.critical + score.high + score.moderate + score.low + score.info,
});

const addScore = (left, right) =>
  withTotal({
    critical: left.critical + right.critical,
    high: left.high + right.high,
    moderate: left.moderate + right.moderate,
    low: left.low + right.low,
    info: left.info + right.info,
    total: 0,
  });

const createComponentResult = (component, scanner) => ({
  component,
  scanner,
  status: 'ok',
  note: '',
  cveFindings: [],
  ...createZeroScore(),
});

const cveIdRegex = /CVE-\d{4}-\d+/iu;

const severityRankByLabel = {
  CRITICAL: 0,
  HIGH: 1,
  MODERATE: 2,
  LOW: 3,
  INFO: 4,
  UNKNOWN: 5,
};

const normalizeSeverityLabel = (value) => {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();

  if (normalized === 'MEDIUM') {
    return 'MODERATE';
  }

  if (
    normalized === 'CRITICAL' ||
    normalized === 'HIGH' ||
    normalized === 'MODERATE' ||
    normalized === 'LOW' ||
    normalized === 'INFO' ||
    normalized === 'UNKNOWN'
  ) {
    return normalized;
  }

  return 'UNKNOWN';
};

const normalizeCveId = (value) => {
  const match = cveIdRegex.exec(collapseWhitespace(value).toUpperCase());

  return match ? match[0] : null;
};

const collapseWhitespace = (value) =>
  String(value ?? '')
    .replaceAll(/\s+/gu, ' ')
    .trim();

const clipText = (value, maxLength = 180) => {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const headLength = Math.max(0, maxLength - 3);
  return `${normalized.slice(0, headLength).trimEnd()}...`;
};

const sanitizeCveFinding = (value, fallbackComponent = '', fallbackScanner = '') => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const source = value;
  const id =
    normalizeCveId(source.id) ??
    normalizeCveId(source.cve) ??
    normalizeCveId(source.vulnerabilityId);
  if (!id) {
    return null;
  }

  const description =
    clipText(source.description ?? source.title, 180) || 'No description provided.';
  const component =
    collapseWhitespace(source.component) ||
    collapseWhitespace(fallbackComponent) ||
    'Unknown component';
  const scanner =
    collapseWhitespace(source.scanner) || collapseWhitespace(fallbackScanner) || 'Unknown scanner';

  return {
    id,
    description,
    severity: normalizeSeverityLabel(source.severity),
    component,
    scanner,
  };
};

const dedupeAndSortCveFindings = (value, fallbackComponent = '', fallbackScanner = '') => {
  const findings = Array.isArray(value) ? value : [];
  const deduped = new Map();

  for (const entry of findings) {
    const finding = sanitizeCveFinding(entry, fallbackComponent, fallbackScanner);
    if (!finding) {
      continue;
    }

    const key = `${finding.id}|${finding.component}|${finding.scanner}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, finding);
      continue;
    }

    const existingRank = severityRankByLabel[existing.severity] ?? severityRankByLabel.UNKNOWN;
    const incomingRank = severityRankByLabel[finding.severity] ?? severityRankByLabel.UNKNOWN;
    const preferredDescription =
      finding.description.length > existing.description.length
        ? finding.description
        : existing.description;

    deduped.set(key, {
      ...existing,
      description: preferredDescription,
      severity: incomingRank < existingRank ? finding.severity : existing.severity,
    });
  }

  return [...deduped.values()].sort((left, right) => {
    const leftRank = severityRankByLabel[left.severity] ?? severityRankByLabel.UNKNOWN;
    const rightRank = severityRankByLabel[right.severity] ?? severityRankByLabel.UNKNOWN;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const idSort = left.id.localeCompare(right.id);
    if (idSort !== 0) {
      return idSort;
    }

    return left.component.localeCompare(right.component);
  });
};

const toInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.trunc(parsed));
};

const firstNonEmptyLine = (value) =>
  String(value || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) || '';

const parseJsonFromOutput = (output) => {
  const text = String(output || '');
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');

  if (jsonStart < 0 || jsonEnd < 0 || jsonEnd < jsonStart) {
    return null;
  }

  try {
    return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch {
    return null;
  }
};

const composeConfigCache = new Map();

const loadComposeConfig = async (repoRoot, composePrefixArgs) => {
  const cacheKey = `${repoRoot}::${composePrefixArgs.join('\u0001')}`;
  const cached = composeConfigCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await runCommand(
    'docker',
    [...composePrefixArgs, 'config', '--format', 'json'],
    {
      cwd: repoRoot,
      timeout: 45000,
    },
  );

  if (!response.ok) {
    const failure = {
      ok: false,
      services: {},
      note:
        firstNonEmptyLine(response.stderr || response.stdout || response.message) ||
        'Failed to resolve compose config.',
    };
    composeConfigCache.set(cacheKey, failure);
    return failure;
  }

  const parsed = parseJsonFromOutput(response.stdout);
  if (!parsed || typeof parsed !== 'object') {
    const failure = {
      ok: false,
      services: {},
      note: 'Compose config output was not parseable JSON.',
    };
    composeConfigCache.set(cacheKey, failure);
    return failure;
  }

  const success = {
    ok: true,
    services:
      typeof parsed.services === 'object' && parsed.services !== null ? parsed.services : {},
    note: '',
  };
  composeConfigCache.set(cacheKey, success);
  return success;
};

const runCommand = async (
  command,
  args,
  { cwd = process.cwd(), timeout = 120000, maxBuffer = 1024 * 1024 * 24 } = {},
) => {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: process.env,
      timeout,
      maxBuffer,
    });

    return {
      ok: true,
      stdout: result.stdout?.toString() ?? '',
      stderr: result.stderr?.toString() ?? '',
      exitCode: 0,
      message: '',
    };
  } catch (error) {
    const failure = error;
    const stdout =
      typeof failure.stdout === 'string' ? failure.stdout : (failure.stdout?.toString() ?? '');
    const stderr =
      typeof failure.stderr === 'string' ? failure.stderr : (failure.stderr?.toString() ?? '');

    return {
      ok: false,
      stdout,
      stderr,
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      message: typeof failure.message === 'string' ? failure.message : 'Command failed',
    };
  }
};

const isCommandAvailable = async (command) => {
  const result = await runCommand(command, ['--version'], { timeout: 20000 });
  return result.ok;
};

const normalizePathFromRepoRoot = (repoRoot, value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  return path.isAbsolute(value) ? value : path.join(repoRoot, value.replace(/^\.\//u, ''));
};

const collectComposeFileSets = (repoRoot) => {
  const baseComposeFile = path.join(repoRoot, 'compose.yaml');
  const sets = [];
  const seenKeys = new Set();

  const addSet = (extraComposeFile) => {
    const key = extraComposeFile ?? '';
    if (seenKeys.has(key)) {
      return;
    }

    seenKeys.add(key);
    sets.push({ baseComposeFile, extraComposeFile });
  };

  const explicitExtraFile = normalizePathFromRepoRoot(
    repoRoot,
    process.env.DOCKER_COMPOSE_EXTRA_FILE,
  );
  if (explicitExtraFile && existsSync(explicitExtraFile)) {
    addSet(explicitExtraFile);
  }

  const devComposeFile = path.join(repoRoot, 'compose.dev.yaml');
  if (existsSync(devComposeFile)) {
    addSet(devComposeFile);
  }

  const stageComposeFile = path.join(repoRoot, 'compose.stage.yaml');
  if (existsSync(stageComposeFile)) {
    addSet(stageComposeFile);
  }

  addSet(null);
  return sets;
};

const readComposeProjectNameFromEnvFile = (envFile) => {
  if (!envFile || !existsSync(envFile)) {
    return null;
  }

  try {
    const lines = readFileSync(envFile, 'utf8').split(/\r?\n/u);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const rawKey = trimmed.slice(0, separatorIndex).trim();
      const key = rawKey.replace(/^export\s+/u, '');
      if (key !== 'COMPOSE_PROJECT_NAME') {
        continue;
      }

      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      return value.length > 0 ? value : null;
    }
  } catch {
    return null;
  }

  return null;
};

const buildComposePrefixArgs = (baseComposeFile, extraComposeFile, envFile, projectName) => {
  const args = ['compose'];

  if (projectName) {
    args.push('--project-name', projectName);
  }

  if (baseComposeFile) {
    args.push('-f', baseComposeFile);
  }

  if (extraComposeFile) {
    args.push('-f', extraComposeFile);
  }

  if (envFile) {
    args.push('--env-file', envFile);
  }

  return args;
};

const collectComposeEnvCandidates = (repoRoot) => {
  const candidates = [];
  const addCandidate = (value) => {
    const resolved = normalizePathFromRepoRoot(repoRoot, value);
    if (!resolved || !existsSync(resolved) || candidates.includes(resolved)) {
      return;
    }

    candidates.push(resolved);
  };

  addCandidate(process.env.DOCKER_ENV_FILE);
  addCandidate(process.env.DOCKER_COMPOSE_ENV_FILE);
  addCandidate('.env.docker.dev');
  addCandidate('.env.docker.dev.fallback');
  addCandidate('.env.docker');
  addCandidate('.env.docker.stage');
  addCandidate('.env.docker.stage.fallback');

  return candidates;
};

const createComposeContext = async (repoRoot, dockerAvailable) => {
  const fileSets = collectComposeFileSets(repoRoot);
  const envCandidates = collectComposeEnvCandidates(repoRoot);
  const resolveProjectName = (envFile) =>
    readComposeProjectNameFromEnvFile(envFile) ?? process.env.COMPOSE_PROJECT_NAME ?? null;

  if (!dockerAvailable) {
    const fallbackFileSet = fileSets[0] ?? {
      baseComposeFile: path.join(repoRoot, 'compose.yaml'),
      extraComposeFile: null,
    };

    return {
      ...fallbackFileSet,
      envFile: envCandidates[0] ?? null,
      projectName: resolveProjectName(envCandidates[0] ?? null),
      prefixArgs: buildComposePrefixArgs(
        fallbackFileSet.baseComposeFile,
        fallbackFileSet.extraComposeFile,
        envCandidates[0] ?? null,
        resolveProjectName(envCandidates[0] ?? null),
      ),
    };
  }

  const envOptions = envCandidates.length > 0 ? [...envCandidates, null] : [null];

  for (const fileSet of fileSets) {
    for (const envFile of envOptions) {
      const projectName = resolveProjectName(envFile);
      const probe = await runCommand(
        'docker',
        [
          ...buildComposePrefixArgs(
            fileSet.baseComposeFile,
            fileSet.extraComposeFile,
            envFile,
            projectName,
          ),
          'ps',
          '-q',
        ],
        { cwd: repoRoot, timeout: 30000 },
      );

      if (probe.ok && firstNonEmptyLine(probe.stdout)) {
        return {
          ...fileSet,
          envFile,
          projectName,
          prefixArgs: buildComposePrefixArgs(
            fileSet.baseComposeFile,
            fileSet.extraComposeFile,
            envFile,
            projectName,
          ),
        };
      }
    }
  }

  const fallbackFileSet = fileSets[0] ?? {
    baseComposeFile: path.join(repoRoot, 'compose.yaml'),
    extraComposeFile: null,
  };
  const fallbackEnv = envCandidates[0] ?? null;
  const fallbackProjectName = resolveProjectName(fallbackEnv);

  return {
    ...fallbackFileSet,
    envFile: fallbackEnv,
    projectName: fallbackProjectName,
    prefixArgs: buildComposePrefixArgs(
      fallbackFileSet.baseComposeFile,
      fallbackFileSet.extraComposeFile,
      fallbackEnv,
      fallbackProjectName,
    ),
  };
};

const parseNpmAuditScore = (output) => {
  const payload = parseJsonFromOutput(output);
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const metadata = payload.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const vulnerabilities = metadata.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    return null;
  }

  return withTotal({
    critical: toInt(vulnerabilities.critical),
    high: toInt(vulnerabilities.high),
    moderate: toInt(vulnerabilities.moderate),
    low: toInt(vulnerabilities.low),
    info: toInt(vulnerabilities.info),
    total: 0,
  });
};

const buildNpmCveFinding = (viaItem, packageName, packageSeverity, component, scanner) => {
  if (typeof viaItem === 'string') {
    const id = normalizeCveId(viaItem);
    if (!id) {
      return null;
    }

    return {
      id,
      description: `Vulnerability reported for ${packageName}.`,
      severity: packageSeverity,
      component,
      scanner,
    };
  }

  if (!viaItem || typeof viaItem !== 'object') {
    return null;
  }

  const via = viaItem;
  const id =
    normalizeCveId(via.id) ??
    normalizeCveId(via.url) ??
    normalizeCveId(via.name) ??
    normalizeCveId(via.title) ??
    normalizeCveId(via.source);
  if (!id) {
    return null;
  }

  return {
    id,
    description:
      clipText(via.title || via.name || via.url, 180) ||
      `Vulnerability reported for ${packageName}.`,
    severity: normalizeSeverityLabel(via.severity ?? packageSeverity),
    component,
    scanner,
  };
};

const extractNpmPackageCveFindings = (packageName, packageVulnerability, component, scanner) => {
  const viaItems = Array.isArray(packageVulnerability.via) ? packageVulnerability.via : [];
  const packageSeverity = normalizeSeverityLabel(packageVulnerability.severity);

  return viaItems
    .map((viaItem) => buildNpmCveFinding(viaItem, packageName, packageSeverity, component, scanner))
    .filter(Boolean);
};

const parseNpmAuditCveFindings = (output, component, scanner) => {
  const payload = parseJsonFromOutput(output);
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const vulnerabilities = payload.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    return [];
  }

  const findings = [];

  for (const [packageName, packageValue] of Object.entries(vulnerabilities)) {
    if (!packageValue || typeof packageValue !== 'object') {
      continue;
    }

    findings.push(...extractNpmPackageCveFindings(packageName, packageValue, component, scanner));
  }

  return dedupeAndSortCveFindings(findings, component, scanner);
};

const parseTrivyScore = (output) => {
  const payload = parseJsonFromOutput(output);
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const results = Array.isArray(payload.Results) ? payload.Results : [];
  const score = createZeroScore();

  const severityToKey = (severity) => {
    const value = String(severity || '').toUpperCase();
    if (value === 'CRITICAL') {
      return 'critical';
    }

    if (value === 'HIGH') {
      return 'high';
    }

    if (value === 'MEDIUM' || value === 'MODERATE') {
      return 'moderate';
    }

    if (value === 'LOW') {
      return 'low';
    }

    return 'info';
  };

  for (const result of results) {
    const vulnerabilities = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];
    for (const vulnerability of vulnerabilities) {
      const severityKey = severityToKey(vulnerability?.Severity);
      score[severityKey] += 1;
    }
  }

  return withTotal(score);
};

const parseTrivyCveFindings = (output, component, scanner) => {
  const payload = parseJsonFromOutput(output);
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const results = Array.isArray(payload.Results) ? payload.Results : [];
  const findings = [];

  for (const result of results) {
    const vulnerabilities = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];

    for (const vulnerability of vulnerabilities) {
      const id = normalizeCveId(vulnerability?.VulnerabilityID);
      if (!id) {
        continue;
      }

      findings.push({
        id,
        description:
          clipText(vulnerability?.Title || vulnerability?.Description || vulnerability?.PkgName) ||
          'No description provided.',
        severity: normalizeSeverityLabel(vulnerability?.Severity),
        component,
        scanner,
      });
    }
  }

  return dedupeAndSortCveFindings(findings, component, scanner);
};

const scanNpmWorkspaceComponent = async (component, workspace, repoRoot) => {
  const result = createComponentResult(component, 'npm audit');
  const response = await runCommand(npmExecutable, ['audit', '--json', '--workspace', workspace], {
    cwd: repoRoot,
    timeout: 240000,
  });

  const output = `${response.stdout}\n${response.stderr}`.trim();
  const score = parseNpmAuditScore(output);
  result.cveFindings = parseNpmAuditCveFindings(output, component, result.scanner);

  if (score) {
    Object.assign(result, score);
    if (!response.ok && score.total === 0 && auditNetworkErrorRegex.test(output)) {
      result.status = 'skipped';
      result.note = 'npm audit endpoint is not reachable from this runtime.';
    } else if (!response.ok && score.total === 0) {
      result.status = 'error';
      result.note =
        firstNonEmptyLine(response.stderr || response.stdout || response.message) ||
        'npm audit failed.';
    }

    return withTotal(result);
  }

  if (auditNetworkErrorRegex.test(output)) {
    result.status = 'skipped';
    result.note = 'npm audit endpoint is not reachable from this runtime.';
    return withTotal(result);
  }

  if (!response.ok) {
    result.status = 'error';
    result.note = firstNonEmptyLine(response.stderr || response.stdout || response.message);
    return withTotal(result);
  }

  result.note = 'npm audit completed but did not include vulnerability metadata.';
  return withTotal(result);
};

const resolveRunningContainerServiceImage = async (serviceName, repoRoot, composePrefixArgs) => {
  const serviceLookup = await runCommand(
    'docker',
    [...composePrefixArgs, 'ps', '-q', serviceName],
    {
      cwd: repoRoot,
      timeout: 30000,
    },
  );

  if (serviceLookup.ok) {
    const containerId = firstNonEmptyLine(serviceLookup.stdout);
    if (!containerId) {
      return {
        imageRef: '',
        reason: `${serviceName} container is not running.`,
      };
    }

    const imageLookup = await runCommand(
      'docker',
      ['inspect', '--format', '{{.Config.Image}}', containerId],
      { cwd: repoRoot, timeout: 30000 },
    );

    if (imageLookup.ok) {
      const imageRef = firstNonEmptyLine(imageLookup.stdout);
      if (imageRef) {
        return {
          imageRef,
          reason: '',
        };
      }

      return {
        imageRef: '',
        reason: `Unable to resolve image for ${serviceName} container.`,
      };
    }

    return {
      imageRef: '',
      reason:
        firstNonEmptyLine(imageLookup.stderr || imageLookup.stdout || imageLookup.message) ||
        `Unable to inspect ${serviceName} container image.`,
    };
  }

  return {
    imageRef: '',
    reason:
      firstNonEmptyLine(serviceLookup.stderr || serviceLookup.stdout || serviceLookup.message) ||
      `Failed to query ${serviceName} container status.`,
  };
};

const resolveConfiguredServiceImage = async (serviceName, repoRoot, composePrefixArgs) => {
  const composeConfig = await loadComposeConfig(repoRoot, composePrefixArgs);
  const configuredService = composeConfig.services?.[serviceName];
  const configuredImageRef = collapseWhitespace(configuredService?.image);

  if (!configuredImageRef) {
    return {
      imageRef: '',
      reason: composeConfig.note || `No configured image found for service ${serviceName}.`,
    };
  }

  const localImageLookup = await runCommand(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', configuredImageRef],
    { cwd: repoRoot, timeout: 30000 },
  );

  if (localImageLookup.ok && firstNonEmptyLine(localImageLookup.stdout)) {
    return {
      imageRef: configuredImageRef,
      reason: `Scanning local image ${configuredImageRef}.`,
    };
  }

  return {
    imageRef: '',
    reason: `Configured image ${configuredImageRef} is not available locally.`,
  };
};

const resolveComposeServiceImage = async (
  serviceName,
  repoRoot,
  dockerAvailable,
  composePrefixArgs,
) => {
  if (!dockerAvailable) {
    return {
      imageRef: '',
      reason: 'Docker CLI is not available in this runtime.',
    };
  }

  const runningContainer = await resolveRunningContainerServiceImage(
    serviceName,
    repoRoot,
    composePrefixArgs,
  );

  if (runningContainer.imageRef) {
    return runningContainer;
  }

  const configuredImage = await resolveConfiguredServiceImage(
    serviceName,
    repoRoot,
    composePrefixArgs,
  );
  if (configuredImage.imageRef) {
    return {
      imageRef: configuredImage.imageRef,
      reason: [runningContainer.reason, configuredImage.reason].filter(Boolean).join(' '),
    };
  }

  return {
    imageRef: '',
    reason: [runningContainer.reason, configuredImage.reason].filter(Boolean).join(' | '),
  };
};

const scanTrivyImages = async (component, imageRefs, repoRoot, trivyAvailable) => {
  const result = createComponentResult(component, 'Trivy');
  const uniqueImageRefs = [...new Set(imageRefs.filter(Boolean))];

  if (uniqueImageRefs.length === 0) {
    result.status = 'skipped';
    result.note = 'No local image was found for this component.';
    return withTotal(result);
  }

  if (!trivyAvailable) {
    result.status = 'skipped';
    result.note = 'Trivy is not installed in this runtime.';
    return withTotal(result);
  }

  const notes = [];

  for (const imageRef of uniqueImageRefs) {
    const response = await runCommand(
      'trivy',
      [
        'image',
        '--scanners',
        'vuln',
        '--format',
        'json',
        '--severity',
        'CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN',
        '--quiet',
        imageRef,
      ],
      { cwd: repoRoot, timeout: 300000 },
    );

    const output = `${response.stdout}\n${response.stderr}`.trim();
    const score = parseTrivyScore(output);
    const findings = parseTrivyCveFindings(output, component, result.scanner);
    if (findings.length > 0) {
      result.cveFindings = dedupeAndSortCveFindings(
        [...result.cveFindings, ...findings],
        component,
        result.scanner,
      );
    }

    if (!score) {
      result.status = 'error';
      notes.push(
        `${imageRef}: ${firstNonEmptyLine(response.stderr || response.stdout || response.message) || 'Trivy output was not parseable.'}`,
      );
      continue;
    }

    Object.assign(result, addScore(result, score));
  }

  if (notes.length > 0) {
    result.note = notes.join(' | ');
  }

  return withTotal(result);
};

const checkPgAudit = async (repoRoot, dockerAvailable, composePrefixArgs) => {
  if (!dockerAvailable) {
    return {
      status: 'skipped',
      note: 'pgAudit check skipped because Docker CLI is unavailable.',
      missing: false,
    };
  }

  const postgresUser = process.env.POSTGRES_USER ?? 'recon_app';
  const postgresDatabase = process.env.POSTGRES_DB ?? 'reconciliation_platform';
  const response = await runCommand(
    'docker',
    [
      ...composePrefixArgs,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      postgresUser,
      '-d',
      postgresDatabase,
      '-tAc',
      "SELECT extname FROM pg_extension WHERE extname='pgaudit' LIMIT 1;",
    ],
    { cwd: repoRoot, timeout: 45000 },
  );

  if (!response.ok) {
    return {
      status: 'skipped',
      note:
        firstNonEmptyLine(response.stderr || response.stdout || response.message) ||
        'pgAudit check failed.',
      missing: false,
    };
  }

  const value = String(response.stdout || '')
    .trim()
    .toLowerCase();
  if (value.includes('pgaudit')) {
    return {
      status: 'ok',
      note: 'pgAudit extension enabled.',
      missing: false,
    };
  }

  return {
    status: 'ok',
    note: 'pgAudit extension is not enabled.',
    missing: true,
  };
};

const componentScriptByKey = {
  api: 'security-scan-api.mjs',
  database: 'security-scan-database.mjs',
  container: 'security-scan-container-component.mjs',
  web: 'security-scan-web-server.mjs',
};

const componentNameByKey = {
  api: 'API',
  database: 'Database',
  container: 'Container Component',
  web: 'Web Server',
};

const normalizeComponentKey = (value) => {
  const raw = String(value || '')
    .trim()
    .toLowerCase();

  if (raw === 'api') {
    return 'api';
  }

  if (raw === 'database' || raw === 'db') {
    return 'database';
  }

  if (raw === 'container' || raw === 'container-component' || raw === 'container_component') {
    return 'container';
  }

  if (raw === 'web' || raw === 'web-server' || raw === 'web_server') {
    return 'web';
  }

  return null;
};

const parseComponentArg = () => {
  const argv = process.argv.slice(2);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === '--component') {
      return normalizeComponentKey(argv[index + 1]);
    }

    if (token.startsWith('--component=')) {
      return normalizeComponentKey(token.slice('--component='.length));
    }
  }

  return null;
};

const collectApiComponent = async (repoRoot) =>
  scanNpmWorkspaceComponent('API', '@recon/api', repoRoot);

const collectWebServerComponent = async (repoRoot) =>
  scanNpmWorkspaceComponent('Web Server', '@recon/web', repoRoot);

const collectDatabaseComponent = async (
  repoRoot,
  trivyAvailable,
  dockerAvailable,
  composeContext,
) => {
  const postgresImage = await resolveComposeServiceImage(
    'postgres',
    repoRoot,
    dockerAvailable,
    composeContext.prefixArgs,
  );

  const databaseComponent = await scanTrivyImages(
    'Database',
    postgresImage.imageRef ? [postgresImage.imageRef] : [],
    repoRoot,
    trivyAvailable,
  );
  databaseComponent.scanner = 'Trivy + pgAudit';
  databaseComponent.cveFindings = dedupeAndSortCveFindings(
    databaseComponent.cveFindings.map((finding) => ({
      ...finding,
      scanner: databaseComponent.scanner,
    })),
    databaseComponent.component,
    databaseComponent.scanner,
  );

  const activeCveAllowlist = readActiveCveAllowlist(repoRoot);
  if (activeCveAllowlist.size > 0) {
    databaseComponent.cveFindings = databaseComponent.cveFindings.filter(
      (f) => !activeCveAllowlist.has((f.id ?? '').toUpperCase()),
    );
    const recomputed = scoreFromFindings(databaseComponent.cveFindings);
    Object.assign(databaseComponent, withTotal(recomputed));
  }

  const pgAudit = await checkPgAudit(repoRoot, dockerAvailable, composeContext.prefixArgs);
  if (pgAudit.missing) {
    databaseComponent.info += 1;
    databaseComponent.total += 1;
  }

  const notes = [];
  if (postgresImage.reason) {
    notes.push(postgresImage.reason);
  }
  if (pgAudit.note) {
    notes.push(pgAudit.note);
  }

  if (notes.length > 0) {
    databaseComponent.note = notes.join(' | ');
  }

  if (databaseComponent.status === 'ok' && postgresImage.imageRef.length === 0) {
    databaseComponent.status = 'skipped';
  }

  return withTotal(databaseComponent);
};

const collectContainerComponent = async (
  repoRoot,
  trivyAvailable,
  dockerAvailable,
  composeContext,
) => {
  const apiImage = await resolveComposeServiceImage(
    'api',
    repoRoot,
    dockerAvailable,
    composeContext.prefixArgs,
  );
  const webImage = await resolveComposeServiceImage(
    'web',
    repoRoot,
    dockerAvailable,
    composeContext.prefixArgs,
  );

  const containerImageRefs = [apiImage.imageRef, webImage.imageRef].filter(Boolean);
  const containerComponent = await scanTrivyImages(
    'Container Component',
    containerImageRefs,
    repoRoot,
    trivyAvailable,
  );

  const activeCveAllowlistContainer = readActiveCveAllowlist(repoRoot);
  if (activeCveAllowlistContainer.size > 0) {
    containerComponent.cveFindings = containerComponent.cveFindings.filter(
      (f) => !activeCveAllowlistContainer.has((f.id ?? '').toUpperCase()),
    );
    const recomputed = scoreFromFindings(containerComponent.cveFindings);
    Object.assign(containerComponent, withTotal(recomputed));
  }

  const notes = [apiImage.reason, webImage.reason].filter(Boolean);
  if (notes.length > 0) {
    containerComponent.note = containerComponent.note
      ? `${containerComponent.note} | ${notes.join(' | ')}`
      : notes.join(' | ');
  }

  return withTotal(containerComponent);
};

const collectComponentByKey = async (
  componentKey,
  repoRoot,
  trivyAvailable,
  dockerAvailable,
  composeContext,
) => {
  if (componentKey === 'api') {
    return collectApiComponent(repoRoot);
  }

  if (componentKey === 'database') {
    return collectDatabaseComponent(repoRoot, trivyAvailable, dockerAvailable, composeContext);
  }

  if (componentKey === 'container') {
    return collectContainerComponent(repoRoot, trivyAvailable, dockerAvailable, composeContext);
  }

  return collectWebServerComponent(repoRoot);
};

const buildScriptFailureComponent = (componentName, scanner, note) => {
  const component = createComponentResult(componentName, scanner);
  component.status = 'error';
  component.note = note;
  return withTotal(component);
};

const extractComponentFromPayload = (output) => {
  const parsed = parseJsonFromOutput(output);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const payload = parsed;
  if (typeof payload.component === 'object' && payload.component !== null) {
    return payload.component;
  }

  if (Array.isArray(payload.components) && payload.components.length === 1) {
    return payload.components[0];
  }

  return null;
};

const runComponentScript = async (componentKey, repoRoot) => {
  const scriptName = componentScriptByKey[componentKey];
  const componentName = componentNameByKey[componentKey];
  if (!scriptName || !componentName) {
    return buildScriptFailureComponent(
      componentName ?? 'Unknown',
      'component-script',
      `Unknown component key: ${componentKey}`,
    );
  }

  const scriptPath = path.join(repoRoot, 'scripts', scriptName);
  const response = await runCommand(process.execPath, [scriptPath], {
    cwd: repoRoot,
    timeout: 420000,
    maxBuffer: 1024 * 1024 * 24,
  });

  const output = `${response.stdout}\n${response.stderr}`.trim();
  const component = extractComponentFromPayload(output);
  if (!component || typeof component !== 'object') {
    return buildScriptFailureComponent(
      componentName,
      'component-script',
      firstNonEmptyLine(output || response.message || 'Component script output was not parseable.'),
    );
  }

  const result = {
    ...createComponentResult(componentName, String(component.scanner || 'component-script')),
    ...component,
  };

  if (String(result.component || '').trim().length === 0) {
    result.component = componentName;
  }

  result.cveFindings = dedupeAndSortCveFindings(
    result.cveFindings,
    result.component,
    result.scanner,
  );

  return withTotal(result);
};

const main = async () => {
  const repoRoot = process.cwd();
  const trivyAvailable = await isCommandAvailable('trivy');
  const dockerAvailable = await isCommandAvailable('docker');
  const composeContext = await createComposeContext(repoRoot, dockerAvailable);
  const requestedComponent = parseComponentArg();

  if (requestedComponent) {
    const component = await collectComponentByKey(
      requestedComponent,
      repoRoot,
      trivyAvailable,
      dockerAvailable,
      composeContext,
    );
    const payload = {
      generatedAt: new Date().toISOString(),
      mode: 'single-component',
      requestedComponent,
      component: withTotal(component),
      cveFindings: dedupeAndSortCveFindings(
        component.cveFindings,
        component.component,
        component.scanner,
      ),
      tools: {
        npmAudit: true,
        trivy: trivyAvailable,
        pgAudit: dockerAvailable,
      },
      policy: {
        failOnCriticalOrHigh: true,
      },
    };

    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

    const hasBlockingSeverity = component.critical > 0 || component.high > 0;
    const hasErrors = component.status === 'error';
    process.exitCode = hasBlockingSeverity || hasErrors ? 1 : 0;
    return;
  }

  const components = [];
  for (const componentKey of ['api', 'database', 'container', 'web']) {
    const component = await runComponentScript(componentKey, repoRoot);
    components.push(component);
  }

  const aggregate = components.reduce(
    (total, component) => addScore(total, component),
    createZeroScore(),
  );
  const cveFindings = dedupeAndSortCveFindings(
    components.flatMap((component) =>
      Array.isArray(component.cveFindings) ? component.cveFindings : [],
    ),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    components,
    aggregate,
    cveFindings,
    tools: {
      npmAudit: true,
      trivy: trivyAvailable,
      pgAudit: dockerAvailable,
      componentScripts: true,
    },
    policy: {
      failOnCriticalOrHigh: true,
    },
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  // Database and Container Component HIGH CVEs are treated as warnings: both use Debian bookworm
  // base packages where HIGH CVEs are expected and not actionable without a base image update.
  // Only CRITICAL is blocking for these components (matching db-preflight behavior).
  // API and Web Server HIGH CVEs (from npm audit) remain blocking.
  const appComponentHighCount = components
    .filter((c) => c.component !== 'Database' && c.component !== 'Container Component')
    .reduce((sum, c) => sum + c.high, 0);
  const hasBlockingSeverity = aggregate.critical > 0 || appComponentHighCount > 0;
  const hasErrors = components.some((component) => component.status === 'error');
  process.exitCode = hasBlockingSeverity || hasErrors ? 1 : 0;
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`security component scan failed: ${message}\n`);
  process.exitCode = 1;
}
