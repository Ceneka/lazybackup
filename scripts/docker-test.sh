#!/usr/bin/env bash
# Run unit tests + production image smoke on Alpine (same libc as GHCR).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE_TEST="${IMAGE_TEST:-lazybackup:test}"
IMAGE_SMOKE="${IMAGE_SMOKE:-lazybackup:smoke}"

echo "==> Building Alpine test image ($IMAGE_TEST)"
docker build --target test -t "$IMAGE_TEST" .

echo "==> Running bun test on Alpine"
docker run --rm "$IMAGE_TEST"

echo "==> Building Alpine production image ($IMAGE_SMOKE)"
docker build -t "$IMAGE_SMOKE" .

IMAGE_SMOKE="$IMAGE_SMOKE" bash "$ROOT/scripts/docker-smoke.sh"
echo "==> Alpine unit tests + production smoke OK"
