#!/usr/bin/env bash
# Snapshot RDS then destroy the EphemeralStack.
# The PersistentStack (ECR, S3, IAM, DB secret) is left intact.
# Snapshot ID is saved to .last-snapshot for use by rebuild.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
STACK_NAME="ReconEphemeralStack"
SNAPSHOT_FILE="${INFRA_DIR}/.last-snapshot"

# Resolve the physical RDS instance ID from the CloudFormation stack
echo "Resolving RDS instance ID from stack ${STACK_NAME}..."
DB_ID=$(aws cloudformation describe-stack-resources \
  --stack-name "$STACK_NAME" \
  --query "StackResources[?ResourceType=='AWS::RDS::DBInstance'].PhysicalResourceId" \
  --output text 2>/dev/null || true)

if [[ -z "$DB_ID" ]]; then
  echo "No RDS instance found in stack — skipping snapshot."
else
  SNAPSHOT_ID="recon-snap-$(date +%Y%m%d-%H%M%S)"
  echo "Creating RDS snapshot: ${SNAPSHOT_ID}"
  aws rds create-db-snapshot \
    --db-instance-identifier "$DB_ID" \
    --db-snapshot-identifier "$SNAPSHOT_ID"

  echo "Waiting for snapshot to complete (this takes ~5 minutes)..."
  aws rds wait db-snapshot-completed --db-snapshot-identifier "$SNAPSHOT_ID"

  echo "$SNAPSHOT_ID" > "$SNAPSHOT_FILE"
  echo "Snapshot complete: ${SNAPSHOT_ID}"
fi

echo ""
echo "Destroying ${STACK_NAME}..."
cd "$INFRA_DIR"
npx cdk destroy "$STACK_NAME" --force

echo ""
echo "Teardown complete."
[[ -f "$SNAPSHOT_FILE" ]] && echo "Restore with: npm run infra:up  (snapshot: $(cat "$SNAPSHOT_FILE"))"
