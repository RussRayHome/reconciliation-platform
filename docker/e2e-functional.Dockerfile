# Canonical execution environment for the `functional` Playwright project's CI runs. Pinned to the
# same exact tag as docker/e2e-visual.Dockerfile (see that file's own comment for why an unpinned
# `latest` tag is unsafe here) -- matches this repo's single @playwright/test version (1.62.1)
# exactly, so there's no browser/Chromium-revision skew risk in reusing it.
#
# Unlike e2e-visual.Dockerfile, this image is NOT self-contained: the functional suite needs a
# real Postgres connection (POST /api/imports/runs has no in-memory fallback), so this always runs
# joined to the compose project that already started compose.yaml's `postgres` service --
# see compose.e2e.yaml's `functional-e2e` service and both workflow files' `e2e-functional` jobs
# for how DATABASE_URL is passed through at `docker compose run` time rather than baked in here.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# Manifests-only layer first (mirrors e2e-visual.Dockerfile's and apps/api/Dockerfile's caching
# pattern): npm ci only re-runs when a package.json or the lockfile actually changes, not on every
# source edit.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/persistence/package.json packages/persistence/package.json
COPY packages/test-fixtures/package.json packages/test-fixtures/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci

COPY . .

CMD ["npm", "run", "test:e2e:functional"]
