/**
 * Hand-rolled GitHub OAuth App login flow (authorize -> code -> access token -> user identity).
 * No passport/OAuth library: this app only ever needs "who is this person," never acts on the
 * user's behalf against the GitHub API, so the two-request exchange is the entire surface area.
 */
export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export const resolveGitHubOAuthConfig = (): GitHubOAuthConfig => {
  const clientId = process.env.DASHBOARD_GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.DASHBOARD_GITHUB_CLIENT_SECRET?.trim();
  const callbackUrl = process.env.DASHBOARD_GITHUB_CALLBACK_URL?.trim();

  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error(
      'DASHBOARD_GITHUB_CLIENT_ID, DASHBOARD_GITHUB_CLIENT_SECRET, and DASHBOARD_GITHUB_CALLBACK_URL must all be set.',
    );
  }

  return { clientId, clientSecret, callbackUrl };
};

export const buildAuthorizeUrl = (config: GitHubOAuthConfig, state: string): string => {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  return url.toString();
};

export const exchangeCodeForAccessToken = async (
  config: GitHubOAuthConfig,
  code: string,
): Promise<string> => {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { access_token?: string; error?: string };
  if (!payload.access_token) {
    throw new Error(`GitHub token exchange returned no access_token (error: ${payload.error ?? 'unknown'}).`);
  }

  return payload.access_token;
};

export const fetchGitHubUser = async (accessToken: string): Promise<GitHubUser> => {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'developer-dashboard-api',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub user lookup failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { login: string; name: string | null; avatar_url: string | null };
  return { login: payload.login, name: payload.name, avatarUrl: payload.avatar_url };
};

/** Comma-separated GitHub logins allowed to sign in -- everyone else authenticates fine against
 *  GitHub but gets a 403 from the callback. Case-insensitive since GitHub logins are. */
export const isAllowedGitHubUser = (login: string): boolean => {
  const allowlist = (process.env.DASHBOARD_ALLOWED_GITHUB_LOGINS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (allowlist.length === 0) {
    return false;
  }

  return allowlist.includes(login.toLowerCase());
};
