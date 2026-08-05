/**
 * Reads the published dashboard-status/<env>.json off the status-data branch -- this app never
 * executes checks or writes to the repo, it only reads what GitHub Actions already published (see
 * .github/workflows/dashboard-status.yml). Uses the Contents API with the raw media type rather
 * than raw.githubusercontent.com so a private repo works the same as a public one, with a single
 * read-only token.
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

export const fetchLatestStatus = async (config: StatusStoreConfig): Promise<unknown> => {
  const path = `dashboard-status/${config.env}.json`;
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}?ref=status-data`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'developer-dashboard-api',
    },
  });

  if (response.status === 404) {
    throw new Error(`No published status yet at ${path} on status-data -- has the nightly workflow run?`);
  }
  if (!response.ok) {
    throw new Error(`Fetching ${path} from status-data failed with status ${response.status}.`);
  }

  return response.json();
};
