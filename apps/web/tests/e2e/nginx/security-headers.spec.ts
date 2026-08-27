import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import tls from 'node:tls';
import type { IncomingHttpHeaders } from 'node:http';

import { test, expect } from '@playwright/test';

import { runDockerCompose } from '../../../../../scripts/docker-runtime';

/**
 * Drift review finding (Phase 2, item 4): the functional and visual projects both talk to native
 * dev servers directly (playwright.config.ts's `webServer`), which never goes through nginx at
 * all -- neither can catch a gateway-layer regression (a missing/duplicated security header, a
 * route not actually proxied, the gateway itself failing to enforce auth). This project boots an
 * isolated copy of the full Docker Compose stack (own project name and HTTPS port, so it never
 * collides with a `reconciliation-platform-dev` stack a developer already has running) so these
 * specs hit a real nginx gateway fronting the real API.
 *
 * This is what caught a real, previously-undiscovered bug while this project was being built:
 * nginx.conf used to set its security headers at server{} scope, which every location without its
 * own add_header (the /api/ proxy location included) silently inherited -- every proxied /api/
 * response carried a second, conflicting copy of Content-Security-Policy, Referrer-Policy, and
 * Cross-Origin-Resource-Policy alongside the API's own intentional values. Fixed by moving the
 * static-content-only header set into nginx-security-headers.conf, included explicitly by only
 * `/` and `/assets/`.
 *
 * Mirrors scripts/docker-smoke-test.ts's project-isolation approach (own COMPOSE_PROJECT_NAME and
 * PUBLIC_WEB_HTTPS_PORT) but doesn't reuse it directly -- that script tears the stack down
 * immediately after proving it's reachable, before any test gets a chance to run against it.
 */
let baseUrl: string;
let projectName: string;
let caCert: string;

