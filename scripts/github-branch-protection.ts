/**
 * Applies required GitHub branch-protection rules (status checks, review requirements,
 * linear history) to the configured repository's branch via the GitHub CLI (`gh`) -- defaults to
 * `dev`, this repo's actual protected integration branch (`main` has never been protected here).
 * Invoked via `npm run github:protect-main`; pass `--branch main` explicitly for that branch.
 */
import { execFileSync } from 'node:child_process';

type CliOptions = {
  repo?: string;
  branch: string;
  dryRun: boolean;
};

type BranchProtectionResponse = {
  required_status_checks?: {
    strict?: boolean;
    contexts?: string[];
  } | null;
};

type ParsedFlagValue = {
  value: string;
  nextIndex: number;
};

type CommandResult = {
  ok: boolean;
  statusCode: number;
  stdout: string;
  stderr: string;
};

// Drift review finding: this array and the --branch default below had drifted from reality --
// `main` has never actually been protected (confirmed via `gh api repos/.../branches/main/
// protection` returning 404), and the branch that IS protected (`dev`) was configured through
// some other means, with a required-checks list this script didn't match either in content (6
// checks missing: the 4 e2e-functional shards, visual-path-check, e2e-visual) or in format (bare
// job/matrix names like "test", not "Docker Validate / test" -- confirmed via `gh api repos/.../
// branches/dev/protection`). Synced to match live reality plus the new `postgres` job (drift
// review finding #02).
const requiredChecks = [
  'test',
  'postgres',
  'security-scan',
  'docker-validate',
  'e2e-functional (1)',
  'e2e-functional (2)',
  'e2e-functional (3)',
  'e2e-functional (4)',
  'visual-path-check',
  // e2e-visual is deliberately NOT here (decided 2026-09-12, #509). It is a soak signal on PRs --
  // `continue-on-error: true` in docker-validate.yml -- and Dev Guard gates it on every push to
  // dev with no continue-on-error, because dev is the last boundary before Stage.
  //
  // It WAS in this array, but not by decision: the drift-review note above records that this list
  // was "synced to match live reality", and e2e-visual came along with that sync. The result was a
  // check that blocked merges while its own workflow comment said it could not, and whose failure
  // left the Actions run reading green. Removing it restores the documented design and makes the
  // continue-on-error honest again -- a non-required job that reads neutral is what that flag is
  // for.
  //
  // Worth revisiting once #497's visual flake is fixed: with a low flake rate, gating on PRs is
  // the stronger position.
];

const usage = [
  'Usage: tsx scripts/github-branch-protection.ts [--repo owner/repo] [--branch dev] [--dry-run]',
  '',
  'Examples:',
  '  tsx scripts/github-branch-protection.ts',
  '  tsx scripts/github-branch-protection.ts --repo octo-org/reconciliation-platform --branch dev',
  '  tsx scripts/github-branch-protection.ts --dry-run',
].join('\n');

const toString = (value: string | Buffer | undefined): string =>
  typeof value === 'string' ? value : (value?.toString() ?? '');

const runCommand = (command: string, args: string[], input?: string): CommandResult => {
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: 'pipe',
      input,
    });

    return {
      ok: true,
      statusCode: 0,
      stdout,
      stderr: '',
    };
  } catch (error) {
    const failure = error as Error & {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };

    return {
      ok: false,
      statusCode: failure.status ?? 1,
      stdout: toString(failure.stdout),
      stderr: toString(failure.stderr),
    };
  }
};

const parseJson = <T>(value: string, context: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Unable to parse JSON output from ${context}.`);
  }
};

const parseRepoFromRemote = (remoteUrl: string): string | null => {
  const normalized = remoteUrl.trim();
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(normalized);
  if (!match) {
    return null;
  }

  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) {
    return null;
  }

  return `${owner}/${repo}`;
};

const normalizeRepo = (value: string): string => {
  const trimmed = value.trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
    throw new Error(`Invalid repository value "${value}". Expected owner/repo.`);
  }

  return trimmed;
};

const resolveRepo = (explicitRepo?: string): string => {
  if (explicitRepo) {
    return normalizeRepo(explicitRepo);
  }

  const envRepo = process.env.GITHUB_REPOSITORY;
  if (envRepo && /^[^/\s]+\/[^/\s]+$/.test(envRepo.trim())) {
    return normalizeRepo(envRepo);
  }

  const remote = runCommand('git', ['config', '--get', 'remote.origin.url']);
  if (remote.ok) {
    const parsed = parseRepoFromRemote(remote.stdout);
    if (parsed) {
      return parsed;
    }
  }

  throw new Error('Unable to resolve repository. Pass --repo owner/repo or set GITHUB_REPOSITORY.');
};

const printUsageAndExit = (): never => {
  console.log(usage);
  process.exit(0);
};

const parseFlagValue = (
  token: string,
  key: 'repo' | 'branch',
  argv: string[],
  index: number,
): ParsedFlagValue | null => {
  const equalsPrefix = `--${key}=`;
  if (token.startsWith(equalsPrefix)) {
    const value = token.slice(equalsPrefix.length);
    if (!value) {
      throw new Error(`Missing value for --${key}.`);
    }

    return {
      value,
      nextIndex: index + 1,
    };
  }

  if (token !== `--${key}`) {
    return null;
  }

  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for --${key}.`);
  }

  return {
    value,
    nextIndex: index + 2,
  };
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    // dev is this repo's actual protected integration branch -- main has never been protected
    // (see the requiredChecks comment above). Pass --branch main explicitly if that ever changes.
    branch: 'dev',
    dryRun: false,
  };

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token) {
      index += 1;
      continue;
    }

    if (token === '--help' || token === '-h') {
      printUsageAndExit();
    }

    if (token === '--dry-run') {
      options.dryRun = true;
      index += 1;
      continue;
    }

    const repoFlag = parseFlagValue(token, 'repo', argv, index);
    if (repoFlag) {
      options.repo = repoFlag.value;
      index = repoFlag.nextIndex;
      continue;
    }

    const branchFlag = parseFlagValue(token, 'branch', argv, index);
    if (branchFlag) {
      options.branch = branchFlag.value;
      index = branchFlag.nextIndex;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
};

