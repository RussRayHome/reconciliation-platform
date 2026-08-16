#!/usr/bin/env bash
# Fail over to a standby region: deploy its EphemeralStack from the latest cross-region-copied
# snapshot, then repoint the apex domain at it via DnsStack. A deliberate, scripted action -- not
# automated health-check failover, which would require an always-running standby to check against
# and contradicts the cold-standby DR posture (see README.md).
# Usage: bash scripts/dr-failover.sh --region us-east-1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
cd "$INFRA_DIR"

REGION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REGION" ]]; then
  echo "Usage: bash scripts/dr-failover.sh --region <standby-region-code>" >&2
  exit 1
fi

SNAPSHOT_FILE="${INFRA_DIR}/.last-snapshot.${REGION}"
if [[ ! -f "$SNAPSHOT_FILE" ]]; then
  echo "No ${SNAPSHOT_FILE} found -- run scripts/dr-snapshot-copy.sh first." >&2
  exit 1
fi
SNAPSHOT_ID=$(cat "$SNAPSHOT_FILE")

STACK_NAME="ReconEphemeralStack-${REGION}"

echo "=== Failing over to ${REGION} from snapshot ${SNAPSHOT_ID} ==="

echo ""
echo "Step 1/3: deploying ${STACK_NAME}..."
npx cdk deploy "$STACK_NAME" \
  --require-approval never \
  --context "rdsSnapshotId=${SNAPSHOT_ID}"

echo ""
echo "Step 2/3: resolving the new region's ALB DNS name..."
ALB_DNS_NAME=$(aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" \
  --output text)

if [[ -z "$ALB_DNS_NAME" || "$ALB_DNS_NAME" == "None" ]]; then
  echo "Could not resolve AlbDnsName output from ${STACK_NAME}." >&2
  exit 1
fi
echo "ALB DNS name: ${ALB_DNS_NAME}"

echo ""
echo "Step 3/3: repointing ReconDnsStack's apex record at ${REGION}..."
npx cdk deploy ReconDnsStack \
  --require-approval never \
  --context "activeRegionAlbDnsName=${ALB_DNS_NAME}" \
  --context "activeRegion=${REGION}"

echo ""
echo "=== Failover to ${REGION} complete ==="
echo "Do not trust this region until the smoke test passes against the live domain:"
echo "  npm run infra:smoke-test -- --base-url https://rb-kinneysoft.com"
echo ""
echo "Reminder: ALTER ROLE app_user WITH PASSWORD '<appUserSecret value>' is only needed if this"
echo "snapshot predates that credential (see README.md) -- most snapshots already have it set."
