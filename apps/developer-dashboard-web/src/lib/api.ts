/** dashboard-api runs on its own origin (separate app, separate port) -- every request needs
 *  credentials: 'include' so the httpOnly session cookie set by the OAuth callback is sent. */
const API_BASE_URL = import.meta.env.VITE_DASHBOARD_API_BASE_URL ?? 'http://127.0.0.1:4500';

export const dashboardApiFetch = (path: string, init?: RequestInit): Promise<Response> =>
  fetch(`${API_BASE_URL}${path}`, { ...init, credentials: 'include' });

export const githubLoginUrl = (): string => `${API_BASE_URL}/api/auth/github/login`;
