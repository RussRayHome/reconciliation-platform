# Local Docker Platform

This document describes the production-like local stack defined in `compose.yaml`, including deployment order, safety gates, and troubleshooting.

## 1. Topology overview

```text
Browser -> web (NGINX gateway) -> api (Express) -> postgres
                              \
                               -> migrate (one-shot, startup only)
                               -> pgweb (dev and stage only)
```

Key design goals:

- single public web entrypoint
- internal service-to-service networking for API and DB
- explicit migration phase before API startup
- user account creation automated as part of every deploy
- repeatable preflight checks before local deployment validation

## 2. Services and ports

| Service    | Role                         | Host port       | Environments    | Notes                                 |
|------------|------------------------------|-----------------|-----------------|---------------------------------------|
| `web`      | Public gateway and static UI | `4173`          | dev, stage      | Proxies `/api/*` to internal API      |
| `api`      | Reconciliation API           | none (internal) | dev, stage      | Exposed only to compose networks      |
| `postgres` | Primary data store           | `5432`          | dev, stage      | Uses `Dockerfile.postgres`            |
| `migrate`  | One-shot migration runner    | none            | dev, stage      | Runs `node apps/api/dist/migrate.cjs` |
| `pgweb`    | Postgres web admin           | `8081`          | dev, stage only | Not deployed to production            |

Default values come from `.env.docker` / `.env.docker.dev.fallback`.

## 3. Networks and storage

Networks:

- `edge`: gateway ingress
- `app` (internal): web-to-api only
- `data` (internal): api/migrate/pgweb-to-postgres only

Persistent volumes:

- `recon-postgres-data`: PostgreSQL data directory
- `recon-app-state`: API latest-run snapshot path

Volume names are prefixed with `COMPOSE_PROJECT_NAME` (see section 4).

## 4. Image and container naming

`COMPOSE_PROJECT_NAME` in the env file controls both container naming and image labels.

| Environment | `COMPOSE_PROJECT_NAME`          | Example image name                  |
|-------------|---------------------------------|-------------------------------------|
| dev         | `reconciliation-platform-dev`   | `reconciliation-platform-dev-api`   |
| stage       | `reconciliation-platform-stage` | `reconciliation-platform-stage-web` |

Service images follow the pattern `<COMPOSE_PROJECT_NAME>-<component>`:

- `-api`
- `-web`
- `-data` (postgres image label)
- `-migrate`

Volumes follow the same prefix: `reconciliation-platform-dev_recon-postgres-data`.

## 5. Standard deployment runbook

From repository root:

```bash
cp .env.docker.dev.fallback .env.docker
npm run docker:validate-env
npm run docker:preflight
npm run docker:deploy          # builds images, runs migrations, creates users, starts all services
npm run docker:db:preflight
npm run docker:health
npm run docker:predeploy
```

`docker:deploy` automates the full startup sequence including database user creation. No manual user creation step is required.

Access points after deploy:

- Application: `http://127.0.0.1:4173`
- Documentation Hub: `http://127.0.0.1:4173/<environment>/docs` (for example `dev/docs`)
- API health through gateway: `http://127.0.0.1:4173/api/health`
- NGINX health: `http://127.0.0.1:4173/healthz`
- Developer Dashboard: `http://127.0.0.1:4173/<environment>/developer-dashboard.html` (for example `dev/developer-dashboard.html`)
- Postgres Admin (pgweb): `http://127.0.0.1:8081` (dev and stage only)

## 6. Environment files

| File                         | Purpose                                   | Committed |
|------------------------------|-------------------------------------------|-----------|
| `.env.docker`                | Active dev env file (primary)             | No        |
| `.env.docker.dev`            | Active dev env file (alternate)           | No        |
| `.env.docker.dev.fallback`   | Dev defaults with placeholder passwords   | Yes       |
| `.env.docker.stage`          | Active stage env file                     | No        |
| `.env.docker.stage.fallback` | Stage defaults with placeholder passwords | Yes       |

Scripts resolve the active file with this logic: use `DOCKER_ENV_FILE` if it exists, otherwise fall back to `DOCKER_ENV_FALLBACK_FILE`. The fallback files are safe to commit because they contain no real secrets.

## 7. Operational command reference

### Bring up/down

```bash
npm run docker:deploy
npm run docker:deploy:dev
npm run docker:deploy:stage
npm run docker:redeploy
npm run docker:cleanup
npm run docker:down
npm run docker:logs
```

### Migration and health

```bash
npm run docker:migrate
npm run docker:health
npm run docker:health:dev
npm run docker:health:stage
npm run docker:db:preflight
npm run docker:db:preflight:dev
npm run docker:db:preflight:stage
```

