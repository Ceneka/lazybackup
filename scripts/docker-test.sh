#!/usr/bin/env bash
# Run unit tests + production image smoke on Alpine (same libc as GHCR).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE_TEST="${IMAGE_TEST:-lazybackup:test}"
IMAGE_SMOKE="${IMAGE_SMOKE:-lazybackup:smoke}"
SMOKE_NAME="${SMOKE_NAME:-lazybackup-smoke-$$}"
PORT="${SMOKE_PORT:-3012}"

cleanup() {
  docker rm -f "$SMOKE_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Building Alpine test image ($IMAGE_TEST)"
docker build --target test -t "$IMAGE_TEST" .

echo "==> Running bun test on Alpine"
docker run --rm "$IMAGE_TEST"

echo "==> Building Alpine production image ($IMAGE_SMOKE)"
docker build -t "$IMAGE_SMOKE" .

echo "==> Smoke-testing production image (migrations + /api/health)"
docker run -d --name "$SMOKE_NAME" -p "${PORT}:3000" \
  -e DATABASE_URL=file:/tmp/lazybackup-smoke.db \
  -e AUTH_SECRET=smoke-test-secret \
  -e PORT=3000 \
  "$IMAGE_SMOKE" >/dev/null

ok=0
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
    ok=1
    break
  fi
  sleep 1
done

if [[ "$ok" -ne 1 ]]; then
  echo "Smoke healthcheck failed. Container logs:" >&2
  docker logs "$SMOKE_NAME" >&2 || true
  exit 1
fi

curl -s "http://127.0.0.1:${PORT}/api/health"
echo
echo "==> Alpine unit tests + production smoke OK"
