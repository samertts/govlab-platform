# GULA Integration Guide

This project is ready to run standalone and can be integrated with the GULA platform through reverse proxy and trusted-origin configuration.

## 1) Required environment variables

Copy and update `.env.example`:

- `DATABASE_URL`: PostgreSQL connection string.
- `SESSION_SECRET`: random server-side signing secret.
- `NATIONAL_ID_ENCRYPTION_KEY`: 64-character hex key (32 bytes) for AES encryption.
- `GULA_TRUSTED_ORIGINS` (optional): comma-separated external origins allowed to call state-changing API endpoints.

Example:

```env
GULA_TRUSTED_ORIGINS=https://gula.example.gov,https://admin.gula.example.gov
```

## 2) Local run

```bash
npm install
npm run check
npm run dev
```

Health endpoint:

```bash
curl -i http://localhost:5000/api/healthz
```

## 3) Production integration with GULA

Use existing deployment assets in `deploy/` and `ops/`:

- `deploy/nginx/nginx.conf`
- `deploy/README.md`
- `ops/gula_update.sh`
- `ops/gula_health.sh`
- `ops/gula_autofix.sh`

Recommended flow on host:

```bash
bash ops/gula_update.sh
bash ops/gula_health.sh
```

## 4) Security notes

- By default, state-changing `/api` requests are only accepted from same-host origins.
- Add GULA front-end origins in `GULA_TRUSTED_ORIGINS` when the UI/API are hosted on separate domains.
- Keep `SESSION_SECRET` and `NATIONAL_ID_ENCRYPTION_KEY` unique per environment.
