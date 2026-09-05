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

# DS-0002 (trivy config): run as the image's own non-root user instead of root. Ownership is
# established UP FRONT -- /app is created for pwuser and every COPY carries --chown -- so `npm ci`
# writes node_modules as pwuser. The alternative, a trailing `chown -R /app`, would copy the entire
# node_modules tree into an extra image layer and roughly double the image size. Browsers live in
# /ms-playwright, root-owned but world-readable, exactly how the upstream image intends pwuser to
# run.
#
# LOAD-BEARING UID, read before changing either side. compose.e2e.yaml bind-mounts the host repo
# over /app (`- .:/app`), so at RUNTIME the ownership above is replaced by the host checkout's
# ownership -- what this Dockerfile sets governs the build, not the test run. pwuser is uid 1001 in
# mcr.microsoft.com/playwright, and GitHub's ubuntu-latest `runner` user is also uid 1001, which is
# the only reason the container can write test-results/ and blob-report/ back into the mount.
# Measured on a Linux filesystem:
#
#     checkout owned by uid 1001 -> writable YES     (GitHub-hosted runners)
#     checkout owned by uid 1000 -> writable NO
#     checkout owned by uid 0    -> writable NO
#
# So if e2e-functional/e2e-visual ever start failing with EACCES on test-results/ or
# blob-report/, check the runner's uid FIRST -- a self-hosted runner, a changed runner image, or a
# different Playwright base whose pwuser is not 1001 all break this silently and the error will
# point at Playwright, not here. Fixes, in order of preference: set `user:` on both compose.e2e.yaml
# services to the host uid, or chown the checkout to 1001 before the container run. Note macOS
# Docker Desktop maps bind-mount ownership permissively, so a local run will NOT reproduce this.
RUN mkdir -p /app && chown pwuser:pwuser /app
WORKDIR /app
USER pwuser

# Manifests-only layer first (mirrors e2e-visual.Dockerfile's and apps/api/Dockerfile's caching
# pattern): npm ci only re-runs when a package.json or the lockfile actually changes, not on every
# source edit.
COPY --chown=pwuser:pwuser package.json package-lock.json ./
COPY --chown=pwuser:pwuser apps/api/package.json apps/api/package.json
COPY --chown=pwuser:pwuser apps/web/package.json apps/web/package.json
COPY --chown=pwuser:pwuser packages/config/package.json packages/config/package.json
COPY --chown=pwuser:pwuser packages/core/package.json packages/core/package.json
COPY --chown=pwuser:pwuser packages/domain/package.json packages/domain/package.json
COPY --chown=pwuser:pwuser packages/persistence/package.json packages/persistence/package.json
COPY --chown=pwuser:pwuser packages/test-fixtures/package.json packages/test-fixtures/package.json
COPY --chown=pwuser:pwuser packages/ui/package.json packages/ui/package.json
RUN npm ci

COPY --chown=pwuser:pwuser . .

CMD ["npm", "run", "test:e2e:functional"]
