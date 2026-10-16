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

**Implemented (scheduler stage):** REST email scheduling, BullMQ delayed jobs (no cron), Ethereal SMTP, Postgres persistence, restart reconciliation, Elasticsearch indexing, dashboard (schedule / view / cancel).

**Planned next:** Google OAuth, Slack OAuth, authenticated users, Elasticsearch search UI.

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

## Environment variables

See [`.env.example`](.env.example) for all configuration. OAuth and SMTP credentials are placeholders until you wire real providers.

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run dev:api` | Start API with hot reload |
| `npm run dev:web` | Start Vite dev server |
| `npm run verify` | Test Postgres, Redis, ES, BullMQ |
| `npm run db:push` | Sync Prisma schema to DB |
| `npm run build` | Build all workspaces |

## License

Private — assignment project.
