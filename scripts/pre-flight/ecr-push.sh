#!/usr/bin/env bash
# Build production Docker images and push them to AWS ECR for deployment.
#
# Usage (via npm scripts — preferred):
#   npm run aws:ecr:push
#
# Usage (direct):
#   AWS_ACCOUNT_ID=123456789012 AWS_REGION=us-east-1 bash scripts/pre-flight/ecr-push.sh
#
# Required env vars:
#   AWS_ACCOUNT_ID — 12-digit AWS account number
#
# Optional env vars:
#   AWS_REGION    — AWS region (default: us-east-1)
#   ECR_REGISTRY  — full ECR registry host (default: <account>.dkr.ecr.<region>.amazonaws.com)
#   IMAGE_TAG     — image tag to apply (default: short git SHA, or 'latest' if not in a git repo)
#
# What it does:
#   1. Authenticates Docker with ECR (aws ecr get-login-password)
#   2. Builds the API image using the 'runtime' Dockerfile target
#   3. Builds the web image
#   4. Tags and pushes both images to ECR
#
# Prerequisites: aws CLI configured with push permissions to the target ECR repositories.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REGISTRY="${ECR_REGISTRY:-${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || printf 'latest')}"

API_REPO="${ECR_API_REPO:-recon/api}"
WEB_REPO="${ECR_WEB_REPO:-recon/web}"

API_IMAGE="${ECR_REGISTRY}/${API_REPO}:${IMAGE_TAG}"
WEB_IMAGE="${ECR_REGISTRY}/${WEB_REPO}:${IMAGE_TAG}"

printf 'Authenticating with ECR (%s)...\n' "$ECR_REGISTRY"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

printf 'Building API production image (%s)...\n' "$API_IMAGE"
docker build \
  --target runtime \
  -f "$ROOT_DIR/apps/api/Dockerfile" \
  -t "$API_IMAGE" \
  "$ROOT_DIR"

printf 'Building web production image (%s)...\n' "$WEB_IMAGE"
docker build \
  -f "$ROOT_DIR/apps/web/Dockerfile" \
  -t "$WEB_IMAGE" \
  "$ROOT_DIR"

printf 'Pushing API image...\n'
docker push "$API_IMAGE"

printf 'Pushing web image...\n'
docker push "$WEB_IMAGE"

printf 'ECR push complete.\n'
printf '  API: %s\n' "$API_IMAGE"
printf '  Web: %s\n' "$WEB_IMAGE"
printf '\nNext: update ECS task definitions to use these image tags and trigger a new deployment.\n'
