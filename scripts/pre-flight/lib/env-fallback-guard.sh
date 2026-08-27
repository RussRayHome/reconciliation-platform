#!/usr/bin/env bash
# Drift review finding #06 (part 2): every pre-flight/deploy script silently falls back to its
# `.fallback` env file (known placeholder secrets -- change-dev-password, change-stage-jwt-secret,
# etc., see ISSUE-022) whenever the real one is missing, with nothing louder than a one-line
# "using example values" log. That's an acceptable safety net for dev (a local, unexposed
# database), but for anything else -- stage today, whatever comes after it -- it means a missing
# env file silently boots a real, reachable environment with well-known credentials rather than
# failing the deploy outright.
#
# guard_env_fallback <fallback-file-path>: call this from inside the branch that's about to
# select the fallback file as the source of truth (i.e. the real env file was not found). No-ops
# for a `dev` fallback file; for anything else, requires ALLOW_ENV_FALLBACK=1 to proceed and exits
# non-zero with a clear message otherwise. "dev" is determined from the fallback file's own name
# (`.env.docker.dev.fallback` vs `.env.docker.stage.fallback`), the same convention already used
# to select which fallback file a script defaults to.
guard_env_fallback() {
  local fallback_file="$1"
  local fallback_basename
  fallback_basename="$(basename "$fallback_file")"

  case "$fallback_basename" in
    *.dev.fallback)
      return 0
      ;;
  esac

  if [[ "${ALLOW_ENV_FALLBACK:-}" == "1" ]]; then
    printf 'Warning: using placeholder values from %s (ALLOW_ENV_FALLBACK=1 override).\n' \
      "$fallback_file" >&2
    return 0
  fi

  printf 'Refusing to silently fall back to %s.\n' "$fallback_file" >&2
  printf 'This is not a dev environment fallback file, and it contains known placeholder\n' >&2
  printf 'secrets (see ISSUE-022) rather than real credentials.\n' >&2
  printf 'Set ALLOW_ENV_FALLBACK=1 to override deliberately, or provide the real env file.\n' >&2
  exit 1
}
