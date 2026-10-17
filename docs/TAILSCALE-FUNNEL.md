# Tailscale Funnel (free public HTTPS demo)

Runs the **same Docker images** as `compose.prod.yml` in an isolated project (`reachinbox-funnel`) with **separate volumes** so your dev Postgres/Redis are untouched.

Tailscale terminates HTTPS; Caddy listens on **HTTP `127.0.0.1:8080` only** (no TLS redirect loop).

## Prerequisites

- Docker Desktop on Windows
- Tailscale logged in (`tailscale status`)
- Funnel allowed on your tailnet ([Tailscale Funnel docs](https://tailscale.com/kb/1222/tailscale-funnel))
- Google + Slack OAuth clients updated with your **exact** `https://….ts.net` URLs

## OAuth and `*.ts.net` (read before demo)

| Topic | Notes |
|--------|--------|
| **Redirect URIs** | Google and Slack require **exact** HTTPS redirect URLs. Add both callbacks for your Funnel hostname. |
| **Hostname stability** | Funnel URL is tied to your device name in Tailscale; renaming the machine changes the URL → update OAuth consoles. |
| **Google “Testing”** | External apps in Testing mode only allow **test users** you add in Google Cloud Console. |
| **Google verified domain** | `*.ts.net` is not your domain; you do **not** need domain verification for **Web client** redirect URIs—only exact URI allowlisting. |
| **Workspace policies** | Some Google Workspace orgs block OAuth to non-corporate redirect URLs. |
| **Slack** | Redirect URL must match `SLACK_CALLBACK_URL` exactly; reinstall app after URL changes. |
| **Not guaranteed** | If Google/Slack reject the redirect, use a custom domain (Hetzner deploy) instead. |

### Callback paths (unchanged from production)

| Provider | Public URL |
|----------|------------|
| Google | `https://YOUR-HOST.ts.net/api/auth/google/callback` |
| Slack | `https://YOUR-HOST.ts.net/auth/slack/callback` |

Google Console **Authorized JavaScript origins**: `https://YOUR-HOST.ts.net`

## Setup

```powershell
cd $HOME\Desktop\reachinbox-email-scheduler
Copy-Item .env.funnel.example .env.funnel
# Edit .env.funnel: PUBLIC_BASE_URL, WEB_URL, API_URL, OAuth URLs, secrets (match POSTGRES_PASSWORD in DATABASE_URL)
```

Get your hostname:

```powershell
tailscale status
# Or: tailscale funnel status
```

## Start stack (no public exposure yet)

```powershell
cd $HOME\Desktop\reachinbox-email-scheduler

# Same file for Compose interpolation and api/worker env_file
$env:ENV_FILE = ".env.funnel"
docker compose -f compose.funnel.yml --env-file .env.funnel config
docker compose -f compose.funnel.yml --env-file .env.funnel build
docker compose -f compose.funnel.yml --env-file .env.funnel up -d
docker compose -f compose.funnel.yml --env-file .env.funnel ps
```

Smoke test **locally** (still private):

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:8080/ -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest -Uri http://127.0.0.1:8080/api/health/ready -UseBasicParsing | Select-Object StatusCode
```

Optional SMTP check (inside API container):

```powershell
docker compose -f compose.funnel.yml --env-file .env.funnel exec api node dist/scripts/smtp-probe.js
```

## Enable public HTTPS (you run this manually)

Only after local checks pass:

```powershell
# Exposes your machine's Funnel URL -> http://127.0.0.1:8080
tailscale funnel 8080
tailscale funnel status
```

Open the printed `https://….ts.net` URL in a browser (use Google login, not dev scheduler user).

## Stop public access

```powershell
tailscale funnel off
docker compose -f compose.funnel.yml --env-file .env.funnel down
```

`down` does **not** delete `funnel_*` volumes unless you add `-v`.

## Production guards

- `NODE_ENV=production`, unique `SESSION_SECRET` / `TOKEN_ENCRYPTION_KEY`, empty `INTEGRATION_TEST_AUTH_SECRET`
- `COOKIE_SECURE=true` (browser uses HTTPS via Funnel; cookies are `Secure`)
- Express `trust proxy` + Caddy `X-Forwarded-Proto: https`
- Bull Board: `BULL_BOARD_REQUIRE_AUTH=true` — open `/admin/queues` only when logged in

## Coexistence with dev

| | Dev | Funnel stack |
|--|-----|----------------|
| Compose | `docker-compose.yml` + `npm run dev:*` | `compose.funnel.yml` |
| Env | `.env` | `.env.funnel` |
| DB volume | `postgres_data` (dev compose) | `funnel_postgres_data` |
| Host port | 5432/6379/9200 (dev infra) | **Only** `127.0.0.1:8080` |

Do **not** run `npm run dev:worker` against funnel Redis.
