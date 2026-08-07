import { afterEach, describe, expect, it } from 'vitest';

import {
  MockEntityVerificationProvider,
  resolveEntityVerificationProvider,
} from '../src/services/entityVerificationService';

describe('MockEntityVerificationProvider', () => {
  const provider = new MockEntityVerificationProvider();

  it('fails a filing number with no digits at all', async () => {
    const result = await provider.verify({
      legalName: 'Acme Co',
      state: 'DE',
      filingNumber: 'N/A',
      entityType: 'domestic',
    });

    expect(result).toEqual({ status: 'failed' });
  });

  it('fails an all-zero filing number', async () => {
    const result = await provider.verify({
      legalName: 'Acme Co',
      state: 'DE',
      filingNumber: '000000',
      entityType: 'domestic',
    });

    expect(result).toEqual({ status: 'failed' });
  });

  it('fails a filing number containing the 9999 fake-data marker', async () => {
    const result = await provider.verify({
      legalName: 'Acme Co',
      state: 'DE',
      filingNumber: 'DE-9999-XYZ',
      entityType: 'foreign',
    });

    expect(result).toEqual({ status: 'failed' });
  });

  it('verifies a filing number that looks real', async () => {
    const result = await provider.verify({
      legalName: 'Acme Co',
      state: 'DE',
      filingNumber: '4821017',
      entityType: 'domestic',
    });

    expect(result).toEqual({
      status: 'verified',
      registeredName: 'Acme Co',
      standing: 'active',
    });
  });
});

describe('resolveEntityVerificationProvider', () => {
  const originalProvider = process.env.ENTITY_VERIFICATION_PROVIDER;

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.ENTITY_VERIFICATION_PROVIDER;
    } else {
      process.env.ENTITY_VERIFICATION_PROVIDER = originalProvider;
    }
  });

  it('defaults to the mock provider when unset', () => {
    delete process.env.ENTITY_VERIFICATION_PROVIDER;
    expect(resolveEntityVerificationProvider()).toBeInstanceOf(MockEntityVerificationProvider);
  });

  it('defaults to the mock provider for an empty string', () => {
    process.env.ENTITY_VERIFICATION_PROVIDER = '   ';
    expect(resolveEntityVerificationProvider()).toBeInstanceOf(MockEntityVerificationProvider);
  });

  it('accepts "mock" case-insensitively', () => {
    process.env.ENTITY_VERIFICATION_PROVIDER = 'MOCK';
    expect(resolveEntityVerificationProvider()).toBeInstanceOf(MockEntityVerificationProvider);
  });

  it('throws for an unknown provider name', () => {
    process.env.ENTITY_VERIFICATION_PROVIDER = 'real-sos-vendor';
    expect(() => resolveEntityVerificationProvider()).toThrow(
      /Unknown ENTITY_VERIFICATION_PROVIDER "real-sos-vendor"/,
    );
  });
});
