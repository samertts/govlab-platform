#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed on this host"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

fail=0
if ! curl -fsS --max-time 5 http://localhost/api/healthz >/dev/null; then
  echo "API unhealthy: restarting app + nginx"
  docker compose restart app nginx || true
  fail=1
fi

if ! curl -fsS --max-time 5 http://localhost/nginx-health >/dev/null; then
  echo "nginx unhealthy: forcing recreate"
  docker compose up -d --force-recreate nginx || true
  fail=1
fi

if [[ $fail -eq 1 ]]; then
  echo "Pruning dangling images/networks to recover broken states"
  docker image prune -f || true
  docker network prune -f || true
fi

sleep 3
if curl -fsS --max-time 5 http://localhost/api/healthz >/dev/null; then
  echo "Autofix successful"
  exit 0
fi

echo "Autofix failed; printing diagnostics"
docker compose ps || true
docker compose logs --tail=100 nginx app || true
exit 2
