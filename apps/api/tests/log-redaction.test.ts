import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import request from 'supertest';

import { createApp } from '../src/app';
import { logRedactOptions } from '../src/services/logRedaction';
import { authHeader } from './testHelpers/authToken';

/** Captures every line pino writes to this stream, parsed as JSON. */
const captureLogLines = (): { stream: Writable; lines: () => Record<string, unknown>[] } => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });

  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
};

describe('log redaction (ISSUE-046)', () => {
  it('redacts req.headers.authorization instead of serializing the bearer token verbatim', () => {
    const { stream, lines } = captureLogLines();
    const logger = pino({ redact: logRedactOptions }, stream);

    logger.info(
      { req: { headers: { authorization: 'Bearer super-secret-jwt-value' } } },
      'request received',
    );

    const [line] = lines();
    const req = line?.req as { headers: { authorization: string } };
    expect(req.headers.authorization).toBe('[Redacted]');

    // The whole point: prove the raw value never reaches serialized output, not just that the
    // key we expected to be redacted was redacted.
    const raw = JSON.stringify(line);
    expect(raw).not.toContain('super-secret-jwt-value');
  });

  it('redacts req.headers.cookie and res.headers["set-cookie"]', () => {
    const { stream, lines } = captureLogLines();
    const logger = pino({ redact: logRedactOptions }, stream);

    logger.info(
      {
        req: { headers: { cookie: 'session=abc123' } },
        res: { headers: { 'set-cookie': 'session=abc123; HttpOnly' } },
      },
      'request completed',
    );

    const [line] = lines();
    expect(JSON.stringify(line)).not.toContain('abc123');
  });

  it('redacts bare top-level password/token/secret fields', () => {
    const { stream, lines } = captureLogLines();
    const logger = pino({ redact: logRedactOptions }, stream);

    logger.info(
      { password: 'hunter2', token: 'abc.def.ghi', secret: 'shh' },
      'should never happen, but if it does, still redacted',
    );

    const [line] = lines();
    expect(line?.password).toBe('[Redacted]');
    expect(line?.token).toBe('[Redacted]');
    expect(line?.secret).toBe('[Redacted]');
  });

  it('never writes the real bearer token to stdout across a live authenticated request', async () => {
    // createApp() builds its own internal httpLogger writing to process.stdout (no injectable
    // stream) -- this is the actual code path pino-http's default req serializer runs through,
    // so intercepting stdout here proves the fix end-to-end, not just that logRedactOptions is
    // internally consistent with itself.
    const written: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(chunk.toString());
        return true;
      });

    const app = createApp();
    const header = authHeader();
    const response = await request(app).get('/api/mapping/canonical-fields').set(header);

    stdoutSpy.mockRestore();

    expect(response.status).toBe(200);
    const rawToken = header.Authorization.replace('Bearer ', '');
    expect(written.join('')).not.toContain(rawToken);
  });
});
