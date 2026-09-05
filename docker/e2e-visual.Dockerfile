# Canonical rendering environment for the `visual` Playwright project (P4 of the UI-testing
# breakout plan). Pinned to an exact tag, not `latest` -- CHANGELOG.md documents a past incident
# from a version mismatch between @playwright/test and its bundled Chromium revision, and an
# unpinned image would invalidate every baseline the moment the upstream tag moves.
#
# Self-contained by design: this does NOT join the app's docker-compose network or depend on the
# compose-managed postgres/api/web services. It spawns its own dev:api:test/dev:web:test child
# processes internally via playwright.config.ts's existing webServer config (in-memory backend,
# same ALLOW_LOCAL_LOGIN_FALLBACK/DISABLE_API_RATE_LIMIT path CI already uses) -- the same thing
# CI does on a bare ubuntu-latest runner today, just inside this pinned Linux image instead of
# whatever OS/Chromium build GitHub's runner happens to have. That's the whole point: fix the
# OS-level rendering difference (fonts, subpixel AA, scrollbar chrome) that caused two ungraded
# baseline sets, without taking on docker-compose networking, postgres, or port-conflict risk
# against whatever app stack a developer already has running locally.
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

# Same login-fallback and rate-limit env vars CI's dashboard-status.yml e2e job sets -- this
# runtime has no real Postgres (in-memory backend), so the fallback credential path in
# apps/web/tests/e2e/auth.ts is the only login path available, and sequential logins across the
# visual spec's viewport variants can trip the API's 120 req/min rate limit without the second var.
ENV ALLOW_LOCAL_LOGIN_FALLBACK=true
ENV DISABLE_API_RATE_LIMIT=true
# Baked into the image unconditionally, not passed at `docker run` time -- playwright.config.ts's
# visual project checks this and refuses to run outside it, so a baseline recorded against a
# developer's host Chromium (different font rasterization) can never silently pass as canonical.
ENV PLAYWRIGHT_CANONICAL_CONTAINER=1

# Manifests-only layer first (mirrors apps/api/Dockerfile's caching pattern): npm ci only
# re-runs when a package.json or the lockfile actually changes, not on every source edit.
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

CMD ["npm", "run", "test:e2e:visual"]
