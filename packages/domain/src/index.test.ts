import { describe, expect, it } from 'vitest';

import * as domain from './index';

describe('@recon/domain index exports', () => {
  it('re-exports shared domain constants and maps', () => {
    expect(Array.isArray(domain.sourceSystems)).toBe(true);
    expect(Array.isArray(domain.errorCategories)).toBe(true);
    expect(domain.errorCategoryDisplayNames).toBeDefined();
    expect(domain.professionalErrorMessages).toBeDefined();
  });
});
