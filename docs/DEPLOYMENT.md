# Production deployment (Hetzner CX33 + Docker Compose + Caddy)

This guide deploys a **fresh production stack** on a VPS. It does **not** copy your local Postgres, Redis, OAuth tokens, or sender accounts. Local development continues to use `docker-compose.yml` at the repo root.

## Architecture

| Service | Role | Public exposure |
|---------|------|-----------------|
| **caddy** | HTTPS, SPA static files, reverse proxy | **80, 443** |
| **api** | Express API, OAuth, Bull Board backend | Internal only |
| **worker** | BullMQ email processor (runs when laptop is off) | Internal only |
| **postgres** | Prisma / source of truth | Internal only |
| **redis** | BullMQ + rate limits (AOF persistence) | Internal only |
| **elasticsearch** | Search index (512 MB heap, ~1.5 GB container cap) | Internal only |

### URL routing (same as local Vite proxy)

| Browser path | Upstream (Express) |
|--------------|-------------------|
| `/api/*` | `/*` (prefix stripped) |
| `/auth/*` | `/auth/*` (Google/Slack OAuth callbacks) |
| `/admin/queues*` | Bull Board |
| everything else | React SPA (`try_files` → `index.html`) |

Frontend uses relative `/api` (`apps/web/src/api/client.ts`). Google sign-in: `/api/auth/google`. Slack connect: `/api/slack/connect`.

### Environment variables (names only)

All names are defined in `apps/api/src/config/env.ts`. Production template: [`.env.production.example`](../.env.production.example).

**Must change from localhost:**

| Variable | Production example |
|----------|-------------------|
| `WEB_URL` | `https://app.YOURDOMAIN.com` |
| `API_URL` | `https://app.YOURDOMAIN.com` |
| `GOOGLE_CALLBACK_URL` | `https://app.YOURDOMAIN.com/api/auth/google/callback` |
| `SLACK_CALLBACK_URL` | `https://app.YOURDOMAIN.com/auth/slack/callback` |
| `DATABASE_URL` | `postgresql://reachinbox:…@postgres:5432/reachinbox?schema=public` |
| `REDIS_URL` | `redis://redis:6379` |
| `ELASTICSEARCH_URL` | `http://elasticsearch:9200` |
| `NODE_ENV` | `production` |
| `COOKIE_SECURE` | `true` |
| `INTEGRATION_TEST_AUTH_SECRET` | **unset / empty** |
| `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` | unique random values (not defaults) |

Compose-only (Caddy): `PUBLIC_HOSTNAME`, `CADDY_ADMIN_EMAIL`, `POSTGRES_PASSWORD`.

## 1. Hetzner VPS setup

1. Create **CX33** (Ubuntu 24.04) in Hetzner Cloud.
2. **Firewall:** allow **22** (SSH, your IP), **80**, **443** from `0.0.0.0/0`. Deny all other inbound.
3. SSH as root, create deploy user:

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

4. Install Docker (official convenience script or apt), enable for `deploy`:

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
```

5. Log in as `deploy`, verify: `docker version` and `docker compose version`.

## 2. DNS

Create an **A record**:

- **Host:** `app` (or your chosen subdomain)
- **Value:** VPS public IPv4
- **TTL:** 300–3600

Wait until `dig +short app.YOURDOMAIN.com` returns the VPS IP.

## 3. Clone private repo (read-only deploy key)

On the VPS as `deploy`:

```bash
ssh-keygen -t ed25519 -C "reachinbox-deploy" -f ~/.ssh/reachinbox_deploy -N ""
cat ~/.ssh/reachinbox_deploy.pub
```

In GitHub → **Settings → Deploy keys** → **Add deploy key** (read-only), paste the public key.

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com-reachinbox
  HostName github.com
  User git
  IdentityFile ~/.ssh/reachinbox_deploy
  IdentitiesOnly yes
EOF

git clone git@github.com-reachinbox:YOUR_ORG/reachinbox-email-scheduler.git
cd reachinbox-email-scheduler
```

## 4. Production environment file

```bash
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production   # fill placeholders; never commit this file
```

Generate secrets (examples):

```bash
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # TOKEN_ENCRYPTION_KEY
openssl rand -base64 24   # POSTGRES_PASSWORD
```

Ensure `DATABASE_URL` password matches `POSTGRES_PASSWORD`.

## 5. Google Cloud Console

1. **OAuth client** (Web application).
2. **Authorized JavaScript origins:** `https://app.YOURDOMAIN.com`
3. **Authorized redirect URIs:** `https://app.YOURDOMAIN.com/api/auth/google/callback`
4. Copy Client ID / Secret into `.env.production`.

