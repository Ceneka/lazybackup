#!/usr/bin/env bash
# Start a production image and hit /api/health (migrations + native addons).
set -euo pipefail

IMAGE_SMOKE="${IMAGE_SMOKE:-lazybackup:smoke}"
SMOKE_NAME="${SMOKE_NAME:-lazybackup-smoke-$$}"
PORT="${SMOKE_PORT:-3012}"

cleanup() {
  docker rm -f "$SMOKE_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

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
echo "==> Production image smoke OK"
