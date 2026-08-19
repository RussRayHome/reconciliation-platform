#!/usr/bin/env bash
# Copy the primary region's latest RDS snapshot to both standby regions, so a cold standby has
# something recent to restore from during a real failover -- without this, "cold standby" would
# mean starting from an empty database. Run manually/periodically (e.g. before a teardown), not
# on a schedule -- no EventBridge/Lambda automation, matching the near-zero-cost DR posture.
# Usage: bash scripts/dr-snapshot-copy.sh [--source-region us-east-2] [--snapshot-id <id>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

# Defaults match lib/config.ts's REGIONS list -- keep the two in sync.
SOURCE_REGION="us-east-2"
STANDBY_REGIONS=("us-east-1" "us-west-2")
SNAPSHOT_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-region) SOURCE_REGION="$2"; shift 2 ;;
    --snapshot-id) SNAPSHOT_ID="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$SNAPSHOT_ID" ]]; then
  SNAPSHOT_FILE="${INFRA_DIR}/.last-snapshot.${SOURCE_REGION}"
  if [[ -f "$SNAPSHOT_FILE" ]]; then
    SNAPSHOT_ID=$(cat "$SNAPSHOT_FILE")
  else
    echo "No --snapshot-id given and no ${SNAPSHOT_FILE} found." >&2
    echo "Run scripts/teardown.sh first (it snapshots before destroying), or pass --snapshot-id." >&2
    exit 1
  fi
fi

echo "Copying snapshot ${SNAPSHOT_ID} from ${SOURCE_REGION} to ${#STANDBY_REGIONS[@]} standby region(s)..."

for target_region in "${STANDBY_REGIONS[@]}"; do
  echo ""
  echo "--- ${SOURCE_REGION} -> ${target_region} ---"
  TARGET_SNAPSHOT_ID="${SNAPSHOT_ID}-copy-${target_region}"

  aws rds copy-db-snapshot \
    --region "$target_region" \
    --source-region "$SOURCE_REGION" \
    --source-db-snapshot-identifier "$SNAPSHOT_ID" \
    --target-db-snapshot-identifier "$TARGET_SNAPSHOT_ID"

  echo "Waiting for copy to complete in ${target_region} (this takes several minutes)..."
  aws rds wait db-snapshot-completed \
    --region "$target_region" \
    --db-snapshot-identifier "$TARGET_SNAPSHOT_ID"

  echo "$TARGET_SNAPSHOT_ID" > "${INFRA_DIR}/.last-snapshot.${target_region}"
  echo "Copied: ${TARGET_SNAPSHOT_ID}"
done

echo ""
echo "Done. Each standby region's .last-snapshot.<region> now points at the copy scripts/dr-failover.sh will use."
