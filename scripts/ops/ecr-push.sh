#!/usr/bin/env bash
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
  --build-arg VITE_ENABLE_DEVELOPER_DASHBOARD=false \
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
