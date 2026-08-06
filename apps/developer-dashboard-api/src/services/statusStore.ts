/**
 * Reads the published dashboard-status/<env>.json off the status-data branch, and its git commit
 * history on that one path -- this app never executes checks or writes to the repo, it only reads
 * what GitHub Actions already published (see .github/workflows/dashboard-status.yml). Uses the
 * Contents API with the raw media type rather than raw.githubusercontent.com so a private repo
 * works the same as a public one, with a single read-only token.
 */
export interface StatusStoreConfig {
  owner: string;
  repo: string;
  token: string;
  env: string;
}

export const resolveStatusStoreConfig = (): StatusStoreConfig => {
  const repoSlug = process.env.DASHBOARD_STATUS_REPO?.trim();
  const token = process.env.DASHBOARD_STATUS_READ_TOKEN?.trim();
  const env = process.env.DASHBOARD_ENV?.trim();

  if (!repoSlug || !repoSlug.includes('/')) {
    throw new Error('DASHBOARD_STATUS_REPO must be set as "owner/repo".');
  }
  if (!token) {
    throw new Error('DASHBOARD_STATUS_READ_TOKEN must be set (contents:read is sufficient).');
  }
  if (!env) {
    throw new Error('DASHBOARD_ENV must be set to "dev" or "stage" -- this deployment reads exactly one.');
  }

  const [owner, repo] = repoSlug.split('/');
  return { owner: owner as string, repo: repo as string, token, env };
};

const statusPath = (env: string): string => `dashboard-status/${env}.json`;

/** Fetches the status JSON as of a specific ref (branch name or commit SHA) -- the Contents API
 *  accepts either. fetchLatestStatus below is just this called with the branch tip. */
export const fetchStatusAtRef = async (config: StatusStoreConfig, ref: string): Promise<unknown> => {
  const path = statusPath(config.env);
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}?ref=${ref}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'developer-dashboard-api',
    },
  });

  if (response.status === 404) {
    throw new Error(`No published status at ${path}@${ref} -- has the nightly workflow run?`);
  }
  if (!response.ok) {
    throw new Error(`Fetching ${path}@${ref} failed with status ${response.status}.`);
  }

  return response.json();
};

export const fetchLatestStatus = (config: StatusStoreConfig): Promise<unknown> =>
  fetchStatusAtRef(config, 'status-data');

export type StatusCommit = { sha: string; committedAt: string };

/**
 * Lists the most recent commits that touched dashboard-status/<env>.json on status-data, newest
 * first -- the publish job (dashboard-status.yml) skips committing when nothing changed, so this
 * is exactly the set of nights a real run happened, not just a scheduling cadence to assume. Used
 * by secretScanHistorySync.ts to backfill any run Postgres doesn't have a snapshot for yet,
 * independent of how often anyone actually has the dashboard open.
 */
export const listRecentStatusCommits = async (
  config: StatusStoreConfig,
  limit = 20,
): Promise<StatusCommit[]> => {
  const path = statusPath(config.env);
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/commits?path=${encodeURIComponent(path)}&sha=status-data&per_page=${limit}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'developer-dashboard-api',
    },
  });

  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Listing commits for ${path} on status-data failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as Array<{
    sha: string;
    commit?: { committer?: { date?: string }; author?: { date?: string } };
  }>;

  return payload
    .map((entry) => ({
      sha: entry.sha,
      committedAt: entry.commit?.committer?.date ?? entry.commit?.author?.date ?? new Date(0).toISOString(),
    }))
    .filter((entry) => Boolean(entry.sha));
};
