# ISSUE-023: Dev and stage HTTPS served untrusted certs — resolved with mkcert

**Status:** Resolved · **Severity:** Follow-up · **Area:** Deployment / Local Docker
**Location:** `scripts/pre-flight/generate-tls-cert.sh`, `compose.dev.yaml`, `compose.stage.yaml`, `certs/dev/`, `certs/stage/`
**Source:** 2026-08-04

## Problem
`generate-dev-cert.sh` produced a plain openssl self-signed cert for dev's HTTPS listener, so
every browser flagged it as untrusted until manually accepted. Stage had no cert setup at all —
`compose.stage.yaml`'s only published port was plain HTTP; the HTTPS port compose.yaml publishes
by default was left serving the image's baked-in throwaway self-signed cert (apps/web/Dockerfile),
which nothing pointed at.

## Fix
- `scripts/pre-flight/generate-tls-cert.sh` (replaces `generate-dev-cert.sh`) now takes a
  `<dev|stage>` argument and prefers [mkcert](https://github.com/FiloSottile/mkcert) when it's
  installed — mkcert-issued certs are trusted automatically because `mkcert -install` adds its
  root CA to the local trust store. Falls back to the old openssl self-signed behavior when mkcert
  isn't available (CI, or a checkout before `mkcert -install` has run).
- Installed the mkcert root CA into the login keychain (`security add-trusted-cert -k
  ~/Library/Keychains/login.keychain-db`, no sudo needed) — `mkcert -install` itself needs sudo to
  write the System keychain, which isn't available non-interactively; the login-keychain install
  is sufficient for Chrome/Safari's trust evaluation on macOS. Verified with
  `security verify-cert -c certs/dev/dev-cert.pem` / `certs/stage/dev-cert.pem` and live
  `curl https://... ` (no `-k`) against both the dev (`4174`) and stage (`4274`) gateways —
  `SSL certificate verify ok.` on both.
- `compose.stage.yaml`'s `web` service now bind-mounts `certs/stage` the same way
  `compose.dev.yaml` does with `certs/dev`, and gets the same HTTPS healthcheck. Stage's HTTPS
  port is its own `PUBLIC_WEB_HTTPS_PORT` (4274, added to `.env.docker.stage[.fallback]`) so it
  doesn't collide with dev's 4174 when both stacks run at once. Stage still republishes plain HTTP
  unchanged.
- `deploy.sh` now generates a cert for stage as well as dev; `health-check.sh` checks stage's
  HTTPS gateway (in addition to its existing plain-HTTP check).

## Residual gap
Firefox has its own trust store separate from the OS keychain (NSS) — `mkcert -install` normally
seeds that too, but wasn't run interactively here, so Firefox will still flag these certs as
untrusted on this machine. Chrome/Safari, and `curl`/`security verify-cert`, are unaffected.
