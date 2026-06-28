import { describe, expect, it } from 'vitest';

import * as ui from './index';

describe('@recon/ui index exports', () => {
  it('re-exports UI primitives', () => {
    expect(typeof ui.Pill).toBe('function');
    expect(typeof ui.SectionCard).toBe('function');
    expect(typeof ui.StatCard).toBe('function');
  });
});
