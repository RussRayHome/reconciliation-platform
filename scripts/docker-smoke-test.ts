import https from 'node:https';
import { runDockerCompose } from './docker-runtime';

const smokeProjectName = process.env.COMPOSE_PROJECT_NAME ?? `reconciliation-smoke-${Date.now()}`;
const smokeWebHttpsPort = process.env.PUBLIC_WEB_HTTPS_PORT ?? '4374';

process.env.COMPOSE_PROJECT_NAME = smokeProjectName;
process.env.PUBLIC_WEB_HTTPS_PORT = smokeWebHttpsPort;

// The web image bakes in a throwaway self-signed cert (apps/web/Dockerfile) precisely so a bare
// `-f compose.yaml` run like this one works without a dev-only cert volume mount -- but that
// means this check must not validate it as a real CA-issued cert. `fetch`'s TLS behavior isn't
// overridable per-call without pulling in undici directly, so this uses `node:https` instead, no
// extra dependency required.
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

const main = async (): Promise<void> => {
  await runDockerCompose(['up', '-d', '--build']);

  try {
    await waitForHttps(`https://127.0.0.1:${smokeWebHttpsPort}/healthz`, 120000);
    await waitForHttps(`https://127.0.0.1:${smokeWebHttpsPort}/api/health`, 120000);
    await waitForHttps(`https://127.0.0.1:${smokeWebHttpsPort}/`, 120000);
  } finally {
    await runDockerCompose(['down', '--remove-orphans', '--volumes']);
  }
};

await main();