test.beforeAll(async () => {
  projectName = `reconciliation-nginx-e2e-${Date.now()}`;
  const httpsPort = process.env.NGINX_E2E_HTTPS_PORT ?? '4474';
  baseUrl = `https://127.0.0.1:${httpsPort}`;

  process.env.COMPOSE_PROJECT_NAME = projectName;
  process.env.PUBLIC_WEB_HTTPS_PORT = httpsPort;
  // A distinct COMPOSE_PROJECT_NAME isolates container/network/volume *names*, but Docker still
  // refuses to bind the same *host port* twice regardless of project name -- bare compose.yaml
  // (no dev/stage overlay) publishes exactly two: web's HTTPS port (overridden above) and
  // postgres's. Confirmed live: omitting this collided with an already-running
  // reconciliation-platform-dev stack's postgres on 5432.
  process.env.POSTGRES_HOST_PORT = process.env.NGINX_E2E_POSTGRES_PORT ?? '5532';

  await runDockerCompose(['up', '-d', '--build']);

  const checkHttpsOk = (url: string): Promise<boolean> =>
    new Promise((resolve) => {
      const request = https.get(url, { rejectUnauthorized: false }, (response) => {
        response.resume();
        resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300);
      });
      request.on('error', () => resolve(false));
    });

  const waitForHttps = async (url: string, timeoutMs: number): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await checkHttpsOk(url)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Timed out waiting for ${url}`);
  };

  await waitForHttps(`${baseUrl}/healthz`, 120000);
  await waitForHttps(`${baseUrl}/api/health`, 120000);

  // The web image bakes in its own throwaway self-signed cert at build time
  // (apps/web/Dockerfile) whenever the dev-cert volume isn't mounted, exactly the case here (same
  // as docker-smoke-test.ts) -- extracting it from the running container is what lets the TLS
  // check below use REAL certificate verification (rejectUnauthorized: true against this exact
  // cert as the trusted CA) instead of blanket-disabling verification the way the readiness probe
  // above does. Proves the handshake actually validates against the cert the server is really
  // presenting, not just that some response came back.
  const scratchDir = mkdtempSync(join(tmpdir(), 'nginx-e2e-cert-'));
  const certPath = join(scratchDir, 'dev-cert.pem');
  execFileSync('docker', ['cp', `${projectName}-web-1:/etc/nginx/certs/dev-cert.pem`, certPath]);
  caCert = readFileSync(certPath, 'utf-8');
  rmSync(scratchDir, { recursive: true, force: true });
});

test.afterAll(async () => {
  await runDockerCompose(['down', '--remove-orphans', '--volumes']);
});

/** Node's `https` (not Playwright's own request context, which has no per-call CA override)
 * fetching with real certificate verification against the extracted server cert. */
const fetchVerified = (
  path: string,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> =>
  new Promise((resolve, reject) => {
    const request = https.get(
      `${baseUrl}${path}`,
      { ca: caCert, rejectUnauthorized: true },
      (response) => {
        let body = '';
        response.setEncoding('utf-8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
        );
      },
    );
    request.on('error', reject);
  });

// nginx's own set of security headers (nginx-security-headers.conf) -- used below to assert both
// "present with this exact value" (static locations) and "absent" (proxied locations, where only
// the upstream's own copy should exist). Kept as literal strings rather than reading the .conf
// file so a change to one side has to be a deliberate edit to this test's expectations too.
const NGINX_STATIC_CSP =
  "default-src 'self'; base-uri 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests";
const NGINX_STATIC_REFERRER_POLICY = 'no-referrer-when-downgrade';

/** Node joins genuinely duplicate response header lines with `, ` for every header except
 * set-cookie (confirmed live: this is exactly the shape `Cross-Origin-Resource-Policy:
 * cross-origin` plus nginx's own `same-origin` copy took, "cross-origin, same-origin", a string
 * not an array) -- so an exact-value match against the single expected value is what actually
 * catches a second, appended copy. A plain existence/array-length check would not: Node never
 * returns an array here regardless of how many header lines the server actually sent. */
test.describe('CSP parity across locations', () => {
  test('/ (static) carries nginx\'s own Content-Security-Policy exactly once', async () => {
    const response = await fetchVerified('/');
    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toBe(NGINX_STATIC_CSP);
  });

  test('/assets/ (static, own Cache-Control) carries nginx\'s own Content-Security-Policy exactly once', async () => {
    // Reads the real, hashed asset path out of index.html's own body rather than hardcoding a
    // hash that changes on every build.
    const indexResponse = await fetchVerified('/');
    const scriptMatch = /\/assets\/[\w.-]+\.js/.exec(indexResponse.body);
    expect(scriptMatch, 'index.html did not reference any /assets/*.js file').not.toBeNull();

    const response = await fetchVerified(scriptMatch![0]);
    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toBe(NGINX_STATIC_CSP);
  });

  test('/api/health (proxied) carries only the API\'s own Content-Security-Policy, not nginx\'s too', async () => {
    const response = await fetchVerified('/api/health');
    expect(response.status).toBe(200);
    // Not asserting the API's exact CSP string here -- that's this test's job only incidentally.
    // What matters is that it is NOT nginx's static-content value (present) and does not contain
    // it either (appended alongside the API's own, the shape a reintroduced bug would take).
    expect(response.headers['content-security-policy']).not.toBe(NGINX_STATIC_CSP);
    expect(response.headers['content-security-policy']).not.toContain(NGINX_STATIC_CSP);
    expect(response.headers['referrer-policy']).not.toBe(NGINX_STATIC_REFERRER_POLICY);
    // The API's own value (see apps/api/src/app.ts's helmet-equivalent setup), not nginx's
    // static-content one ('same-origin') -- proves the upstream's header won outright, rather
    // than being folded together with nginx's inherited copy into "cross-origin, same-origin".
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

test.describe('HSTS', () => {
  test('/api/health sets Strict-Transport-Security', async () => {
    const response = await fetchVerified('/api/health');
    expect(response.headers['strict-transport-security']).toMatch(/^max-age=\d+/);
  });
});

test.describe('X-Frame-Options', () => {
  test('/ (static) sets X-Frame-Options: SAMEORIGIN', async () => {
    const response = await fetchVerified('/');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  test('/api/health (proxied) sets X-Frame-Options: SAMEORIGIN', async () => {
    const response = await fetchVerified('/api/health');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});

test.describe('gateway auth enforcement', () => {
  test('a protected API route reached through the gateway 401s without a token', async () => {
    const response = await fetchVerified('/api/reconciliation/latest');
    expect(response.status).toBe(401);
  });
});

test.describe('TLS', () => {
  test('the gateway presents a certificate that verifies against its own CA', async () => {
    const authorized = await new Promise<boolean>((resolve, reject) => {
      const socket = tls.connect(
        { host: '127.0.0.1', port: Number(new URL(baseUrl).port), ca: caCert, rejectUnauthorized: true },
        () => {
          resolve(socket.authorized);
          socket.end();
        },
      );
      socket.on('error', reject);
    });

    expect(authorized).toBe(true);
  });
});
