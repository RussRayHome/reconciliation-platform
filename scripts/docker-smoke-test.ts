import { runDockerCompose } from './docker-runtime';

const smokeProjectName = process.env.COMPOSE_PROJECT_NAME ?? `reconciliation-smoke-${Date.now()}`;
const smokeWebPort = process.env.PUBLIC_WEB_PORT ?? '4273';

process.env.COMPOSE_PROJECT_NAME = smokeProjectName;
process.env.PUBLIC_WEB_PORT = smokeWebPort;

const waitForHttp = async (url: string, timeoutMs: number): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for ${url}`);
};

const main = async (): Promise<void> => {
  await runDockerCompose(['up', '-d', '--build']);

  try {
    await waitForHttp(`http://127.0.0.1:${smokeWebPort}/healthz`, 120000);
    await waitForHttp(`http://127.0.0.1:${smokeWebPort}/api/health`, 120000);
    await waitForHttp(`http://127.0.0.1:${smokeWebPort}/`, 120000);
  } finally {
    await runDockerCompose(['down', '--remove-orphans', '--volumes']);
  }
};

await main();
