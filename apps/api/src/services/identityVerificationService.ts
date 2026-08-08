import { randomInt } from 'node:crypto';
import type pino from 'pino';
import { hashPassword, verifyPassword } from './authService';

export const IDENTITY_CODE_TTL_MINUTES = 10;

export interface GeneratedIdentityCode {
  code: string;
  codeHash: string;
  expiresAt: Date;
}

/** Generates the six-digit signup confirmation code, matching the design doc's 10-minute expiry.
 * Hashed with the same bcrypt helper login passwords use, rather than reinventing hashing for a
 * short-lived numeric code. */
export const generateIdentityCode = async (): Promise<GeneratedIdentityCode> => {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + IDENTITY_CODE_TTL_MINUTES * 60 * 1000);

  return { code, codeHash, expiresAt };
};

/** `codeHash`/`expiresAt` are `null` for a user who never requested a code, or whose most recent
 * code was already consumed -- both read as "not verifiable", not an error. */
export const verifyIdentityCode = async (
  submitted: string,
  codeHash: string | null,
  expiresAt: Date | null,
): Promise<boolean> => {
  if (!codeHash || !expiresAt || expiresAt.getTime() < Date.now()) {
    return false;
  }

  return verifyPassword(submitted, codeHash);
};

/** Delivery seam for the identity-confirmation code. No email/SMS vendor exists in this repo yet
 * -- the mock channel logs the code instead of sending it, so signup is exercisable end-to-end in
 * dev/test without a real provider. Swapping in a real one later is one new implementation. */
export interface NotificationChannel {
  send(target: string, code: string): Promise<void>;
}

/** The `NotificationChannel` implementation used until a real email/SMS vendor is wired in --
 * see the interface doc above for why logging stands in for sending. */
export class MockNotificationChannel implements NotificationChannel {
  /** @param logger Optional; when omitted the code is generated but never surfaced anywhere. */
  constructor(private readonly logger?: pino.Logger) {}

  /** Logs `code` instead of delivering it to `target` -- see the class doc for why. */
  send(target: string, code: string): Promise<void> {
    this.logger?.info(
      { action: 'identity_verification.code_sent', target, code },
      'Identity verification code generated (mock channel -- not actually sent; read it from this log entry).',
    );
    return Promise.resolve();
  }
}

export const resolveNotificationChannel = (logger?: pino.Logger): NotificationChannel =>
  new MockNotificationChannel(logger);
