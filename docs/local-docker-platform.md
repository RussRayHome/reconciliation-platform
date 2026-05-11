# Local Docker Platform

This document describes the production-like local stack defined in `compose.yaml`, including deployment order, safety gates, and troubleshooting.

## 1. Topology overview

```text
Browser -> web (NGINX gateway) -> api (Express) -> postgres
                              \
                               -> migrate (one-shot, startup only)
```

Key design goals:

- single public web entrypoint
- internal service-to-service networking for API and DB
- explicit migration phase before API startup
- repeatable preflight checks before local deployment validation

## 2. Services and ports

| Service    | Role                         | Host port       | Notes                                 |
|------------|------------------------------|-----------------|---------------------------------------|
| `web`      | Public gateway and static UI | `4173`          | Proxies `/api/*` to internal API      |
| `api`      | Reconciliation API           | none (internal) | Exposed only to compose networks      |
| `postgres` | Primary data store           | `5432`          | Uses `Dockerfile.postgres`            |
| `migrate`  | One-shot migration runner    | none            | Runs `node apps/api/dist/migrate.cjs` |
| `pgweb`    | DB browser utility           | `8081`          | Optional operator convenience         |

Default values come from `.env.docker` / `.env.docker.example`.

## 3. Networks and storage

Networks:

- `edge`: gateway ingress
- `app` (internal): web-to-api only
- `data` (internal): api/migrate-to-postgres only

Persistent volumes:

- `recon-postgres-data`: PostgreSQL data directory
- `recon-app-state`: API latest-run snapshot path

## 4. Standard deployment runbook

From repository root:

```bash
cp .env.docker.example .env.docker
npm run docker:validate-env
npm run docker:preflight
npm run docker:deploy
npm run docker:db:preflight
npm run docker:health
npm run docker:predeploy
```

Access points after deploy:

- Gateway: `http://127.0.0.1:4173`
- API health through gateway: `http://127.0.0.1:4173/api/health`
- NGINX health: `http://127.0.0.1:4173/healthz`
- pgweb: `http://127.0.0.1:8081`

## 5. Operational command reference

### Bring up/down

```bash
npm run docker:deploy
npm run docker:redeploy
npm run docker:cleanup
npm run docker:down
npm run docker:logs
```

### Migration and health

```bash
npm run docker:migrate
npm run docker:health
npm run docker:db:preflight
```

### Safety gates

```bash
npm run docker:preflight
npm run docker:predeploy
npm run docker:gate
```

### Stage OWASP ZAP (DAST)

```bash
npm run security:scan:zap:web:test-stage
npm run security:scan:zap:api:test-stage
npm run security:scan:zap:test-stage
```

Strict mode (WARN findings fail the command):

```bash
npm run security:scan:zap:web:test-stage:strict
npm run security:scan:zap:api:test-stage:strict
npm run security:scan:zap:test-stage:strict
```

## 6. Preflight checks explained

## Build phase (`docker:preflight`)

Validates local build readiness and container hygiene before stack start.

Coverage includes:

1. Docker daemon availability
2. `.dockerignore` completeness
3. Dockerfile linting
4. secret-pattern scan
5. host port conflicts (`4000`, `4173`, `5432`, `5173`)
6. required env file presence
7. image build success
8. image size threshold check
9. non-root runtime user check
10. dev dependency leak check
11. Trivy vulnerability scan

Result format: PASS/WARN/FAIL summary with totals.

## Compose phase (`docker:predeploy`)

Validates startup and shutdown behavior in a full compose cycle.

Coverage includes:

1. compose config validation
2. stack startup readiness
3. health endpoint check (`/api/health` through gateway)
4. inter-service connectivity probe
5. graceful shutdown verification
6. cleanup integrity

## Database phase (`docker:db:preflight`)

Validates migration coverage and DB safety before schema-affecting changes are promoted.

Coverage includes:

- Docker/env resolution and postgres readiness
- migration tracking table presence
- schema patch parity against `packages/persistence/src/schema.ts`
- required table/index/constraint sweep
- write/read and rollback-style checks
- Trivy vulnerability scan on DB image

### CVE allowlist support

DB preflight supports temporary allowlisting for known upstream CVEs.

- Default file: `scripts/ops/db-cve-allowlist.txt`
- Override env var: `DB_PREFLIGHT_CVE_ALLOWLIST_FILE`

Entry format:

```text
CVE_ID | YYYY-MM-DD | reason
```

Behavior:

- expired allowlist entries are ignored
- non-expired allowlisted CVEs are reported but excluded from blocking counts
- for stage usage, temporary allowlist entries should be removed after upstream fixes; validate with `npm run docker:db:preflight:test-stage` and confirm `ALLOWLISTED=0`

## 7. Environment configuration

Important keys in `.env.docker`:

- `PUBLIC_WEB_PORT`
- `PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_HOST_PORT`
- `API_DATABASE_URL`
- `RECON_PERSISTENCE_BACKEND`
- `RUN_DB_MIGRATIONS_ON_BOOT`
- `ENABLE_DEVELOPER_DIAGNOSTICS`

Always validate env before deploy:

```bash
npm run docker:validate-env
```

## 8. Troubleshooting

### Port already in use

Symptoms:

- preflight reports listeners
- compose startup fails to bind `4173` or `5432`

Fix:

```bash
npm run docker:cleanup
lsof -i :4173 -i :5432 -i :4000 -i :5173
```

### Health check failures

Inspect services and logs:

```bash
docker compose ps
npm run docker:logs
npm run docker:health
```

### Migration startup failures

Check `migrate` logs and DB preflight:

```bash
docker compose logs migrate
npm run docker:db:preflight
```

### Docker daemon unavailable

Start Docker Desktop and rerun:

```bash
npm run docker:preflight
```

## 9. Recommended usage pattern

- Use `docker:deploy` for standard local integration runs.
- Use `docker:preflight` + `docker:predeploy` before release-sensitive changes.
- Use `docker:db:preflight` whenever migration or persistence code changes.
- Use `docker:cleanup -- --prune-volumes` only when a full data reset is intended.

## 10. Stage security hardening checklist (OWASP ZAP)

Use this checklist to work down Stage OWASP ZAP WARN findings before moving scans to strict mode.

- [ ] Ensure `X-Content-Type-Options: nosniff` is present on all gateway responses, including `/assets/*` and `/api/*` location blocks in `apps/web/nginx.conf`.
- [ ] Add a baseline `Content-Security-Policy` for HTML responses at the gateway, then tighten directives incrementally.
- [x] Add a baseline `Permissions-Policy` header at the gateway and disable features not used by the app.
- [x] Add `Cross-Origin-Embedder-Policy` (and companion policies if needed) after validating browser/runtime compatibility.
- [ ] Reduce version disclosure by minimizing `Server` header detail at the gateway and API boundary.
- [ ] Keep long-lived cache headers only for fingerprinted static assets and set `Cache-Control: no-store` for sensitive API responses.
- [ ] Re-run `npm run security:scan:zap:test-stage` after each header policy change and compare artifact deltas in `test-results/security`.
