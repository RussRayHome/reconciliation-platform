FROM node:26.5.1-alpine AS deps
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
ARG VITE_ENVIRONMENT_PATH_SEGMENT=
ENV VITE_ENVIRONMENT_PATH_SEGMENT=${VITE_ENVIRONMENT_PATH_SEGMENT}
WORKDIR /app
COPY . .
RUN npm run build --workspace @recon/web

# nginx.conf's `ssl_certificate` directives are unconditional (both listeners live in the same
# server block, see apps/web/nginx.conf), so nginx cannot start at all without a cert present --
# including in environments that never serve HTTPS externally, like stage, and including a bare
# `docker compose -f compose.yaml` invocation with no environment overlay (the CI smoke test:
# .github/workflows/docker-validate.yml, scripts/docker-smoke-test.ts). Baking a throwaway
# self-signed cert into the image makes every one of those self-sufficient by default; the dev
# compose overlay's bind mount (compose.dev.yaml, generate-dev-cert.sh) shadows this with a
# persistent host-generated cert so interactive dev doesn't get a new untrusted cert every rebuild.
FROM alpine:3.21 AS dev-cert
RUN apk add --no-cache openssl && \
    openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes \
      -keyout /dev-key.pem -out /dev-cert.pem \
      -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,DNS:web,IP:127.0.0.1"

FROM nginxinc/nginx-unprivileged:mainline-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY --from=dev-cert /dev-cert.pem /etc/nginx/certs/dev-cert.pem
COPY --from=dev-cert /dev-key.pem /etc/nginx/certs/dev-key.pem
# Copied as root by default (the dev-cert stage is plain alpine -- no "nginx" group to chown to
# there; that group only exists in this base image). Fixed up here instead: owned by root,
# group-readable only, so the process serving this cert (this image's own default, non-root
# USER 101/nginx) cannot modify its own key even if compromised. USER is switched back
# immediately after -- this stage must not end as root, or it defeats the whole reason this base
# image exists.
USER root
RUN chown root:nginx /etc/nginx/certs/dev-cert.pem /etc/nginx/certs/dev-key.pem && \
    chmod 640 /etc/nginx/certs/dev-cert.pem /etc/nginx/certs/dev-key.pem
USER nginx

EXPOSE 8080 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1