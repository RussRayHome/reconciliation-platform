export const readEnvString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export type EnvironmentPaths = {
  activeEnvironmentPathSegment: string;
  docsHref: string;
  developerDashboardHref: string;
  appHref: string;
  isDocsRoute: boolean;
};

/**
 * Derives environment-prefixed hrefs (e.g. `/dev/docs`) from the configured
 * `VITE_ENVIRONMENT_PATH_SEGMENT` and/or the current pathname, and rewrites a bare `/`
 * load to the configured dev segment before anything else (router included) reads
 * `location.pathname`. Both the router's `basename` and any hand-built href must derive
 * from this same function or environment-prefixed deployments will silently diverge.
 */
export function resolveEnvironmentPaths(env: Record<string, unknown>): EnvironmentPaths {
  let pathname = globalThis.location.pathname;
  const configuredEnvironmentPathSegment = (readEnvString(env.VITE_ENVIRONMENT_PATH_SEGMENT) ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  if (pathname === '/' && configuredEnvironmentPathSegment.toLowerCase() === 'dev') {
    const developmentAppPath = `/${configuredEnvironmentPathSegment}`;

    globalThis.history.replaceState(globalThis.history.state, '', developmentAppPath);
    pathname = developmentAppPath;
  }

  const nestedRouteEnvironmentPathSegment =
    /^\/([A-Za-z0-9_-]+)\/(?:docs(?:\/|$)|developer-dashboard\.html$)/.exec(pathname)?.[1] ?? '';
  const rootRouteEnvironmentPathSegment = /^\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)?.[1] ?? '';
  const routeEnvironmentPathSegment =
    nestedRouteEnvironmentPathSegment ||
    (rootRouteEnvironmentPathSegment.toLowerCase() === 'docs'
      ? ''
      : rootRouteEnvironmentPathSegment);
  const activeEnvironmentPathSegment =
    routeEnvironmentPathSegment || configuredEnvironmentPathSegment;
  const docsHref = activeEnvironmentPathSegment ? `/${activeEnvironmentPathSegment}/docs` : '/docs';
  const developerDashboardHref = activeEnvironmentPathSegment
    ? `/${activeEnvironmentPathSegment}/developer-dashboard.html`
    : '/developer-dashboard.html';
  const appHref = activeEnvironmentPathSegment ? `/${activeEnvironmentPathSegment}` : '/';
  const isDocsRoute =
    pathname === '/docs' ||
    pathname.startsWith('/docs/') ||
    /^\/[A-Za-z0-9_-]+\/docs(?:\/|$)/.test(pathname);

  return { activeEnvironmentPathSegment, docsHref, developerDashboardHref, appHref, isDocsRoute };
}