## 6. Slack app

1. **OAuth redirect URL:** `https://app.YOURDOMAIN.com/auth/slack/callback`
2. Bot scopes: `chat:write`, `im:write`, `users:read`, `team:read`
3. Copy Client ID / Secret into `.env.production`.

## 7. Build and start

From repo root on the VPS:

```bash
# Validate compose (use the example file only for syntax checks — not for `up`)
ENV_FILE=.env.production.example docker compose -f compose.prod.yml --env-file .env.production.example config

docker compose -f compose.prod.yml --env-file .env.production build
docker compose -f compose.prod.yml --env-file .env.production up -d
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs -f caddy api worker
```

First API start runs `prisma db push` (empty DB → schema applied). **Do not** run this against your laptop database.

### Optional: Elasticsearch backfill

After first login and some emails exist (or after importing nothing on fresh DB, skip):

```bash
docker compose -f compose.prod.yml --env-file .env.production exec api \
  node dist/scripts/backfill-elasticsearch.js
```

New emails are indexed on schedule/send via the API/worker.

### SMTP probe (inside API container)

```bash
docker compose -f compose.prod.yml --env-file .env.production exec api \
  node dist/scripts/smtp-probe.js
```

Requires outbound **TCP 587** to `smtp.ethereal.email` (Hetzner usually allows this; verify if sends fail).

## 8. Operations

| Task | Command |
|------|---------|
| Status | `docker compose -f compose.prod.yml ps` |
| Logs | `docker compose -f compose.prod.yml logs -f api worker` |
| Restart API | `docker compose -f compose.prod.yml restart api` |
| Restart worker | `docker compose -f compose.prod.yml restart worker` |
| Stop stack | `docker compose -f compose.prod.yml down` |

**Do not** run a second `dev:worker` on your laptop against production Redis.

### Backups

```bash
docker compose -f compose.prod.yml exec postgres \
  pg_dump -U reachinbox reachinbox > reachinbox-$(date +%F).sql
```

Store dumps off-server, encrypted. Redis is rebuildable from Postgres via `reconcilePendingEmails` on worker start; delayed jobs live in Redis AOF volume `redis_data`.

### Rollback

1. `docker compose -f compose.prod.yml down`
2. Restore Postgres dump to a **new** volume or rename volumes carefully.
3. Checkout previous Git tag/commit on VPS, `build` + `up -d`.

## 9. Browser test checklist (reviewers)

1. **HTTPS** — `https://app.YOURDOMAIN.com` loads login (Figma layout unchanged).
2. **Google login** — redirects to Google, returns to `/scheduled`, session cookie set (`httpOnly`, `Secure`).
3. **Logout** — session cleared; `/scheduled` redirects to login.
4. **Sender** — default Ethereal sender after first login (or add SMTP sender in UI).
5. **Compose** — schedule email; appears under Scheduled.
6. **Worker** — status becomes Sent; Ethereal preview in worker logs (not passwords).
7. **Sent list** — delivered email visible.
8. **Search** — query on Scheduled/Sent (Elasticsearch up).
9. **Slack** — Connect in sidebar; rate-limit postpone triggers DM (may need tight `minDelayMs` / hourly limit to force postpone).
10. **Bull Board** — `https://app.YOURDOMAIN.com/admin/queues` requires login (401 if logged out).
11. **Restart** — `docker compose restart worker api`; pending jobs still process; no duplicate workers on VPS.

## 10. Known limitations

- **Not load-tested** for 1,000+ recipients; compose schedules one API call per email.
- **At-least-once** SMTP delivery (retries); not exactly-once.
- **Elasticsearch** single-node; search 503 if ES is down; lists still work from Postgres.
- **Ethereal** is for demos; corporate networks may block SMTP; production reviewers need outbound :587.
- **Integration / multi-worker scripts** are for local CI/manual runs, not run on VPS by default.
- **Plaintext SMTP rows** cause API/worker boot failure in production until `migrate:sender-credentials` (fresh DB gets encrypted on create).
- **HTTPS readiness** depends on DNS propagation and Let's Encrypt; first start may take 1–2 minutes.

## Local validation (before pushing deploy commits)

```bash
npm run build -w @reachinbox/api
npm run build -w @reachinbox/web
npm run test:production-guards -w @reachinbox/api
docker compose -f compose.prod.yml --env-file .env.production.example config
docker compose -f compose.prod.yml build   # requires Docker Desktop
```

Do not use `.env.production.example` as runtime secrets file on the VPS — copy and fill `.env.production`.
