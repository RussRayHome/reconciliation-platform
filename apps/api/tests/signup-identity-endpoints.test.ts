import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import request from 'supertest';

import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

/**
 * Fake pool for /api/auth/signup, /api/entity-verification/check, /api/auth/identity/confirm,
 * /api/auth/identity/resend (apps/api/src/app.ts) -- no test file exercised any of these routes
 * before this one. Both entity-verification and notification default to deterministic mock
 * providers (resolveEntityVerificationProvider/resolveNotificationChannel), so no further mocking
 * is needed for those.
 */
const createFakeSignupPool = (
  overrides: Partial<{
    insertErrorCode: string;
    identityCodeHash: string | null;
    identityCodeExpiresAt: Date | null;
    userEmail: string | null;
    userPhone: string | null;
  }> = {},
) => {
  const clientQuery = (text: string, _params?: unknown[]) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('INSERT INTO reconciliation_organization')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('INSERT INTO reconciliation_user')) {
      if (overrides.insertErrorCode) {
        return Promise.reject(
          Object.assign(new Error('duplicate key value'), { code: overrides.insertErrorCode }),
        );
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    throw new Error(`createFakeSignupPool (client): unexpected query: ${text}`);
  };

  const query = (text: string, _params?: unknown[]) => {
    if (text.includes('SET identity_verification_code_hash')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('SELECT identity_verification_code_hash')) {
      return Promise.resolve({
        rows: [
          {
            identity_verification_code_hash: overrides.identityCodeHash ?? null,
            identity_verification_code_expires_at: overrides.identityCodeExpiresAt ?? null,
          },
        ],
        rowCount: 1,
      });
    }
    if (text.includes("SET identity_verification_status = 'verified'")) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('SELECT email, phone FROM reconciliation_user')) {
      return Promise.resolve({
        rows: [{ email: overrides.userEmail ?? null, phone: overrides.userPhone ?? null }],
        rowCount: 1,
      });
    }
    if (text.includes('UPDATE reconciliation_organization SET entity_verification_status')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    throw new Error(`createFakeSignupPool (pool): unexpected query: ${text}`);
  };

  return {
    query,
    connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
  } as unknown as Pool;
};

const appWithPool = (pool?: Pool) => createApp(undefined, undefined, undefined, pool);

const validSignupBody = {
  email: 'analyst@example.com',
  fullName: 'Jane Analyst',
  username: 'j.analyst',
  password: 'Str0ng!Passw0rd',
  phone: '',
  companyName: 'Example Staffing Co',
  headcount: '50-100',
  industry: 'Staffing',
  role: 'senior-analyst',
  fiscalYearEnd: 'December',
  entityState: 'DE',
  entityFilingNumber: '1234567',
  entityType: 'domestic',
  verificationChannel: 'email',
};

describe('POST /api/auth/signup', () => {
  it('creates an organization + user and returns a token', async () => {
    const response = await request(appWithPool(createFakeSignupPool()))
      .post('/api/auth/signup')
      .send(validSignupBody);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ username: 'j.analyst', role: 'senior-analyst' });
    expect(typeof response.body.token).toBe('string');
  });

  it('splits a multi-word full name into first/last', async () => {
    const response = await request(appWithPool(createFakeSignupPool()))
      .post('/api/auth/signup')
      .send({ ...validSignupBody, username: 'j.multi', fullName: 'Jane Q Analyst' });

    expect(response.status).toBe(201);
    expect(response.body.firstName).toBe('Jane');
  });

  it('falls back to the single name for both first and last when fullName has no space', async () => {
    const response = await request(appWithPool(createFakeSignupPool()))
      .post('/api/auth/signup')
      .send({ ...validSignupBody, username: 'j.single', fullName: 'Cher' });

    expect(response.status).toBe(201);
    expect(response.body.firstName).toBe('Cher');
  });

  it('returns 400 for an invalid body', async () => {
    const response = await request(appWithPool(createFakeSignupPool()))
      .post('/api/auth/signup')
      .send({ ...validSignupBody, password: 'weak' });

    expect(response.status).toBe(400);
  });

  it('returns 409 when the username/email/company is already registered', async () => {
    const response = await request(appWithPool(createFakeSignupPool({ insertErrorCode: '23505' })))
      .post('/api/auth/signup')
      .send(validSignupBody);

    expect(response.status).toBe(409);
  });

  it('returns 501 with no database pool configured', async () => {
    const response = await request(appWithPool(undefined)).post('/api/auth/signup').send(validSignupBody);

    expect(response.status).toBe(501);
  });
});

