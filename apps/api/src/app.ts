import { InMemoryRunRepository } from './services/runRepository';
import type { ReconciliationRun } from '@recon/domain';
import cors from 'cors';
import { executeReconciliation } from './services/reconciliationService';
import express from 'express';
import multer from 'multer';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';

const acceptedMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

type UploadFileMap = {
  bankFile?: Express.Multer.File[];
  qboFile?: Express.Multer.File[];
};

const resolveCorrelationId = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  return randomUUID();
};

const createUploadMiddleware = (maxUploadMb: number) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024 },
    fileFilter: (_request, file, callback) => {
      const allowed =
        acceptedMimeTypes.has(file.mimetype) || file.originalname.toLowerCase().endsWith('.xlsx');
      if (!allowed) {
        callback(new Error('Only .xlsx files are accepted.'));
        return;
      }

      callback(null, true);
    },
  });

const sanitizeRun = (run: ReconciliationRun) => ({
  ...run,
  outputWorkbook: run.outputWorkbook
    ? {
        fileName: run.outputWorkbook.fileName,
        generatedAt: run.outputWorkbook.generatedAt,
        tabNames: run.outputWorkbook.tabNames,
      }
    : undefined,
});

const resolveUploadErrorStatus = (error: unknown): number => {
  if (error instanceof multer.MulterError) {
    return error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  }

  if (error instanceof Error && error.message === 'Only .xlsx files are accepted.') {
    return 400;
  }

  return 500;
};

export const createApp = (repository = new InMemoryRunRepository()) => {
  const app = express();
  const upload = createUploadMiddleware(Number(process.env.MAX_UPLOAD_MB ?? '10'));

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      genReqId: (request) => request.headers['x-correlation-id']?.toString() ?? randomUUID(),
      quietReqLogger: false,
      // Log full error detail including stack trace for 4xx/5xx responses
      customErrorMessage: (_request, response) =>
        `request failed with status ${response.statusCode}`,
      customReceivedMessage: (request) =>
        `request received: ${request.method} ${request.url}`,
      customSuccessMessage: (_request, response) =>
        `request completed with status ${response.statusCode}`,
      serializers: {
        err: (err: unknown) => {
          if (err instanceof Error) {
            return { type: err.constructor.name, message: err.message, stack: err.stack };
          }
          return err;
        },
      },
    }),
  );

  app.use((request, response, next) => {
    response.setHeader('x-correlation-id', resolveCorrelationId(request.id));
    next();
  });

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post(
    '/api/reconciliation/run',
    upload.fields([
      { name: 'bankFile', maxCount: 1 },
      { name: 'qboFile', maxCount: 1 },
    ]),
    async (request, response, next) => {
      try {
        const files = (request.files ?? {}) as UploadFileMap;
        const bankFile = files?.bankFile?.[0];
        const qboFile = files?.qboFile?.[0];

        if (!bankFile || !qboFile) {
          response.status(400).json({
            message: 'Both bankFile and qboFile must be provided as .xlsx uploads.',
          });
          return;
        }

        const body = (request.body ?? {}) as Record<string, unknown>;
        const accountIdentifier = typeof body.accountIdentifier === 'string'
          ? body.accountIdentifier
          : undefined;
        const periodLabel = typeof body.periodLabel === 'string' ? body.periodLabel : undefined;
        const correlationId = resolveCorrelationId(request.id);

        request.log.info({ action: 'reconciliation.run.received', accountIdentifier, periodLabel });

        const run = await executeReconciliation({
          correlationId,
          bankFile,
          qboFile,
          accountIdentifier,
          periodLabel,
        });

        repository.save(run);
        request.log.info({
          action: 'reconciliation.run.completed',
          runId: run.id,
          exceptions: run.exceptions.length,
        });

        response.status(201).json(sanitizeRun(run));
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/api/reconciliation/:id', (request, response) => {
    const run = repository.findById(request.params.id);
    if (!run) {
      response.status(404).json({ message: 'Reconciliation run not found.' });
      return;
    }

    response.json(sanitizeRun(run));
  });

  app.get('/api/reconciliation/:id/summary', (request, response) => {
    const run = repository.findById(request.params.id);
    if (!run) {
      response.status(404).json({ message: 'Reconciliation run not found.' });
      return;
    }

    response.json(run.summary);
  });

  app.get('/api/reconciliation/:id/exceptions', (request, response) => {
    const run = repository.findById(request.params.id);
    if (!run) {
      response.status(404).json({ message: 'Reconciliation run not found.' });
      return;
    }

    response.json(run.exceptions);
  });

  app.get('/api/reconciliation/:id/export/workbook', (request, response) => {
    const run = repository.findById(request.params.id);
    if (!run?.outputWorkbook) {
      response.status(404).json({ message: 'Workbook export is not available for this run.' });
      return;
    }

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${run.outputWorkbook.fileName}"`,
    );
    response.send(Buffer.from(run.outputWorkbook.binary));
  });

  app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    const stack = error instanceof Error ? error.stack : undefined;
    const statusCode = resolveUploadErrorStatus(error);

    request.log.error({ action: 'api.unhandled.error', statusCode, err: { message, stack } });
    response.status(statusCode).json({ message });
  });

  return app;
};
