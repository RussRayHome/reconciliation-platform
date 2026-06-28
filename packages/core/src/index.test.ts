import { describe, expect, it } from 'vitest';

import * as core from './index';

describe('@recon/core index exports', () => {
  it('re-exports core reconciliation APIs', () => {
    expect(typeof core.runReconciliation).toBe('function');
    expect(typeof core.reconcileMatches).toBe('function');
    expect(typeof core.parseWorkbook).toBe('function');
    expect(typeof core.buildSummaryMetrics).toBe('function');
  });
});
