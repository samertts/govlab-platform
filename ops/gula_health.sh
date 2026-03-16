#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed on this host"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "== docker compose ps =="
docker compose ps || true

echo "== app health =="
if curl -fsS --max-time 10 http://localhost/api/healthz >/dev/null; then
  echo "OK: API health endpoint reachable"
else
  echo "FAIL: API health endpoint is not reachable"
  exit 2
fi

echo "== nginx health =="
if curl -fsS --max-time 10 http://localhost/nginx-health >/dev/null; then
  echo "OK: nginx health endpoint reachable"
else
  echo "FAIL: nginx health endpoint is not reachable"
  exit 3
fi

echo "== recent logs =="
docker compose logs --tail=50 nginx app

echo "All health checks passed"
