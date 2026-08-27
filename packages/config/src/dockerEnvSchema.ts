import { z } from 'zod';

/**
 * Validates the shape of `.env.docker.{dev,stage}` and their `.fallback` siblings (drift review
 * finding #06). Nothing checked these files before this existed -- a typo'd port or a boolean
 * flag spelled `True` instead of `true` (parseBooleanFlag in apps/api/src/app.ts only recognizes
 * the literal strings `'true'`/`'false'`) would silently fall through to whatever the app's own
 * default happens to be, discovered only at runtime if at all.
 *
 * Scope is deliberately the union of what these four files actually set today, not the full set
 * of `process.env.*` reads across the codebase -- most of those (OTEL_*, SENTRY_*, queue
 * concurrency/backoff settings, etc.) have safe code-level defaults and are legitimately absent
 * from every one of these files by design, not by omission.
 *
 * A field is required here only if it's present in all four files today AND the application
 * either hard-fails or silently misbehaves without it (secrets, connection info, core ports).
 * Everything else is `.optional()` -- some of those are asymmetric across the four files today
 * (e.g. ENABLE_API_METRICS/RATE_LIMIT_* appear only in the .fallback files; ENABLE_CARRY_FORWARD
 * appears only in the real ones), which is itself real, pre-existing drift this schema makes
 * visible rather than silently preserves. See dockerEnvSchema.test.ts's parity check, which is
 * intentionally scoped to the required fields above, not these optional ones -- flipping any of
 * them to force parity would change live dev/stage runtime behavior (e.g. turning on
 * Redis-backed rate limiting) and needs its own deliberate decision, not a side effect of adding
 * a schema.
 */

const booleanFlag = z.enum(['true', 'false']);
const numericString = z.string().regex(/^\d+$/, 'must be a non-negative integer');
const portString = z
  .string()
  .regex(/^\d+$/, 'must be a numeric port')
  .refine((value) => Number(value) >= 1 && Number(value) <= 65535, 'must be a valid port number');

export const dockerEnvSchema = z
  .object({
    // ── Core, required in every file ──────────────────────────────────────────────
    COMPOSE_PROJECT_NAME: z.string().min(1),
    PUBLIC_WEB_PORT: portString,
    PUBLIC_WEB_HTTPS_PORT: portString,
    PORT: portString,
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']),
    MAX_UPLOAD_MB: numericString,
    RECON_PERSISTENCE_BACKEND: z.string().min(1),
    POSTGRES_DB: z.string().min(1),
    POSTGRES_USER: z.string().min(1),
    POSTGRES_PASSWORD: z.string().min(1),
    POSTGRES_HOST_PORT: portString,
    // Consumed by Dockerfile.postgres and changeset 0027, not by Node code -- see
    // dockerEnvSchema.test.ts's comment.
    ENABLE_PGAUDIT: booleanFlag,
    NGINX_UI_HTTP_PORT: portString,
    NGINX_UI_HTTPS_PORT: portString,
    API_DATABASE_URL: z.string().regex(/^postgresql:\/\//, 'must be a postgresql:// connection string'),
    JWT_SECRET: z.string().min(1),
    PG_POOL_MAX: numericString,
    PG_IDLE_TIMEOUT_MS: numericString,
    PG_STATEMENT_TIMEOUT_MS: numericString,
    RECONCILIATION_RUN_STORE_PATH: z.string().min(1),
    LOG_FILE: z.string().min(1),

    // ── Optional: present in some files, safe code-level default when absent ──────
    DEBUG_RECONCILIATION: booleanFlag.optional(),
    ENABLE_DEVELOPER_DIAGNOSTICS: booleanFlag.optional(),
    VITE_ENABLE_DEVELOPER_DASHBOARD: booleanFlag.optional(),
    // Defaults to enabled (apps/api/src/app.ts: `!== false`) -- only an explicit 'false' disables.
    ENABLE_CARRY_FORWARD: booleanFlag.optional(),
    // Defaults to enabled when unset (apps/api/src/app.ts: `apiMetricsFlag === null` also enables).
    ENABLE_API_METRICS: booleanFlag.optional(),
    // Defaults to disabled (in-memory limiter) unless RATE_LIMIT_REDIS_URL is also set.
    RATE_LIMIT_USE_REDIS: booleanFlag.optional(),
    RATE_LIMIT_WINDOW_MS: numericString.optional(),
    RATE_LIMIT_MAX_REQUESTS: numericString.optional(),
    RATE_LIMIT_REDIS_URL: z.string().regex(/^redis:\/\//).optional(),
    RATE_LIMIT_REDIS_PREFIX: z.string().min(1).optional(),
    // Has its own compose-level default (`${PGWEB_PORT:-8081}`) -- legitimately absent.
    PGWEB_PORT: portString.optional(),
    // Stage-only, deliberately temporary -- see compose.yaml's own comment on this flag.
    DISABLE_API_RATE_LIMIT: booleanFlag.optional(),
  })
  .partial()
  .required({
    COMPOSE_PROJECT_NAME: true,
    PUBLIC_WEB_PORT: true,
    PUBLIC_WEB_HTTPS_PORT: true,
    PORT: true,
    LOG_LEVEL: true,
    MAX_UPLOAD_MB: true,
    RECON_PERSISTENCE_BACKEND: true,
    POSTGRES_DB: true,
    POSTGRES_USER: true,
    POSTGRES_PASSWORD: true,
    POSTGRES_HOST_PORT: true,
    ENABLE_PGAUDIT: true,
    NGINX_UI_HTTP_PORT: true,
    NGINX_UI_HTTPS_PORT: true,
    API_DATABASE_URL: true,
    JWT_SECRET: true,
    PG_POOL_MAX: true,
    PG_IDLE_TIMEOUT_MS: true,
    PG_STATEMENT_TIMEOUT_MS: true,
    RECONCILIATION_RUN_STORE_PATH: true,
    LOG_FILE: true,
  })
  .strict();

/** The fields required in every `.env.docker.*` file -- used by dockerEnvSchema.test.ts to check
 * that a real/fallback pair (e.g. `.env.docker.dev` / `.env.docker.dev.fallback`) declares the
 * same required keys, so a var added to one side isn't silently missing from the other. */
export const dockerEnvRequiredKeys = [
  'COMPOSE_PROJECT_NAME',
  'PUBLIC_WEB_PORT',
  'PUBLIC_WEB_HTTPS_PORT',
  'PORT',
  'LOG_LEVEL',
  'MAX_UPLOAD_MB',
  'RECON_PERSISTENCE_BACKEND',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_HOST_PORT',
  'ENABLE_PGAUDIT',
  'NGINX_UI_HTTP_PORT',
  'NGINX_UI_HTTPS_PORT',
  'API_DATABASE_URL',
  'JWT_SECRET',
  'PG_POOL_MAX',
  'PG_IDLE_TIMEOUT_MS',
  'PG_STATEMENT_TIMEOUT_MS',
  'RECONCILIATION_RUN_STORE_PATH',
  'LOG_FILE',
] as const;

/** Parses a `.env`-style file's contents into a plain string map: `KEY=VALUE` lines, `#`
 * comments, and blank lines. Deliberately minimal -- these files never use quoting, escaping, or
 * multi-line values, so a real dotenv parser would be an unused-feature dependency. */
export const parseDockerEnvFile = (contents: string): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      throw new Error(`Malformed line in docker env file (expected KEY=VALUE): ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    result[key] = value;
  }

  return result;
};