describe('POST /api/entity-verification/check', () => {
  it('returns a verification result for a valid body', async () => {
    const response = await request(appWithPool(createFakeSignupPool()))
      .post('/api/entity-verification/check')
      .send({
        companyName: 'Example Staffing Co',
        entityState: 'DE',
        entityFilingNumber: '1234567',
        entityType: 'domestic',
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBeTypeOf('string');
  });

  it('returns 400 for an invalid body', async () => {
    const response = await request(appWithPool(createFakeSignupPool()))
      .post('/api/entity-verification/check')
      .send({});

    expect(response.status).toBe(400);
  });
});

describe('POST /api/auth/identity/confirm', () => {
  it('returns 401 with no auth token', async () => {
    const response = await request(appWithPool(createFakeSignupPool()))
      .post('/api/auth/identity/confirm')
      .send({ code: '123456' });
    expect(response.status).toBe(401);
  });

  it('returns 501 with no database pool configured', async () => {
    const response = await authedApp(appWithPool(undefined))
      .post('/api/auth/identity/confirm')
      .send({ code: '123456' });
    expect(response.status).toBe(501);
  });

  it('returns 400 for an invalid body', async () => {
    const response = await authedApp(appWithPool(createFakeSignupPool()))
      .post('/api/auth/identity/confirm')
      .send({});
    expect(response.status).toBe(400);
  });

  it('returns 400 when there is no code on file at all', async () => {
    const pool = createFakeSignupPool({ identityCodeHash: null, identityCodeExpiresAt: null });
    const response = await authedApp(appWithPool(pool))
      .post('/api/auth/identity/confirm')
      .send({ code: '123456' });
    expect(response.status).toBe(400);
  });

  it('returns 400 when the code has expired', async () => {
    const pool = createFakeSignupPool({
      identityCodeHash: '$2a$10$notarealhash',
      identityCodeExpiresAt: new Date(0),
    });
    const response = await authedApp(appWithPool(pool))
      .post('/api/auth/identity/confirm')
      .send({ code: '123456' });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/auth/identity/resend', () => {
  it('returns 401 with no auth token', async () => {
    const response = await request(appWithPool(createFakeSignupPool()))
      .post('/api/auth/identity/resend')
      .send({});
    expect(response.status).toBe(401);
  });

  it('returns 501 with no database pool configured', async () => {
    const response = await authedApp(appWithPool(undefined)).post('/api/auth/identity/resend');
    expect(response.status).toBe(501);
  });

  it('resends when an email is on file', async () => {
    const pool = createFakeSignupPool({ userEmail: 'analyst@example.com', userPhone: null });
    const response = await authedApp(appWithPool(pool)).post('/api/auth/identity/resend');
    expect(response.status).toBe(204);
  });

  it('falls back to phone when there is no email on file', async () => {
    const pool = createFakeSignupPool({ userEmail: null, userPhone: '+15555550123' });
    const response = await authedApp(appWithPool(pool)).post('/api/auth/identity/resend');
    expect(response.status).toBe(204);
  });

  it('returns 409 when neither email nor phone is on file', async () => {
    const pool = createFakeSignupPool({ userEmail: null, userPhone: null });
    const response = await authedApp(appWithPool(pool)).post('/api/auth/identity/resend');
    expect(response.status).toBe(409);
  });
});
