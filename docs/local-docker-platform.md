# Local Docker Platform

## Executive Summary

The local Docker Desktop stack now follows a production-like gateway pattern: client traffic reaches a single public NGINX container, NGINX forwards API requests to an internal Express service, and PostgreSQL stays on an internal data network. Database migrations run as an explicit one-shot deployment step instead of being coupled to the long-running API process.

## Verified Current State

- `compose.yaml` exposes only the `web` service on host port `4173`.
- `web` runs NGINX and proxies `/api/*` to the internal `api` service.
- `api` and `postgres` are isolated onto internal Compose networks.
- `migrate` runs `node apps/api/dist/migrate.cjs` and must complete before `api` starts.
- The API still uses the shared PostgreSQL migration implementation from `packages/persistence/src/postgres.ts`.

## Target Architecture

```text
Client -> NGINX gateway -> Express API -> PostgreSQL
```

- Public entrypoint: `http://127.0.0.1:4173`
- Internal app network: `web` to `api`
- Internal data network: `api` and `migrate` to `postgres`

## Deployment Flow

1. Validate environment with `bash scripts/ops/validate-env.sh`.
2. Start PostgreSQL with `bash scripts/ops/deploy.sh`.
3. Run migrations through the dedicated `migrate` service.
4. Start `api` and `web` after migrations succeed.
5. Verify `/healthz`, `/api/health`, and `pg_isready` with `bash scripts/ops/health-check.sh`.

## Cleanup Flow

- Stop containers without deleting volumes: `bash scripts/ops/cleanup.sh`
- Stop containers and delete data volumes: `bash scripts/ops/cleanup.sh --prune-volumes`

## Operational Notes

- For local overrides, copy `.env.docker.example` to `.env.docker`.
- `RUN_DB_MIGRATIONS_ON_BOOT=false` keeps the API from mutating schema state during normal startup.
- `apps/web/nginx.conf` now owns gateway health checks and baseline hardening headers.
- `app.set('trust proxy', true)` ensures Express respects forwarded headers from NGINX.