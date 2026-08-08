import type { LoggerOptions } from 'pino';

/**
 * Pino `redact` config shared by every logger this service constructs (ISSUE-046). Without it,
 * pino-http's default request serializer includes `req.headers.authorization` verbatim -- a full
 * bearer JWT logged on every single request. Confirmed as a live leak, not a hypothetical: it
 * shows up in this repo's own test/dev output whenever a request is logged.
 *
 * `req`/`res` paths cover pino-http's serialized shape; the bare top-level paths are a cheap
 * forward-guard for the app's own structured `{ action, ... }` log calls, in case a future one
 * ever passes a credential field directly rather than through pino-http's request serializer.
 */
export const logRedactOptions: NonNullable<LoggerOptions['redact']> = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'jwt',
    'secret',
  ],
  censor: '[Redacted]',
};
