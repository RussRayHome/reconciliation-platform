import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const otelState = vi.hoisted(() => ({
  start: vi.fn(),
  shutdown: vi.fn(() => Promise.resolve()),
  exporterCtor: vi.fn(),
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn().mockImplementation(function () {
    return {
      start: otelState.start,
      shutdown: otelState.shutdown,
    };
  }),
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: vi.fn().mockImplementation(function (options?: unknown) {
    otelState.exporterCtor(options);
    return { options };
  }),
}));

vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: vi.fn(() => []),
}));

describe('api telemetry', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    otelState.start.mockReset();
    otelState.shutdown.mockReset();
    otelState.shutdown.mockResolvedValue(undefined);
    otelState.exporterCtor.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not start the SDK when OTEL_ENABLED is unset', async () => {
    delete process.env.OTEL_ENABLED;
    const logger = { info: vi.fn() };

    const module = await import('../src/telemetry');
    module.startTelemetry(logger as never);

    expect(otelState.start).not.toHaveBeenCalled();
  });

  it('does not start the SDK when OTEL_ENABLED is not exactly "true"', async () => {
    process.env.OTEL_ENABLED = 'yes';
    const logger = { info: vi.fn() };

    const module = await import('../src/telemetry');
    module.startTelemetry(logger as never);

    expect(otelState.start).not.toHaveBeenCalled();
  });

  it('starts the SDK once with a default exporter when no endpoint is configured', async () => {
    process.env.OTEL_ENABLED = 'true';
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const logger = { info: vi.fn() };

    const module = await import('../src/telemetry');
    module.startTelemetry(logger as never);
    module.startTelemetry(logger as never); // second call is a no-op -- already started

    expect(otelState.start).toHaveBeenCalledTimes(1);
    expect(otelState.exporterCtor).toHaveBeenCalledWith(undefined);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'telemetry.started', endpoint: 'default' }),
      'OpenTelemetry tracing started',
    );
  });

  it('appends /v1/traces to a configured endpoint that lacks it, and trims a trailing slash first', async () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'https://collector.example.com/';
    const logger = { info: vi.fn() };

    const module = await import('../src/telemetry');
    module.startTelemetry(logger as never);

    expect(otelState.exporterCtor).toHaveBeenCalledWith({
      url: 'https://collector.example.com/v1/traces',
    });
  });

  it('leaves an endpoint that already ends with /v1/traces untouched', async () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://collector.example.com/v1/traces';
    const logger = { info: vi.fn() };

    const module = await import('../src/telemetry');
    module.startTelemetry(logger as never);

    expect(otelState.exporterCtor).toHaveBeenCalledWith({
      url: 'https://collector.example.com/v1/traces',
    });
  });

  it('does nothing on stop when the SDK was never started', async () => {
    const logger = { info: vi.fn() };
    const module = await import('../src/telemetry');
    await expect(module.stopTelemetry(logger as never)).resolves.toBeUndefined();
    expect(otelState.shutdown).not.toHaveBeenCalled();
  });

  it('shuts the SDK down and clears state so a later start can begin again', async () => {
    process.env.OTEL_ENABLED = 'true';
    const logger = { info: vi.fn() };
    const module = await import('../src/telemetry');

    module.startTelemetry(logger as never);
    await module.stopTelemetry(logger as never);

    expect(otelState.shutdown).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ action: 'telemetry.stopped' }, 'OpenTelemetry tracing stopped');
  });
});