const ensureGithubCliReady = (): void => {
  const ghVersion = runCommand('gh', ['--version']);
  if (!ghVersion.ok) {
    throw new Error('GitHub CLI (gh) is required. Install it first, then re-run this command.');
  }

  const authStatus = runCommand('gh', ['auth', 'status']);
  if (!authStatus.ok) {
    throw new Error('GitHub CLI is not authenticated. Run "gh auth login" and try again.');
  }
};

const runGhApi = (
  method: 'GET' | 'PATCH' | 'PUT',
  endpoint: string,
  payload?: unknown,
): CommandResult => {
  const args = ['api', '--method', method, endpoint];
  const input = payload === undefined ? undefined : JSON.stringify(payload);

  if (input !== undefined) {
    args.push('--input', '-');
  }

  return runCommand('gh', args, input);
};

const isNotFound = (result: CommandResult): boolean => {
  const output = `${result.stdout}\n${result.stderr}`;
  return /404|not\s+found|branch\s+not\s+protected/i.test(output);
};

const getExistingProtection = (repo: string, branch: string): BranchProtectionResponse | null => {
  const endpoint = `/repos/${repo}/branches/${branch}/protection`;
  const response = runGhApi('GET', endpoint);

  if (!response.ok && isNotFound(response)) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to read branch protection for ${repo}@${branch}.\n${response.stderr || response.stdout}`,
    );
  }

  return parseJson<BranchProtectionResponse>(response.stdout, 'gh api GET branch protection');
};

/**
 * ADDITIVE ONLY -- this adds any required check missing from live protection and NEVER removes one.
 *
 * So editing `requiredChecks` alone cannot un-require a check: dropping an entry here is a no-op,
 * and the dry-run keeps printing it because it prints the MERGED set, not the intended one. That
 * cost a confused minute during #509 -- `e2e-visual` was removed from the array and the dry-run
 * still listed it, which reads like the edit failed.
 *
 * Removal is therefore a deliberate API call, not a config edit:
 *
 *   gh api -X PATCH repos/<owner>/<repo>/branches/dev/protection/required_status_checks \
 *     --input <json with the desired contexts>
 *
 * Kept additive on purpose. A replace-everything sync would silently drop any check added outside
 * this file, and the drift note above records that this list has already been behind live reality
 * once.
 */
const mergeContexts = (current: string[] | undefined): string[] => {
  const merged = [...(current ?? [])];
  for (const check of requiredChecks) {
    if (!merged.includes(check)) {
      merged.push(check);
    }
  }

  return merged;
};

const applyProtection = (repo: string, branch: string, dryRun: boolean): void => {
  const existing = getExistingProtection(repo, branch);
  const mergedContexts = mergeContexts(existing?.required_status_checks?.contexts);
  const strict = true;

  if (dryRun) {
    console.log('Dry run: no changes were sent to GitHub.');
    console.log(`Repository: ${repo}`);
    console.log(`Branch: ${branch}`);
    console.log(`Strict status checks: ${strict}`);
    console.log('Required checks:');
    for (const context of mergedContexts) {
      console.log(`- ${context}`);
    }

    if (existing) {
      console.log('Existing branch protection: found (will PATCH required_status_checks).');
    } else {
      console.log('Existing branch protection: not found (will PUT baseline protection).');
    }

    return;
  }

  if (existing) {
    const endpoint = `/repos/${repo}/branches/${branch}/protection/required_status_checks`;
    const payload = {
      strict,
      contexts: mergedContexts,
    };
    const response = runGhApi('PATCH', endpoint, payload);

    if (!response.ok) {
      throw new Error(
        `Failed to update required status checks for ${repo}@${branch}.\n${response.stderr || response.stdout}`,
      );
    }

    console.log(`Updated required status checks for ${repo}@${branch}.`);
    console.log('Required checks now include:');
    for (const context of mergedContexts) {
      console.log(`- ${context}`);
    }

    return;
  }

  const endpoint = `/repos/${repo}/branches/${branch}/protection`;
  const payload = {
    required_status_checks: {
      strict,
      contexts: mergedContexts,
    },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
  };
  const response = runGhApi('PUT', endpoint, payload);

  if (!response.ok) {
    throw new Error(
      `Failed to create branch protection for ${repo}@${branch}.\n${response.stderr || response.stdout}`,
    );
  }

  console.log(`Created baseline branch protection for ${repo}@${branch}.`);
  console.log('Required checks set to:');
  for (const context of mergedContexts) {
    console.log(`- ${context}`);
  }
};

const main = (): void => {
  try {
    const options = parseArgs(process.argv.slice(2));
    const repo = resolveRepo(options.repo);

    ensureGithubCliReady();
    applyProtection(repo, options.branch, options.dryRun);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(message);
    console.error('');
    console.error(usage);
    process.exit(1);
  }
};

main();
