#!/bin/sh
set -eu

cd /app

SOURCE_HASH_FILE="apps/api/dist/.tools-source-hash"

collect_source_files() {
  for directory in \
    apps/api/src \
    packages/config/src \
    packages/core/src \
    packages/domain/src \
    packages/persistence/src \
    packages/test-fixtures/src \
    packages/ui/src; do
    if [ -d "$directory" ]; then
      find "$directory" -type f
    fi
  done

  for file_path in \
    package.json \
    package-lock.json \
    tsconfig.json \
    tsconfig.base.json \
    tsconfig.typecheck.json \
    apps/api/package.json \
    apps/api/tsconfig.json \
    apps/api/tsup.config.ts; do
    if [ -f "$file_path" ]; then
      printf '%s\n' "$file_path"
    fi
  done
}

compute_source_hash() {
  collect_source_files \
    | LC_ALL=C sort -u \
    | while IFS= read -r file_path; do
        [ -n "$file_path" ] || continue
        sha256sum "$file_path"
      done \
    | sha256sum \
    | awk '{print $1}'
}

ensure_playwright_browsers() {
  if ! command -v npx >/dev/null 2>&1; then
    echo "[tools-startup-guard] Skipping Playwright browser check because npx is unavailable."
    return
  fi

  # `chromium` pulls in three separate downloads (chromium itself, ffmpeg, and
  # chromium-headless-shell -- the variant Playwright's test runner launches by default for
  # headless runs). Checking only the first "Install location:" line missed the headless-shell
  # directory entirely: after a Playwright version bump it can be the only one still absent,
  # leaving "browserType.launch: Executable doesn't exist" failures even though this check
  # reported everything as current. Check every expected location, not just the first.
  expected_browser_dirs="$(npx playwright install --dry-run chromium 2>/dev/null | awk -F': *' '/Install location:/ {print $2}' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

  if [ -z "$expected_browser_dirs" ]; then
    echo "[tools-startup-guard] Unable to resolve expected Playwright browser directories; skipping browser sync."
    return
  fi

  missing_dir=0
  for dir in $expected_browser_dirs; do
    if [ ! -d "$dir" ]; then
      missing_dir=1
    fi
  done

  if [ "$missing_dir" -eq 0 ]; then
    echo "[tools-startup-guard] Playwright Chromium browsers are current ($expected_browser_dirs)."
    return
  fi

  echo "[tools-startup-guard] Installing Playwright Chromium browsers for tools runtime ($expected_browser_dirs)."
  if npx playwright install --with-deps chromium; then
    echo "[tools-startup-guard] Playwright Chromium browser install completed."
  else
    echo "[tools-startup-guard] Warning: Playwright Chromium install failed; E2E checks may fail until browsers are installed."
  fi
}

current_hash="$(compute_source_hash)"
needs_build=0

if [ ! -f "apps/api/dist/index.cjs" ]; then
  needs_build=1
elif [ ! -f "$SOURCE_HASH_FILE" ]; then
  needs_build=1
elif [ "$(cat "$SOURCE_HASH_FILE" 2>/dev/null || true)" != "$current_hash" ]; then
  needs_build=1
fi

if [ "$needs_build" -eq 1 ]; then
  echo "[tools-startup-guard] Rebuilding @recon/api dist because source hash changed or dist is missing."
  npm run build --workspace @recon/api
  mkdir -p "$(dirname "$SOURCE_HASH_FILE")"
  printf '%s\n' "$current_hash" >"$SOURCE_HASH_FILE"
else
  echo "[tools-startup-guard] Existing @recon/api dist is current."
fi

ensure_playwright_browsers

if [ "${TOOLS_STARTUP_GUARD_SKIP_START:-0}" = "1" ]; then
  exit 0
fi

exec node apps/api/dist/index.cjs