import { routePaths } from '../routes/routePaths';

export const readEnvString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

// A single-segment path (e.g. "/dev") is inferred as the environment prefix unless it's actually
// one of the app's own top-level routes (e.g. "/login") -- otherwise those routes would be
// misread as environment prefixes on a deployment with no VITE_ENVIRONMENT_PATH_SEGMENT set.
const knownTopLevelRouteSegments = new Set([
  'docs',
  ...Object.values(routePaths).map((path) => path.replace(/^\//, '')),
]);

export type EnvironmentPaths = {
  activeEnvironmentPathSegment: string;
  docsHref: string;
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

  const nestedRouteEnvironmentPathSegment =
    /^\/([A-Za-z0-9_-]+)\/docs(?:\/|$)/.exec(pathname)?.[1] ?? '';
  const rootRouteEnvironmentPathSegment = /^\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)?.[1] ?? '';
  const routeEnvironmentPathSegment =
    nestedRouteEnvironmentPathSegment ||
    (knownTopLevelRouteSegments.has(rootRouteEnvironmentPathSegment.toLowerCase())
      ? ''
      : rootRouteEnvironmentPathSegment);

  const pathnameAlreadyOnConfiguredSegment =
    pathname === `/${configuredEnvironmentPathSegment}` ||
    pathname.startsWith(`/${configuredEnvironmentPathSegment}/`);

  // A pathname with no environment segment of its own -- bare `/`, or a real app route hit
  // directly (e.g. `/export`, `/mapping/create`) -- gets rewritten onto the configured
  // environment segment before the router (or anything else) reads location.pathname. This used
  // to only cover the bare `/` case: any other direct load or deep link ended up with a basename
  // (e.g. `/dev`) that never matched the un-rewritten URL, so BrowserRouter matched nothing and
  // the app rendered blank. Originally scoped to the literal segment `dev`, which silently left
  // every other environment-prefixed deployment (e.g. `stage`) with the same blank-page bug this
  // was written to fix -- generalized to any configured segment.
  if (
    !routeEnvironmentPathSegment &&
    !pathnameAlreadyOnConfiguredSegment &&
    configuredEnvironmentPathSegment !== ''
  ) {
    const developmentAppPath =
      pathname === '/'
        ? `/${configuredEnvironmentPathSegment}`
        : `/${configuredEnvironmentPathSegment}${pathname}`;

    globalThis.history.replaceState(globalThis.history.state, '', developmentAppPath);
    pathname = developmentAppPath;
  }

  const activeEnvironmentPathSegment =
    routeEnvironmentPathSegment || configuredEnvironmentPathSegment;
  const docsHref = activeEnvironmentPathSegment ? `/${activeEnvironmentPathSegment}/docs` : '/docs';
  const appHref = activeEnvironmentPathSegment ? `/${activeEnvironmentPathSegment}` : '/';
  const isDocsRoute =
    pathname === '/docs' ||
    pathname.startsWith('/docs/') ||
    /^\/[A-Za-z0-9_-]+\/docs(?:\/|$)/.test(pathname);

  return { activeEnvironmentPathSegment, docsHref, appHref, isDocsRoute };
}
