FROM scratch AS manifests
COPY package.json package-lock.json /
COPY apps/api/package.json /apps/api/package.json
COPY apps/web/package.json /apps/web/package.json
COPY packages/config/package.json /packages/config/package.json
COPY packages/core/package.json /packages/core/package.json
COPY packages/domain/package.json /packages/domain/package.json
COPY packages/persistence/package.json /packages/persistence/package.json
COPY packages/test-fixtures/package.json /packages/test-fixtures/package.json
COPY packages/ui/package.json /packages/ui/package.json

# ── Build pipeline (Alpine — small and fast) ──────────────────────────────────

FROM node:26.5.1-alpine AS build-base
WORKDIR /app
ARG NPM_VERSION=11.14.1
RUN npm install -g "npm@${NPM_VERSION}"
COPY --from=manifests / /app/

FROM build-base AS deps
RUN npm ci

FROM deps AS build
COPY apps/api ./apps/api
COPY packages/config ./packages/config
COPY packages/core ./packages/core
COPY packages/domain ./packages/domain
COPY packages/persistence ./packages/persistence
COPY packages/test-fixtures ./packages/test-fixtures
COPY packages/ui ./packages/ui
COPY tsconfig.json tsconfig.base.json tsconfig.typecheck.json ./
RUN npm run build --workspace @recon/api

# Prune dev deps in-place — avoids a second full npm ci
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ── Production runtime (Alpine) ───────────────────────────────────────────────

FROM node:26.5.1-alpine AS runtime-base
WORKDIR /app

# The node:26.5.1-alpine tag pins a base-image layer that can lag Alpine's own package repo --
# docker-validate's Trivy scan started failing on CVE-2026-14456 (libssl3/libcrypto3, fixed
# upstream at 3.5.8-r0) while this tag still shipped 3.5.7-r0. `apk upgrade` re-resolves every
# installed package against the current Alpine index at build time, independent of whatever was
# frozen into the pulled layer, so this doesn't wait on Docker Hub to republish the tag.
RUN apk upgrade --no-cache

COPY --from=manifests / /app/

# The base image ships npm, and npm vendors its own dependency tree under
# /usr/local/lib/node_modules/npm/node_modules. Trivy scans those as part of the image and they
# account for every HIGH/CRITICAL finding this image has had (tar, brace-expansion, undici,
# ip-address) -- none of which are project dependencies or appear in package-lock.json, so no
# lockfile change can fix them and `npm audit` never sees them either. This stage runs the built
# CJS bundle directly (CMD and HEALTHCHECK both invoke `node`, never npm), so the package manager
# is dead weight in a production runtime. Deleting it removes the vulnerable code rather than
# suppressing the finding, and keeps the docker-validate Trivy gate strict.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

FROM runtime-base AS runtime
ENV NODE_ENV=production
ENV RECONCILIATION_RUN_STORE_PATH=/var/lib/reconciliation/latest-reconciliation-run.json

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist

RUN mkdir -p /var/lib/reconciliation && chown -R node:node /app /var/lib/reconciliation

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/api/dist/index.cjs"]

# ── Dev / tools target (Debian — required for Playwright --with-deps) ─────────

# Docker CLI and Trivy binaries copied directly — avoids apt-get overhead (~50s)
FROM docker:29-cli AS docker-cli-source
FROM aquasec/trivy:0.73.0 AS trivy-source

FROM node:26.5.1-bookworm-slim AS dev-base
WORKDIR /app
ARG NPM_VERSION=11.14.1
RUN apt-get update && \
	apt-get -y upgrade && \
	apt-get install -y --no-install-recommends git ca-certificates && \
	rm -rf /var/lib/apt/lists/* && \
    npm install -g "npm@${NPM_VERSION}"
COPY --from=manifests / /app/

FROM dev-base AS dev-deps
RUN npm install

# Chromium system deps via RUN (small packages, commits fine); binary via COPY from local pre-download
# Avoids virtiofs layer-commit hang that occurs when downloading large binaries inside RUN
FROM dev-base AS playwright-browsers
ARG PLAYWRIGHT_VERSION=1.62.1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install -g "@playwright/test@${PLAYWRIGHT_VERSION}" && \
	playwright install-deps chromium && \
	rm -rf /root/.npm
COPY playwright-browsers /ms-playwright

FROM playwright-browsers AS dev
ENV NODE_ENV=test
ENV RECONCILIATION_RUN_STORE_PATH=/var/lib/reconciliation/latest-reconciliation-run.json

COPY --from=docker-cli-source /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli-source /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=trivy-source /usr/local/bin/trivy /usr/local/bin/trivy

COPY --chown=node:node --from=dev-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist

RUN mkdir -p /var/lib/reconciliation && chown node:node /var/lib/reconciliation

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/api/dist/index.cjs"]

# Default build target should be the production runtime image.
FROM runtime AS final
USER node
