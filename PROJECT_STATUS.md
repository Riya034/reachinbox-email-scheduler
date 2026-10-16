# ReachInbox Email Scheduler — Project Status

**Last updated:** 2026-10-17  
**Repository:** `reachinbox-email-scheduler` (Outbox Labs / ReachInbox internship assignment)

---

## Architecture

```
┌─────────────┐     REST      ┌──────────────────┐     enqueue      ┌─────────────┐
│  apps/web   │ ────────────► │    apps/api      │ ───────────────► │ Redis/BullMQ │
│ React+Vite  │   (proxy)     │ Express+TypeScript│                  │ email-send   │
└─────────────┘               └────────┬─────────┘                  └──────┬──────┘
                                       │                                  │
                                       │ Prisma                           │ delayed jobs
                                       ▼                                  ▼
                              ┌─────────────────┐                 ┌──────────────────┐
                              │   PostgreSQL    │                 │  apps/api worker │
                              │ users, senders, │                 │ (separate proc.) │
                              │ campaigns, mail │                 │ Nodemailer SMTP  │
                              └─────────────────┘                 └────────┬─────────┘
                                       │                                  │
                                       │ index                            │ Ethereal
                                       ▼                                  ▼
                              ┌─────────────────┐                 ┌──────────────────┐
                              │ Elasticsearch   │                 │ smtp.ethereal.email│
                              └─────────────────┘                 └──────────────────┘
```

| Layer | Stack |
|-------|--------|
| Monorepo | npm workspaces (`apps/api`, `apps/web`) |
| API | Express 4, Zod validation, Bull Board |
| Worker | BullMQ `Worker`, configurable concurrency |
| Data | PostgreSQL 16 + Prisma ORM |
| Queue / limits | Redis 7 (BullMQ + per-sender Lua rate limiter) |
| Search | Elasticsearch 8 (email index on schedule/send) |
| Infra | Docker Compose (Postgres, Redis, ES, persistent volumes) |

**Processes:** API (`index.ts`) enqueues and exposes HTTP; worker (`worker.ts`) sends mail. Both call `reconcilePendingEmails` on startup so delayed jobs survive restarts (no cron).

---

## Implemented & verified

### Data model (Prisma)
- `User`, `SenderAccount` (Ethereal SMTP + `hourlyLimit` / `minDelayMs`)
- `Campaign`, `ScheduledEmail` (status lifecycle, `smtpMessageId`, `bullJobId`, `sequenceOrder`, `lastPostponedAt`, retries)

### API (dev user: `DEV_SCHEDULER_USER_EMAIL`)
- `POST/GET /sender-accounts` — create/list Ethereal senders
- `POST/GET /campaigns`
- `POST/GET/DELETE /emails` — schedule, list (`scheduled` \| `sent`), detail, cancel
- `GET /health`, Bull Board at `BULL_BOARD_PATH`

### Scheduler & worker
- BullMQ delayed jobs, deterministic job IDs: `email-{scheduledEmailId}`
- Per-sender Redis atomic hourly cap + minimum inter-send delay; postpone via `moveToDelayed` + `DelayedError`
- Campaign `sequenceOrder` ordering (earlier pending blocks later sends)
- Nodemailer → real Ethereal SMTP (multiple senders)
- Idempotent claim, exponential backoff on queue, graceful shutdown

### Tests (verified locally)
| Command | Result |
|---------|--------|
| `npm run verify -w @reachinbox/api` | Postgres, Redis, ES, BullMQ |
| `npm run test:queue-recovery -w @reachinbox/api` | Job restore after simulated Redis loss |
| `npm run test:integration -w @reachinbox/api` | **9/9** (Ethereal SENT, postponement, 4/4 burst delivery, list APIs) |
| `npm run smtp-probe -w @reachinbox/api` | Requires outbound SMTP to Ethereal |

### Frontend
- Basic Vite dashboard (schedule + lists) — **not** aligned with full assignment UX yet; backend is the focus.

---

## Commands (current)

```bash
# Infrastructure
docker compose up -d

# Database
npm run db:push -w @reachinbox/api
npm run db:generate -w @reachinbox/api

# Run (two terminals)
npm run dev:api       # API :3001
npm run dev:worker    # BullMQ worker

# Optional web
npm run dev:web       # :5173

# Checks
npm run verify -w @reachinbox/api
npm run test:queue-recovery -w @reachinbox/api
npm run test:integration -w @reachinbox/api
```

Copy `.env.example` → `.env` (root); Prisma also reads `apps/api/.env` if present. **Do not commit `.env` files.**

---

## Official assignment — remaining requirements

| Requirement | Status |
|-------------|--------|
| Schedule emails at specific time (API + BullMQ, no cron) | Done |
| Persistent jobs across restarts | Done |
| Ethereal SMTP | Done |
| Production-grade dashboard (schedule / scheduled / sent views) | Partial (basic web only) |
| **Google OAuth** | Not started |
| **Slack OAuth** | Not started |
| **Elasticsearch search** (user-facing) | Index only; no search API/UI |
| Configurable concurrency | Done (`EMAIL_QUEUE_CONCURRENCY`) |
| Redis-backed API rate limiting | Done (`rate-limiter-flexible`) |
| Real auth (per-user data) | Dev placeholder user only |
| Documentation / demo video / submission | Out of scope for this doc |

---

## Known limitations

1. **Auth:** All API traffic uses a single dev user until OAuth is implemented.
2. **Secrets in DB:** Sender SMTP passwords stored in Postgres (acceptable for assignment; encrypt in production).
3. **SMTP network:** Outbound port 587 to `smtp.ethereal.email` must be allowed (some networks block SMTP).
4. **Integration test data:** List endpoints return all dev-user emails; tests use isolated senders + Redis key cleanup for rate limits.
5. **Postponement probe:** Campaign emails from postponement phase may still drain in the background after tests finish.

---

## Next steps (recommended order)

1. **Google OAuth** — session/JWT, map to `User`, scope APIs to authenticated user.
2. **Slack OAuth** — optional linkage on `User.slackId`.
3. **Dashboard** — wire UI to authenticated APIs; scheduled vs sent tabs, cancel, sender/campaign pickers.
4. **Elasticsearch** — search endpoint + UI over `scheduled_emails` index.
5. **Hardening** — sender credential encryption, structured logging, production env validation.
6. **Submission** — README demo, screen recording, repo link per Outbox Labs instructions.

---

## Git & secrets hygiene

Tracked: `.env.example` only (placeholders, no real secrets).  
Ignored: `.env`, `apps/api/.env`, local env variants, keys/credentials patterns (see `.gitignore`).

Never commit Ethereal `ETHEREAL_USER` / `ETHEREAL_PASS`, OAuth client secrets, or `SESSION_SECRET` / `JWT_SECRET`.
