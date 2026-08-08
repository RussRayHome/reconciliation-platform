import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

describe('GET /api/rules/catalog', () => {
  it('returns every rule the engine can emit, with its metric ids and default/min/max metrics', async () => {
    const app = createApp();
    const response = await authedApp(app).get('/api/rules/catalog').expect(200);
    const body = response.body as {
      rules: Array<{
        id: string;
        name: string;
        family: string;
        varianceMetricIds: string[];
        tunable: boolean;
        risk?: string;
      }>;
      metrics: Array<{ id: string; unit: string; default: number; min: number; max: number }>;
    };

    expect(body.rules.length).toBeGreaterThan(0);
    expect(body.metrics).toHaveLength(17);

    const wireFeeRule = body.rules.find((rule) => rule.name === 'Wire Correspondent Fee Deduction');
    expect(wireFeeRule).toBeDefined();
    expect(wireFeeRule?.risk).toBe('elevated');
    expect(wireFeeRule?.varianceMetricIds).toContain('wireFeeTolerance');

    // A rule with no adjustable metric is present with tunable:false, not omitted.
    const untunable = body.rules.find((rule) => rule.varianceMetricIds.length === 0);
    expect(untunable).toBeDefined();
    expect(untunable?.tunable).toBe(false);

    for (const knob of [
      'distinctiveAmountMaxOccurrences',
      'groupedCandidatePoolSize',
      'groupedMatchMaxSize',
      'wireFeeTolerance',
    ]) {
      expect(body.metrics.some((metric) => metric.id === knob)).toBe(true);
    }
  });

  it('requires authentication', async () => {
    const app = createApp();
    const response = await request(app).get('/api/rules/catalog');

    expect(response.status).toBe(401);
  });
});
