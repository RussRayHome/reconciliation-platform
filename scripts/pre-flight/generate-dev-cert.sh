#!/usr/bin/env bash
# Generate a self-signed TLS cert/key for local HTTPS on the `web` (nginx) container.
#
# Usage (via npm scripts — preferred):
#   npm run docker:cert:dev
#
# Usage (direct):
#   bash scripts/pre-flight/generate-dev-cert.sh
#
# Called automatically by deploy.sh for the dev environment before the stack is built, so a
# fresh checkout gets a working cert without a manual step. Skips regeneration if a cert already
# exists and has more than 30 days of validity left — pass FORCE_REGENERATE=true to override.
#
# This is local-development-only: the cert is self-signed, so browsers will show an untrusted-cert
# warning until you manually trust it. It is never committed — see .gitignore.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CERT_DIR="$ROOT_DIR/certs/dev"
CERT_FILE="$CERT_DIR/dev-cert.pem"
KEY_FILE="$CERT_DIR/dev-key.pem"
MIN_DAYS_REMAINING=30

mkdir -p "$CERT_DIR"

if [[ "${FORCE_REGENERATE:-false}" != "true" && -f "$CERT_FILE" && -f "$KEY_FILE" ]]; then
  if openssl x509 -checkend "$((MIN_DAYS_REMAINING * 86400))" -noout -in "$CERT_FILE" >/dev/null 2>&1; then
    echo "Dev TLS cert already present and valid for at least $MIN_DAYS_REMAINING more days: $CERT_FILE"
    exit 0
  fi
  echo "Existing dev TLS cert is missing or expiring soon; regenerating."
fi

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

chmod 600 "$KEY_FILE"
chmod 644 "$CERT_FILE"

echo "Generated self-signed dev TLS cert: $CERT_FILE"
echo "Browsers will flag this as untrusted until you accept/trust it manually — expected for local dev."
