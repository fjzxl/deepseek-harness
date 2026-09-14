#!/usr/bin/env bash
# 构建 dsh + dsh-ppt-studio 镜像 / build the dsh + dsh-ppt-studio image.
#
# 用法 / usage:
#   ./docker/build.sh
#   IMAGE_NAME=my-registry/dsh-ppt-studio IMAGE_TAG=v1 ./docker/build.sh
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE="${IMAGE_NAME:-dsh-ppt-studio}:${IMAGE_TAG:-latest}"

exec docker build -f docker/Dockerfile -t "$IMAGE" .
