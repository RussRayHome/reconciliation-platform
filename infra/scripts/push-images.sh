#!/usr/bin/env bash
# Build and push API + Web Docker images to ECR.
# Run this before `infra:up` whenever the app code has changed.
# Usage: bash scripts/push-images.sh [image-tag]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$INFRA_DIR/../../.." && pwd)"
TAG="${1:-latest}"

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ECR_BASE="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_BASE"

build_and_push() {
  local service="$1"
  local repo_name="recon-${service}"
  local uri="${ECR_BASE}/${repo_name}:${TAG}"
  local context="${REPO_ROOT}"
  local dockerfile="${REPO_ROOT}/apps/${service}/Dockerfile"

  echo ""
  echo "Building ${service} → ${uri}"
  docker build -t "$uri" -f "$dockerfile" "$context"

  echo "Pushing ${service}..."
  docker push "$uri"
  echo "Pushed: $uri"
}

build_and_push api
build_and_push web

echo ""
echo "Images pushed with tag: $TAG"
