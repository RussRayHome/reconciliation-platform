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

FROM node:26.1.0-alpine AS build-base
WORKDIR /app

ARG NPM_VERSION=11.14.1
RUN npm install -g "npm@${NPM_VERSION}"

COPY --from=manifests / /app/

FROM build-base AS deps
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY apps/api ./apps/api
COPY packages/config ./packages/config
COPY packages/core ./packages/core
COPY packages/domain ./packages/domain
COPY packages/persistence ./packages/persistence
COPY packages/test-fixtures ./packages/test-fixtures
COPY packages/ui ./packages/ui
COPY tsconfig.json tsconfig.base.json tsconfig.typecheck.json ./
RUN npm run build --workspace @recon/api

FROM node:26.1.0-alpine AS runtime-base
WORKDIR /app
COPY --from=manifests / /app/

FROM runtime-base AS prod-deps
RUN npm ci --omit=dev

FROM docker:28.1.1-cli AS docker-cli

FROM build-base AS dev
ENV NODE_ENV=test
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV RECONCILIATION_RUN_STORE_PATH=/var/lib/reconciliation/latest-reconciliation-run.json

ARG INSTALL_PLAYWRIGHT=false

RUN mkdir -p /usr/local/libexec/docker/cli-plugins
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist

RUN if [ "${INSTALL_PLAYWRIGHT}" = "true" ]; then npx playwright install --with-deps chromium; fi && \
	mkdir -p /var/lib/reconciliation /ms-playwright && \
	chown -R node:node /app /var/lib/reconciliation /ms-playwright

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/index.cjs"]

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