### Database user management

```bash
npm run db:users:dev        # create/update the rray user in dev (automated by docker:deploy)
npm run db:users:stage      # create/update the rray user in stage (automated by docker:deploy)
```

### Database backup and restore

```bash
npm run db:backup           # dump dev database → .backups/recon-dev-<timestamp>.dump
npm run db:backup:dev       # same as db:backup
npm run db:backup:stage     # dump stage database
npm run db:restore:dev      # restore dev from most recent backup (or specify a file)
npm run db:restore:stage    # restore stage from most recent backup
npm run db:seed:dev         # insert baseline representative dataset into dev
npm run db:seed:stage       # insert baseline representative dataset into stage
```

Backup files are written to `.backups/` (gitignored). Restore stops dependent services, restores with `pg_restore -j 4`, re-applies grants, then restarts services.

Full recovery from a complete data loss:

```bash
npm run docker:deploy       # fresh postgres + migrations + users
npm run db:restore:dev      # restore from most recent snapshot
# — or, if no snapshot exists:
npm run db:seed:dev
```

### Safety gates

```bash
npm run docker:preflight
npm run docker:predeploy
npm run docker:gate
```

### Stage OWASP ZAP (DAST)

```bash
npm run security:scan:zap:web:stage
npm run security:scan:zap:api:stage
npm run security:scan:zap:stage
```

Strict mode (WARN findings fail the command):

```bash
npm run security:scan:zap:web:stage:strict
npm run security:scan:zap:api:stage:strict
npm run security:scan:zap:stage:strict
```

## 8. Preflight checks explained

### Build phase (`docker:preflight`)

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

### Compose phase (`docker:predeploy`)

Validates startup and shutdown behavior in a full compose cycle.

Coverage includes:

1. compose config validation
2. stack startup readiness
3. health endpoint check (`/api/health` through gateway)
4. inter-service connectivity probe
5. graceful shutdown verification
6. cleanup integrity

### Database phase (`docker:db:preflight`)

Validates migration coverage and DB safety before schema-affecting changes are promoted.

Coverage includes:

- Docker/env resolution and postgres readiness
- migration tracking table presence
- schema patch parity against `packages/persistence/src/schema.ts`
- required table/index/constraint sweep
- pgAudit extension verification
- expected database user existence and role attribute check
- user database and table privilege verification
- write/read and rollback-style checks
- Trivy vulnerability scan on DB image
- pgweb health check (when pgweb service is present in the compose config)

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
- for stage usage, temporary allowlist entries should be removed after upstream fixes; validate with `npm run docker:db:preflight:stage` and confirm `ALLOWLISTED=0`

## 9. Environment configuration

Important keys in `.env.docker`:

- `COMPOSE_PROJECT_NAME` — controls image and container naming (e.g. `reconciliation-platform-dev`)
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

## 10. Troubleshooting

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

### Missing database user (DB12/DB13/DB14 preflight failures)

`docker:deploy` creates the `rray` user automatically. If running preflight against a stack deployed without this, run manually:

```bash
npm run db:users:dev
```

### Docker daemon unavailable

Start Docker Desktop and rerun:

```bash
npm run docker:preflight
```

## 11. Recommended usage pattern

- Use `docker:deploy` for standard local integration runs.
- Use `docker:preflight` + `docker:predeploy` before release-sensitive changes.
- Use `docker:db:preflight` whenever migration or persistence code changes.
- Use `docker:backup:dev` before any destructive data operation.
- Use `docker:cleanup -- --prune-volumes` only when a full data reset is intended; restore from backup afterward.

## 12. Stage security hardening checklist (OWASP ZAP)

Use this checklist to work down Stage OWASP ZAP WARN findings before moving scans to strict mode.

- [ ] Ensure `X-Content-Type-Options: nosniff` is present on all gateway responses, including `/assets/*` and `/api/*` location blocks in `apps/web/nginx.conf`.
- [ ] Add a baseline `Content-Security-Policy` for HTML responses at the gateway, then tighten directives incrementally.
- [x] Add a baseline `Permissions-Policy` header at the gateway and disable features not used by the app.
- [x] Add `Cross-Origin-Embedder-Policy` (and companion policies if needed) after validating browser/runtime compatibility.
- [ ] Reduce version disclosure by minimizing `Server` header detail at the gateway and API boundary.
- [ ] Keep long-lived cache headers only for fingerprinted static assets and set `Cache-Control: no-store` for sensitive API responses.
- [ ] Re-run `npm run security:scan:zap:stage` after each header policy change and compare artifact deltas in `test-results/security`.
