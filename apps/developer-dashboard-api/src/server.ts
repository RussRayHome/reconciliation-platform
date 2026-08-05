import pino from 'pino';

import { createApp } from './app';

export const startServer = async (): Promise<void> => {
  const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
  const port = Number(process.env.PORT ?? '4500');
  const app = createApp(logger);

  app.listen(port, '0.0.0.0', () => {
    logger.info({ action: 'dashboard_api.started', port }, 'developer-dashboard-api listening');
  });
};
