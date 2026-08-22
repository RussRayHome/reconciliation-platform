import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApiMetrics } from '../src/services/apiMetrics';

describe('createApiMetrics', () => {
  it('labels requests by their matched Express route path', async () => {
    const metrics = createApiMetrics();
    const app = express();
    app.use(metrics.middleware);
    app.get('/things/:id', (_request, response) => response.status(200).json({ ok: true }));

    await request(app).get('/things/42').expect(200);

    const rendered = await metrics.render();
    expect(rendered.contentType).toContain('text/plain');
    expect(rendered.body).toContain('route="/things/:id"');
    expect(rendered.body).toContain('method="GET"');
  });

  it('labels the root route as "/" rather than "/unknown"', async () => {
    const metrics = createApiMetrics();
    const app = express();
    app.use(metrics.middleware);
    app.get('/', (_request, response) => response.status(200).send('ok'));

    await request(app).get('/').expect(200);

    const rendered = await metrics.render();
    expect(rendered.body).toContain('route="/"');
  });

  it('labels a multi-path route registration using its first matched path', async () => {
    const metrics = createApiMetrics();
    const app = express();
    app.use(metrics.middleware);
    app.get(['/alpha', '/beta'], (_request, response) => response.status(200).send('ok'));

    await request(app).get('/alpha').expect(200);

    const rendered = await metrics.render();
    expect(rendered.body).toContain('route="/alpha"');
  });

  it('falls back to the router mount path when no specific route matches', async () => {
    const metrics = createApiMetrics();
    const app = express();
    const api = express.Router();
    api.use(metrics.middleware);
    api.use((_request, response) => response.status(200).send('ok'));
    app.use('/api', api);

    await request(app).get('/api/anything-unmatched').expect(200);

    const rendered = await metrics.render();
    expect(rendered.body).toContain('route="/api"');
  });

  it('labels a request with neither a matched route nor a mount path as "/unmatched", not the raw path', async () => {
    const metrics = createApiMetrics();
    const app = express();
    app.use(metrics.middleware);
    app.use((_request, response) => response.status(200).send('ok'));

    await request(app).get('/totally-unmatched').expect(200);

    const rendered = await metrics.render();
    expect(rendered.body).toContain('route="/unmatched"');
    expect(rendered.body).not.toContain('route="/totally-unmatched"');
  });

  it('collapses every unmatched path into the same "/unmatched" series, not one series per path', async () => {
    // This app sits behind deny-by-default auth, reachable from the open internet -- labeling by
    // the raw request path would let a scanner (or anyone probing bogus URLs) inflate this
    // metric's cardinality without bound. Confirmed live: a ZAP scan against four long-removed
    // routes left five permanent, distinct "route" label values behind in production Prometheus
    // data before this fix.
    const metrics = createApiMetrics();
    const app = express();
    app.use(metrics.middleware);
    app.use((_request, response) => response.status(200).send('ok'));

    await request(app).get('/scanner-probe-one').expect(200);
    await request(app).get('/completely-different-bogus-path').expect(200);
    await request(app).get('/yet-another-nonexistent-route').expect(200);

    const rendered = await metrics.render();
    const unmatchedLine = rendered.body
      .split('\n')
      .find((line) => line.startsWith('recon_api_http_requests_total{') && line.includes('route="/unmatched"'));

    expect(unmatchedLine).toContain('} 3');
    expect(rendered.body).not.toContain('scanner-probe-one');
    expect(rendered.body).not.toContain('completely-different-bogus-path');
    expect(rendered.body).not.toContain('yet-another-nonexistent-route');
  });

  it('increments the request-errors counter only for 5xx responses', async () => {
    const metrics = createApiMetrics();
    const app = express();
    app.use(metrics.middleware);
    app.get('/ok', (_request, response) => response.status(200).send('ok'));
    app.get('/broken', (_request, response) => response.status(500).send('broken'));

    await request(app).get('/ok').expect(200);
    await request(app).get('/broken').expect(500);

    const rendered = await metrics.render();
    const errorLine = rendered.body
      .split('\n')
      .find((line) => line.startsWith('recon_api_http_request_errors_total{'));

    expect(errorLine).toContain('route="/broken"');
    expect(rendered.body).not.toMatch(/recon_api_http_request_errors_total\{[^}]*route="\/ok"/);
  });
});
