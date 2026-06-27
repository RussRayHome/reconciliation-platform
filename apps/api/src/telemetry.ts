import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type pino from 'pino';

let telemetrySdk: NodeSDK | undefined;

const parseBooleanFlag = (value: string | undefined): boolean | null => {
  if (value === undefined) {
    return null;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return null;
};

const resolveTraceEndpoint = (value: string): string => {
  if (value.endsWith('/v1/traces')) {
    return value;
  }

  return `${value.replace(/\/$/, '')}/v1/traces`;
};

const isTelemetryEnabled = (): boolean => parseBooleanFlag(process.env.OTEL_ENABLED) === true;

export const startTelemetry = (logger: pino.Logger): void => {
  if (!isTelemetryEnabled() || telemetrySdk) {
    return;
  }

  const endpointEnv =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  const traceExporter = endpointEnv
    ? new OTLPTraceExporter({ url: resolveTraceEndpoint(endpointEnv) })
    : new OTLPTraceExporter();

  telemetrySdk = new NodeSDK({
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  telemetrySdk.start();
  logger.info(
    {
      action: 'telemetry.started',
      endpoint: endpointEnv ? resolveTraceEndpoint(endpointEnv) : 'default',
    },
    'OpenTelemetry tracing started',
  );
};

export const stopTelemetry = async (logger: pino.Logger): Promise<void> => {
  if (!telemetrySdk) {
    return;
  }

  try {
    await telemetrySdk.shutdown();
    logger.info({ action: 'telemetry.stopped' }, 'OpenTelemetry tracing stopped');
  } finally {
    telemetrySdk = undefined;
  }
};
