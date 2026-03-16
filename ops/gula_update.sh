#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed on this host"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "Pulling/building latest images..."
docker compose pull || true
docker compose build --pull

echo "Starting services..."
docker compose up -d --remove-orphans

echo "Waiting for health checks..."
for i in {1..30}; do
  if curl -fsS --max-time 5 http://localhost/api/healthz >/dev/null; then
    echo "Deployment healthy"
    exit 0
  fi
  sleep 2
done

echo "Deployment failed health checks"
exit 2
