#!/usr/bin/env bash
# One-time setup: bootstrap CDK's toolkit stack in all three DR regions, then deploy the two
# stacks that are deploy-once/destroy-never by design (DnsStack, and the primary region's
# PersistentStack) -- these deliberately don't belong in rebuild.sh/teardown.sh's repeat cycle.
# Safe to re-run: `cdk bootstrap` and `cdk deploy` are both idempotent.
# Usage: bash scripts/bootstrap.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
cd "$INFRA_DIR"

# Must match lib/config.ts's REGIONS list.
REGIONS=("us-east-2" "us-east-1" "us-west-2")
PRIMARY_REGION="us-east-2"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

echo "Bootstrapping CDK in ${#REGIONS[@]} regions for account ${ACCOUNT}..."
for region in "${REGIONS[@]}"; do
  echo ""
  echo "--- ${region} ---"
  npx cdk bootstrap "aws://${ACCOUNT}/${region}"
done

echo ""
echo "Deploying ReconDnsStack (creates the hosted zone; no record until a region is up)..."
npx cdk deploy ReconDnsStack --require-approval never

echo ""
echo "Deploying the primary region's persistent resources (ReconPersistentStack-${PRIMARY_REGION})..."
npx cdk deploy "ReconPersistentStack-${PRIMARY_REGION}" --require-approval never

echo ""
echo "Bootstrap complete. Next steps (see README.md's runbook):"
echo "  1. npm run infra:push               # build + push API/web images to the primary region's ECR"
echo "  2. npm run infra:up                 # deploy the primary region's EphemeralStack"
echo "  3. Update ReconDnsStack's activeRegionAlbDnsName context to the primary's AlbDnsName output"
echo "  4. ALTER ROLE app_user WITH PASSWORD '<appUserSecret value>' against the new database"
echo "  5. npm run infra:smoke-test -- --base-url https://rb-kinneysoft.com"
