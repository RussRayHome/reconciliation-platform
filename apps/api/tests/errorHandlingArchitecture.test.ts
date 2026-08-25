import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OPERATIONS } from '@recon/domain';

const APP_TS_PATH = join(__dirname, '../src/app.ts');
const appSource = readFileSync(APP_TS_PATH, 'utf-8');

describe('error-handling-build-plan.md EH2 architecture guard', () => {
  it('never reintroduces requirePool as a live declaration or call site', () => {
    expect(appSource).not.toMatch(/\brequirePool\(/);
  });

  it('passes only valid OperationCode literals to requireDatabase', () => {
    const callSites = [...appSource.matchAll(/requireDatabase\(response,\s*'([^']+)'\)/g)];

    expect(callSites.length).toBeGreaterThan(0);

    const invalid = callSites
      .map((match) => match[1] ?? '')
      .filter((operation) => !(operation in OPERATIONS));

    expect(invalid).toEqual([]);
  });
});
