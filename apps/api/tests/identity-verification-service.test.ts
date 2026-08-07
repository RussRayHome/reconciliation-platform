import { describe, expect, it, vi } from 'vitest';
import type pino from 'pino';

import {
  IDENTITY_CODE_TTL_MINUTES,
  MockNotificationChannel,
  generateIdentityCode,
  resolveNotificationChannel,
  verifyIdentityCode,
} from '../src/services/identityVerificationService';

describe('generateIdentityCode', () => {
  it('generates a six-digit zero-padded code with a hash and a 10-minute expiry', async () => {
    const generated = await generateIdentityCode();

    expect(generated.code).toMatch(/^\d{6}$/);
    expect(generated.codeHash).not.toBe(generated.code);
    expect(generated.codeHash.length).toBeGreaterThan(0);

    const expectedExpiry = Date.now() + IDENTITY_CODE_TTL_MINUTES * 60 * 1000;
    expect(generated.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(generated.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry + 1000);
  });
});

describe('verifyIdentityCode', () => {
  it('rejects when no code was ever generated (codeHash is null)', async () => {
    await expect(verifyIdentityCode('123456', null, new Date(Date.now() + 60000))).resolves.toBe(
      false,
    );
  });

  it('rejects when there is no expiry recorded (expiresAt is null)', async () => {
    const { codeHash } = await generateIdentityCode();
    await expect(verifyIdentityCode('123456', codeHash, null)).resolves.toBe(false);
  });

  it('rejects an expired code without checking the hash', async () => {
    const { code, codeHash } = await generateIdentityCode();
    const expired = new Date(Date.now() - 1000);
    await expect(verifyIdentityCode(code, codeHash, expired)).resolves.toBe(false);
  });

  it('rejects a valid, unexpired hash when the submitted code is wrong', async () => {
    const { codeHash } = await generateIdentityCode();
    const future = new Date(Date.now() + 60000);
    await expect(verifyIdentityCode('000000', codeHash, future)).resolves.toBe(false);
  });

  it('accepts the correct code before expiry', async () => {
    const { code, codeHash } = await generateIdentityCode();
    const future = new Date(Date.now() + 60000);
    await expect(verifyIdentityCode(code, codeHash, future)).resolves.toBe(true);
  });
});

describe('MockNotificationChannel', () => {
  it('logs the code when a logger is provided', async () => {
    const info = vi.fn();
    const logger = { info } as unknown as pino.Logger;
    const channel = new MockNotificationChannel(logger);

    await channel.send('rray@example.com', '123456');

    expect(info).toHaveBeenCalledWith(
      { action: 'identity_verification.code_sent', target: 'rray@example.com', code: '123456' },
      expect.stringContaining('not actually sent'),
    );
  });

  it('does not throw when no logger is provided', async () => {
    const channel = new MockNotificationChannel();
    await expect(channel.send('rray@example.com', '123456')).resolves.toBeUndefined();
  });
});

describe('resolveNotificationChannel', () => {
  it('returns a MockNotificationChannel', () => {
    expect(resolveNotificationChannel()).toBeInstanceOf(MockNotificationChannel);
  });
});
