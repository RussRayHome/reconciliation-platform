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

WORKDIR /app

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

CMD ["npm", "run", "test:e2e:visual"]
