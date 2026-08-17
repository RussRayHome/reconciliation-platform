#!/usr/bin/env bash
# Deploy (or redeploy) the EphemeralStack for one region.
# If .last-snapshot.<region> exists, restores RDS from that snapshot.
# Usage: bash scripts/rebuild.sh [snapshot-id] [--region us-east-2]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

# Default matches REGIONS' primary entry in lib/config.ts -- keep the two in sync.
REGION="us-east-2"
SNAPSHOT_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    *) SNAPSHOT_ID="$1"; shift ;;
  esac
done

SNAPSHOT_FILE="${INFRA_DIR}/.last-snapshot.${REGION}"

# Snapshot ID can come from: arg > .last-snapshot.<region> file > none (fresh DB)
if [[ -z "$SNAPSHOT_ID" && -f "$SNAPSHOT_FILE" ]]; then
  SNAPSHOT_ID=$(cat "$SNAPSHOT_FILE")
fi

STACK_NAME="ReconEphemeralStack-${REGION}"
cd "$INFRA_DIR"

if [[ -n "$SNAPSHOT_ID" ]]; then
  echo "Deploying ${STACK_NAME} from snapshot: ${SNAPSHOT_ID}"
  npx cdk deploy "$STACK_NAME" \
    --require-approval never \
    --context "rdsSnapshotId=${SNAPSHOT_ID}"
else
  echo "Deploying ${STACK_NAME} with a fresh database..."
  npx cdk deploy "$STACK_NAME" --require-approval never
fi

echo ""
echo "Rebuild complete. App URL printed above."
echo "If this is the first deploy for ${REGION}, or DnsStack hasn't been pointed at it yet, see"
echo "README.md's runbook for updating ReconDnsStack's activeRegionAlbDnsName."
