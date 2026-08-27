import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Application } from 'express';

/**
 * Issue #192/#209: supertest's `request(app)`, given a bare (non-listening) Express app, spins up
 * a brand-new ephemeral `http.createServer().listen(0)` for every single call, closed right after.
 * A full integration run makes hundreds of these in quick succession across many files, which is
 * a plausible setup for OS-level ephemeral-port/TIME_WAIT reuse to misdeliver a stray response
 * onto an unrelated request -- confirmed live once via a correlation-id mismatch in
 * mapping-endpoints.test.ts (see #192's comments for the full evidence).
 *
 * Most test files here construct a *fresh* `createApp(...)` per test (often with a test-specific
 * fake pool wired in), so a single server can't just be bound to one app for the whole file the
 * usual way. Instead this creates ONE real listening server for the whole file up front, whose
 * request listener dispatches to whatever Express app was most recently registered via
 * `setActiveApp` -- every test keeps constructing its own `createApp(...)` exactly as before, but
 * the file makes exactly one TCP listen/close pair instead of one per test.
 *
 * Correctness precondition: tests in a file using this must run sequentially, not concurrently
 * (`it.concurrent`/`describe.concurrent`) -- `activeApp` is a single mutable slot, so concurrent
 * requests against the shared server would race on which app handles which request. This is
 * already vitest's default and true of every file adopting this helper so far.
 */
export const createSharedTestServer = (): {
  server: Server;
  setActiveApp: (app: Application) => void;
} => {
  let activeApp: Application | undefined;

  const server = createServer((request, response) => {
    if (!activeApp) {
      response.statusCode = 500;
      response.end('createSharedTestServer: no active app registered for this request');
      return;
    }
    activeApp(request, response);
  });

  return {
    server,
    setActiveApp: (app: Application) => {
      activeApp = app;
    },
  };
};
