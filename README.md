# ReachInbox Email Scheduler

Full-stack email scheduling application for the **Outbox Labs ReachInbox** internship assignment.

## Stack

| Layer | Technology |
|-------|------------|
| Monorepo | npm workspaces |
| API | Express.js + TypeScript |
| Web | React + Vite + TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Queue | Redis + BullMQ (no cron) |
| Search | Elasticsearch |
| Ops | Docker Compose (persistent volumes) |

**Implemented:** REST email scheduling, BullMQ delayed jobs (no cron), Ethereal SMTP, Postgres persistence, restart reconciliation, Elasticsearch indexing, Figma-aligned React dashboard, **Google OAuth**, **Slack OAuth** + encrypted tokens + rate-limit DM alerts.

**Search:** Elasticsearch-backed subject/recipient search on Scheduled/Sent lists (PostgreSQL hydrates results).

## Prerequisites

- Node.js 20+
- npm
- Git
- Docker Desktop (with Docker Compose)

## Quick start

1. **Copy environment file**

   ```bash
   cp .env.example .env
   ```

2. **Start infrastructure**

   ```bash
   docker compose up -d
   ```

3. **Install dependencies**

   ```bash
   npm install
   ```

4. **Push Prisma schema to PostgreSQL**

   ```bash
   npm run db:push
   npm run db:generate
   ```

5. **Verify connections**

   ```bash
   npm run verify
   ```

6. **Run API and worker (separate terminals)**

   ```bash
   npm run dev:api      # HTTP API + Bull Board
   npm run dev:worker   # BullMQ email processor
   npm run dev:web      # optional dashboard
   ```

7. **Smoke tests**

   ```bash
   npm run verify -w @reachinbox/api
   npm run test:queue-recovery -w @reachinbox/api
   npm run smtp-probe -w @reachinbox/api          # requires outbound :587 to Ethereal
   npm run test:integration -w @reachinbox/api    # API + worker must be running
   ```

## Useful URLs

| Service | URL |
|---------|-----|
| Web app | http://localhost:5173 |
| API | http://localhost:3001 |
| Health check | http://localhost:3001/health |
| Schedule/list emails | `POST/GET /emails` |
| Bull Board | http://localhost:3001/admin/queues |
| Elasticsearch | http://localhost:9200 |

## Project structure

```
reachinbox-email-scheduler/
├── apps/
│   ├── api/          # Express API, Prisma, BullMQ, Elasticsearch
│   └── web/          # React + Vite frontend
├── docker-compose.yml
├── .env.example
└── package.json      # workspace root
```

## Google OAuth (localhost)

