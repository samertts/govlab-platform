# GULA Production 502 Recovery Runbook

## Root-cause checklist for `502 Bad Gateway (nginx)`

Run on the target host:

```bash
docker ps
docker compose ps
docker compose logs --tail=200 nginx app
curl -i http://localhost/nginx-health
curl -i http://localhost/api/healthz
```

Typical causes fixed by this repo update:

1. Upstream mismatch (nginx forwarding to wrong host/port).
2. Backend starts after nginx and remains unavailable.
3. Missing health checks causing traffic to unhealthy containers.
4. No restart policy, so crashed containers remain down.
5. No timeout/retry in nginx proxy path.

## Included permanent fixes

- `docker-compose.yml`
  - isolated bridge network
  - deterministic service names (`app`, `nginx`)
  - `restart: always`
  - health checks for both services
  - nginx starts only after app is healthy
- `deploy/nginx/nginx.conf`
  - `upstream app:5000`
  - connection/read/send timeouts
  - upstream retry/failover directives
  - dedicated `/nginx-health`
- `ops/gula_health.sh`
  - health + logs validation
- `ops/gula_update.sh`
  - build + deploy + wait-for-health
- `ops/gula_autofix.sh`
  - detect unhealthy stack, restart/recreate, prune broken artifacts, re-validate

## Operational usage

```bash
bash ops/gula_update.sh
bash ops/gula_health.sh
```

If issues persist:

```bash
bash ops/gula_autofix.sh
```
