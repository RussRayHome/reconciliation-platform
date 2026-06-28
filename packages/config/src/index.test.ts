import { describe, expect, it } from 'vitest';

import * as config from './index';

describe('@recon/config index exports', () => {
  it('re-exports primary config helpers', () => {
    expect(config.defaultReconciliationConfig).toBeDefined();
    expect(typeof config.resolveReconciliationConfig).toBe('function');
    expect(Array.isArray(config.sampleAccountOverrides)).toBe(true);
  });
});
