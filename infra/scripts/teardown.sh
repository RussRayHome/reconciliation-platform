#!/usr/bin/env bash
# Snapshot RDS then destroy the EphemeralStack for one region.
# The PersistentStack (ECR, S3, IAM, secrets) is left intact.
# Snapshot ID is saved to .last-snapshot.<region> for use by rebuild.sh.
# Usage: bash scripts/teardown.sh [--region us-east-2]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

# Default matches REGIONS' primary entry in lib/config.ts -- keep the two in sync.
REGION="us-east-2"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

STACK_NAME="ReconEphemeralStack-${REGION}"
SNAPSHOT_FILE="${INFRA_DIR}/.last-snapshot.${REGION}"

# Resolve the physical RDS instance ID from the CloudFormation stack
echo "Resolving RDS instance ID from stack ${STACK_NAME} (${REGION})..."
DB_ID=$(aws cloudformation describe-stack-resources \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query "StackResources[?ResourceType=='AWS::RDS::DBInstance'].PhysicalResourceId" \
  --output text 2>/dev/null || true)

if [[ -z "$DB_ID" ]]; then
  echo "No RDS instance found in stack — skipping snapshot."
else
  SNAPSHOT_ID="recon-snap-${REGION}-$(date +%Y%m%d-%H%M%S)"
  echo "Creating RDS snapshot: ${SNAPSHOT_ID}"
  aws rds create-db-snapshot \
    --region "$REGION" \
    --db-instance-identifier "$DB_ID" \
    --db-snapshot-identifier "$SNAPSHOT_ID"

  echo "Waiting for snapshot to complete (this takes ~5 minutes)..."
  aws rds wait db-snapshot-completed --region "$REGION" --db-snapshot-identifier "$SNAPSHOT_ID"

  echo "$SNAPSHOT_ID" > "$SNAPSHOT_FILE"
  echo "Snapshot complete: ${SNAPSHOT_ID}"
fi

echo ""
echo "Destroying ${STACK_NAME}..."
cd "$INFRA_DIR"
npx cdk destroy "$STACK_NAME" --force

echo ""
echo "Teardown complete."
[[ -f "$SNAPSHOT_FILE" ]] && echo "Restore with: npm run infra:up -- --region ${REGION}  (snapshot: $(cat "$SNAPSHOT_FILE"))"
