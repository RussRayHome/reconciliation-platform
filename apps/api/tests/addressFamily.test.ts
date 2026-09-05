import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

// Issues #192 / #319. integrationSetup.ts makes supertest connect in the same address family the
// server bound (see its comment for the mechanism). These tests prove that from the outside.
const listening = (server: Server): Promise<AddressInfo | 'EADDRINUSE'> =>
  new Promise((resolve, reject) => {
    server.once('listening', () => resolve(server.address() as AddressInfo));
    server.once('error', (error: NodeJS.ErrnoException) =>
      error.code === 'EADDRINUSE' ? resolve('EADDRINUSE') : reject(error),
    );
  });

describe("supertest's client matches the server's address family (Issue #192)", () => {
  it('connects over IPv6 loopback to the dual-stack server request(app) creates', async () => {
    const app = express().get('/probe', (req, res) => {
      res.json({ localAddress: req.socket.localAddress });
    });
    const response = await request(app).get('/probe').expect(200);
    // Dual-stack server, IPv4 client (the old behaviour) reports the mapped '::ffff:127.0.0.1'.
    expect(response.body.localAddress).toBe('::1');
  });

  it('keeps 127.0.0.1 for a server that was explicitly bound IPv4', async () => {
    const app = express().get('/probe', (req, res) => {
      res.json({ localAddress: req.socket.localAddress });
    });
    const server = createServer(app).listen(0, '127.0.0.1');
    await listening(server);
    try {
      const response = await request(server).get('/probe').expect(200);
      expect(response.body.localAddress).toBe('127.0.0.1');
    } finally {
      server.close();
    }
  });

  it('reaches the real server when an IPv4-specific squatter shares its port', async () => {
    // The captured #192 failure, reconstructed: a dual-stack server on port P and a stranger bound
    // to 127.0.0.1:P answering bare 404s. Before the fix, supertest's 127.0.0.1 client landed on the
    // stranger. On Linux the second bind is refused (EADDRINUSE) -- the platform has no such path,
    // so the test passes vacuously there; the coexistence is a BSD/macOS behaviour.
    const app = express().get('/probe', (_request, res) => {
      res.json({ served: 'real' });
    });
    const real = createServer(app).listen(0);
    const realAddress = (await listening(real)) as AddressInfo;
    const squatter = createServer((_request, res) => {
      res.statusCode = 404;
      res.end();
    }).listen(realAddress.port, '127.0.0.1');
    const squatterResult = await listening(squatter);
    try {
      if (squatterResult === 'EADDRINUSE') {
        return; // this OS refuses the coexistence that makes the bug possible
      }
      const response = await request(real).get('/probe').expect(200);
      expect(response.body.served).toBe('real');
    } finally {
      real.close();
      squatter.close();
    }
  });
});
