#!/usr/bin/env bash
# Generate a TLS cert/key for local HTTPS on the `web` (nginx) container, for the dev or stage
# environment.
#
# Usage (via npm scripts — preferred):
#   npm run docker:cert:dev
#   npm run docker:cert:stage
#
# Usage (direct):
#   bash scripts/pre-flight/generate-tls-cert.sh <dev|stage>
#
# Called automatically by deploy.sh for both environments before the stack is built, so a fresh
# checkout gets a working cert without a manual step.
#
# Prefers mkcert (https://github.com/FiloSottile/mkcert): certs it issues are trusted by the local
# machine's browsers/OS with no "proceed anyway" click, because `mkcert -install` adds its root CA
# to the system trust store. Falls back to a plain openssl self-signed cert -- still
# browser-flagged as untrusted -- on machines without mkcert (e.g. CI, or a fresh checkout before
# `mkcert -install` has been run).
#
# Skips regeneration if a cert already exists and either: mkcert is installed and the existing
# cert was already issued by it, or mkcert is unavailable and the existing (self-signed) cert has
# more than 30 days of validity left. Pass FORCE_REGENERATE=true to always regenerate.
#
# Never committed — see .gitignore.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENVIRONMENT="${1:-}"
MIN_DAYS_REMAINING=30

case "$ENVIRONMENT" in
  dev | stage) ;;
  *)
    printf 'Usage: %s <dev|stage>\n' "$0" >&2
    exit 1
    ;;
esac

CERT_DIR="$ROOT_DIR/certs/$ENVIRONMENT"
CERT_FILE="$CERT_DIR/dev-cert.pem"
KEY_FILE="$CERT_DIR/dev-key.pem"

mkdir -p "$CERT_DIR"

cert_is_mkcert_issued() {
  openssl x509 -in "$CERT_FILE" -noout -issuer 2>/dev/null | grep -q "mkcert"
}

if [[ "${FORCE_REGENERATE:-false}" != "true" && -f "$CERT_FILE" && -f "$KEY_FILE" ]]; then
  if command -v mkcert >/dev/null 2>&1; then
    if cert_is_mkcert_issued; then
      echo "$ENVIRONMENT TLS cert already present and mkcert-trusted: $CERT_FILE"
      exit 0
    fi
    echo "Existing $ENVIRONMENT TLS cert predates mkcert being available here; regenerating with it."
  elif openssl x509 -checkend "$((MIN_DAYS_REMAINING * 86400))" -noout -in "$CERT_FILE" >/dev/null 2>&1; then
    echo "$ENVIRONMENT TLS cert already present and valid for at least $MIN_DAYS_REMAINING more days: $CERT_FILE"
    exit 0
  else
    echo "Existing $ENVIRONMENT TLS cert is missing or expiring soon; regenerating."
  fi
fi

if command -v mkcert >/dev/null 2>&1; then
  mkcert -cert-file "$CERT_FILE" -key-file "$KEY_FILE" localhost web 127.0.0.1
  echo "Generated mkcert-trusted $ENVIRONMENT TLS cert: $CERT_FILE"
  echo "Trusted automatically by browsers/OS on this machine — no manual 'proceed anyway' needed."
else
  openssl req \
    -x509 \
    -newkey rsa:2048 \
    -sha256 \
    -days 365 \
    -nodes \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,DNS:web,IP:127.0.0.1"
  echo "Generated self-signed $ENVIRONMENT TLS cert (mkcert not found): $CERT_FILE"
  echo "Browsers will flag this as untrusted until you accept/trust it manually."
  echo "Install mkcert (https://github.com/FiloSottile/mkcert) and run 'mkcert -install' for a trusted cert instead."
fi

chmod 600 "$KEY_FILE"
chmod 644 "$CERT_FILE"
