import { describe, expect, it } from 'vitest';

import * as persistence from './index';

describe('@recon/persistence index exports', () => {
  it('re-exports persistence primitives and stores', () => {
    expect(Array.isArray(persistence.postgresMigrations)).toBe(true);
    expect(typeof persistence.createPostgresPool).toBe('function');
    expect(typeof persistence.runPostgresMigrations).toBe('function');
    expect(typeof persistence.canTransitionJobState).toBe('function');
    expect(typeof persistence.PostgresReconciliationLifecycleStore).toBe('function');
    expect(typeof persistence.PostgresReconciliationReadModelStore).toBe('function');
  });
});
