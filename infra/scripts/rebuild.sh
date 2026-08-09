#!/usr/bin/env bash
# Deploy (or redeploy) the EphemeralStack.
# If .last-snapshot exists, restores RDS from that snapshot.
# Usage: bash scripts/rebuild.sh [snapshot-id]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
SNAPSHOT_FILE="${INFRA_DIR}/.last-snapshot"

# Snapshot ID can come from: arg > .last-snapshot file > none (fresh DB)
SNAPSHOT_ID="${1:-}"
if [[ -z "$SNAPSHOT_ID" && -f "$SNAPSHOT_FILE" ]]; then
  SNAPSHOT_ID=$(cat "$SNAPSHOT_FILE")
fi

cd "$INFRA_DIR"

if [[ -n "$SNAPSHOT_ID" ]]; then
  echo "Deploying ReconEphemeralStack from snapshot: ${SNAPSHOT_ID}"
  npx cdk deploy ReconEphemeralStack \
    --require-approval never \
    --context "rdsSnapshotId=${SNAPSHOT_ID}"
else
  echo "Deploying ReconEphemeralStack with a fresh database..."
  npx cdk deploy ReconEphemeralStack --require-approval never
fi

echo ""
echo "Rebuild complete. App URL printed above."
