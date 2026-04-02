import { createApp } from './app';
import { createWriteStream } from 'node:fs';
import pino from 'pino';

export const startServer = (): void => {
  const isProduction = process.env.NODE_ENV === 'production';
  const logFile = process.env.LOG_FILE;
  const level = (process.env.LOG_LEVEL ?? 'info') as pino.Level;

  // Build a multistream that goes to:
  //   1. stdout   – pretty in dev, raw JSON in production
  //   2. log file – always raw newline-delimited JSON when LOG_FILE is set
  const streams: pino.StreamEntry[] = [];

  if (isProduction) {
    streams.push({ level, stream: process.stdout });
  } else {
    // pino.transport returns a writable stream backed by a worker thread
    const prettyStream = pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    }) as pino.DestinationStream;
    streams.push({
      level,
      stream: prettyStream,
    });
  }

  if (logFile) {
    streams.push({ level: 'debug', stream: createWriteStream(logFile, { flags: 'a' }) });
  }

  const logger = pino({ level }, pino.multistream(streams));

  const app = createApp();
  const port = Number(process.env.PORT ?? '4000');

  app.listen(port, '0.0.0.0', () => {
    logger.info({ port, logFile: logFile ?? null, level }, 'Reconciliation API listening');
  });
};