1. Open [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**.
2. Configure the **OAuth consent screen** (External or Internal) with app name and your email as test user if External.
3. **Create credentials** → **OAuth client ID** → Application type **Web application**.
4. **Authorized JavaScript origins:** `http://localhost:5173` (optional for redirect flow).
5. **Authorized redirect URIs** (required — must match `.env` exactly):

   ```
   http://localhost:3001/auth/google/callback
   ```

6. Copy **Client ID** and **Client secret** into `.env`:

   ```env
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback
   SESSION_SECRET=use-a-random-string-at-least-32-characters-long
   ```

7. Restart the API, then use **Login with Google** on `http://localhost:5173/login`.

Auth endpoints: `GET /auth/google`, `GET /auth/google/callback`, `GET /auth/me`, `POST /auth/logout`.

Integration tests use `INTEGRATION_TEST_AUTH_SECRET` + `X-Integration-Test-Auth` header (see `.env.example`). The bypass is **ignored when `NODE_ENV=production`**.

## Slack OAuth & rate-limit alerts (localhost)

1. Create a [Slack app](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. **OAuth & Permissions** → **Redirect URL** (must match `.env`):

   ```
   http://localhost:3001/auth/slack/callback
   ```

3. **Bot Token Scopes** (OAuth v2):

   - `chat:write`
   - `im:write`
   - `users:read`
   - `team:read`

4. Install to workspace (for your own testing) and copy **Client ID** and **Client Secret** from **Basic Information** into `.env`:

   ```env
   SLACK_CLIENT_ID=
   SLACK_CLIENT_SECRET=
   SLACK_CALLBACK_URL=http://localhost:3001/auth/slack/callback
   TOKEN_ENCRYPTION_KEY=use-a-random-string-at-least-32-characters-long
   ```

5. Restart API + worker. Sign in with Google, then use **Connect Slack** in the sidebar.

**API routes (authenticated unless noted):** `GET /slack/status`, `GET /slack/connect`, `GET /slack/reconnect`, `POST /slack/disconnect`, `GET /auth/slack/callback` (OAuth return).

When the Redis sender rate limiter postpones a send, the worker enqueues a **non-blocking** Slack DM (deduped per email + reason). Slack failures never affect email job state.

Run Slack unit tests: `npm run test:slack -w @reachinbox/api` (mocks Slack HTTP; uses Postgres for connection rows).

## Elasticsearch search

### Architecture

- **PostgreSQL** is the source of truth for scheduling, sending, and list views.
- **Elasticsearch** index `scheduled_emails` is updated **best-effort** on schedule, postpone, send, fail, and cancel (`indexScheduledEmailSafe` — failures are logged, never thrown).
- **Search** (`GET /emails/search?q=…&status=scheduled|sent`) queries ES for the authenticated `userId`, then **re-hydrates** matching IDs from Postgres so UI status matches reality. Stale ES hits are dropped (`meta.omittedStale`).
- If ES is down, search returns **503**; the UI shows an error instead of pretending results are current.

### Setup

1. `docker compose up -d` (includes Elasticsearch on `:9200`).
2. Backfill existing rows: `npm run backfill:elasticsearch -w @reachinbox/api`
3. Use the dashboard search bars (debounced; uses the search API when text is entered).

### Consistency & recovery

| Event | Behavior |
|--------|----------|
| ES index lag / failure | List view still correct from Postgres; search may 503 or omit stale hits |
| Restart API/worker | `ensureEmailsIndex` + optional backfill |
| Mapping changes | New fields added via `putMapping` when possible |

### Tests

`npm run test:elasticsearch -w @reachinbox/api` — query builder, document shape, safe indexing, outage typing.

## Environment variables

See [`.env.example`](.env.example) for all configuration.

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run dev:api` | Start API with hot reload |
| `npm run dev:web` | Start Vite dev server |
| `npm run verify` | Test Postgres, Redis, ES, BullMQ |
| `npm run db:push` | Sync Prisma schema to DB |
| `npm run build` | Build all workspaces |

## Regression audit (assignment checklist)

Run with **Docker** (`postgres`, `redis`, `elasticsearch`) up, then **API + worker** in separate terminals for integration and HTTP isolation checks.

### Automated (commands)

```bash
npm run build -w @reachinbox/api
npm run build -w @reachinbox/web
npm run test:elasticsearch -w @reachinbox/api
npm run test:slack -w @reachinbox/api
npm run test:auth-isolation -w @reachinbox/api   # Postgres always; HTTP cases skip if API down
npm run test:queue-recovery -w @reachinbox/api
npm run test:rate-limit-concurrency -w @reachinbox/api
# API + worker running (outbound SMTP :587 for Ethereal):
npm run test:integration -w @reachinbox/api
# API running; stop unrelated `dev:worker` so only the script's two workers run:
npm run test:multi-worker -w @reachinbox/api
```

| Area | Automated coverage |
|------|-------------------|
| Builds (API + web) | `npm run build` per workspace |
| BullMQ delay, recovery, rate-limit postpone, retries, duplicate protection | `test:integration`, `test:queue-recovery`, `test:rate-limit-concurrency`, `test:multi-worker` |
| Elasticsearch indexing, search query, safe index (no throw) | `test:elasticsearch` |
| Slack DM scheduling + dedupe (mocked HTTP) | `test:slack` |
| Cross-user Postgres scoping + prod auth bypass off | `test:auth-isolation` |
| ES outage blocks **search** (503), not schedule/send | `indexScheduledEmailSafe` + integration schedule path |

### Manual (browser + real Google / Slack)

1. **Login / logout** — `http://localhost:5173/login` → Google; sidebar profile; logout clears session.
2. **Compose** — sender dropdown, recipient chips, CSV/TXT import, schedule popover, send later; confirm row in Scheduled + Bull Board.
3. **Delivery** — worker sends via Ethereal; status **Sent**; preview link in API logs / Ethereal inbox (not exactly-once SMTP).
4. **Search** — debounced query on Scheduled/Sent lists hits `GET /emails/search` (requires ES up).
5. **Slack** — Connect / reconnect / disconnect in sidebar; rate-limit DM after postponed send (live workspace).
6. **Second Google account** — other user must not see first user's emails, senders, or campaigns (404 / empty lists).
7. **UI placeholders (by design)** — Filter, Draft, Paperclip (attachments), Microsoft login buttons disabled with tooltips.

### Secrets

- `.env` is gitignored; only `.env.example` is tracked.
- Do not commit `GOOGLE_CLIENT_SECRET`, `SLACK_CLIENT_SECRET`, SMTP passwords, or `TOKEN_ENCRYPTION_KEY`.
- Review local history if `.env` was ever committed: `git log --all -- .env`.

## Production hardening notes

| Topic | Behavior |
|--------|----------|
| **Secrets** | `assertProductionSafeConfig` blocks default `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, and any `INTEGRATION_TEST_AUTH_SECRET` when `NODE_ENV=production`. |
| **Bull Board** | Protected by session auth when `BULL_BOARD_REQUIRE_AUTH=true` (default in production). |
| **Health** | `/health/live` (process up), `/health/ready` (Postgres + Redis), `/health` (full incl. Elasticsearch). |
| **SMTP** | Ethereal via `POST /sender-accounts`; real providers via `POST /sender-accounts/smtp` (verify before save; password never returned). |
| **SMTP at rest** | `smtpPass` stored as `enc1:` + AES-256-GCM (`TOKEN_ENCRYPTION_KEY`). Legacy plaintext works in dev until `npm run migrate:sender-credentials -w @reachinbox/api` (back up Postgres first). Production refuses to start with plaintext sender rows. |
| **Queue/DB** | Failed BullMQ enqueue marks email `FAILED` with error text; startup `reconcilePendingEmails` restores missing jobs. |
| **SMTP delivery** | At-least-once (retries + idempotent job ids); not exactly-once. |
| **Failed emails** | Shown on the **Sent** list with a Failed badge (`GET /emails?status=sent` includes `FAILED`). |
| **Large batches** | Compose schedules recipients sequentially (one API call per email). List API defaults to `limit=200` (max 500); bulk 1,000+ requires pagination and patience — not load-tested in CI. |
| **Migrations** | Assignment uses `npm run db:push` for speed; production should adopt `prisma migrate` and backup Postgres before schema changes. |
| **CI** | `.github/workflows/ci.yml` — build + unit tests (integration tests still manual with API/worker). |

### Backups (operational)

- **PostgreSQL:** periodic `pg_dump` of `reachinbox` (scheduled emails, senders, users, Slack tokens).
- **Redis:** ephemeral queue state; Postgres is source of truth — reconcile on worker start.
- **Elasticsearch:** reindex via `npm run backfill:elasticsearch -w @reachinbox/api` after restore.

## Production deployment (Hetzner + Docker + Caddy)

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for VPS setup, `compose.prod.yml`, HTTPS, OAuth redirect URLs, and reviewer test checklist. Local `docker-compose.yml` is unchanged for development.

## License

Private — assignment project.
