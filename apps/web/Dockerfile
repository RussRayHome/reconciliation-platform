FROM node:26.1.0-alpine AS deps
WORKDIR /app

ARG NPM_VERSION=11.14.1
RUN npm install -g "npm@${NPM_VERSION}"

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

FROM deps AS build
ARG VITE_ENABLE_DEVELOPER_DASHBOARD=false
ARG VITE_ENVIRONMENT_PATH_SEGMENT=
ENV VITE_ENABLE_DEVELOPER_DASHBOARD=${VITE_ENABLE_DEVELOPER_DASHBOARD}
ENV VITE_ENVIRONMENT_PATH_SEGMENT=${VITE_ENVIRONMENT_PATH_SEGMENT}
WORKDIR /app
COPY . .
RUN npm run build --workspace @recon/web

FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1