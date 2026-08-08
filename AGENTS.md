# AGENTS.md — LazyBackup

Practical guide for AI coding agents working in this repository.

## Project overview

**LazyBackup** is a self-hosted web app for managing scheduled VPS backups. Users add remote servers over SSH, define backup jobs (source path on the VPS → local destination path), and monitor history from a dashboard.

- **GitHub:** https://github.com/Ceneka/lazybackup
- **Landing page:** https://lazy.zic.ar
- **Docker image:** `ghcr.io/ceneka/lazybackup:latest`

### Critical mental model

Backups **pull data from the remote VPS to the machine running LazyBackup** (local `rsync`/`scp`), not push to a remote destination. Destination paths are on the **app host** (e.g. `/backups/mysite` in Docker).

**Optional app password** (single operator lock, no users table): first-run prompt to set or skip; enable/change/remove later in Settings. When a password hash exists, middleware gates pages + `/api/*` behind a session cookie. When unset, the app is open (trusted self-hosted default). Public: `/login`, `/api/auth/*`, `/api/health`. SSH credentials for VPS access are stored in SQLite.

**SSH key auth is required for backup execution.** Password auth can connect via `node-ssh` for testing, but host-side `rsync`/`scp` needs a private key (`resolvePrivateKeyForServer`).

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime / PM | Bun |
| Framework | Next.js 15 (App Router), React 19 |
| UI | Tailwind CSS 4, shadcn/ui (Radix), lucide-react |
| Data fetching | TanStack React Query (`src/components/providers.tsx`) |
| Forms / validation | react-hook-form, Zod (API routes) |
| Database | SQLite via `@libsql/client`, Drizzle ORM |
| Remote access | node-ssh |
| Transfer | Local `rsync` (preferred) or local `scp` (fallback) |
| Scheduling | `cron` package, in-process `CronJob` map |
| IDs | `nanoid` (most entities), `crypto.randomUUID` (some history entries) |
| Tests | Bun test (`bun test`) |
| Deploy | Docker standalone output, GHCR publish on `main` / `v*` tags |

## Directory structure

```
src/
  app/                    # Next.js App Router pages + API routes
    api/                  # REST API (see below)
    api/auth/             # Optional app password login
    login/                # Login page (no navbar)
    backups/              # Backup config CRUD UI
    history/              # Backup run history + stats
    servers/              # VPS server CRUD + connection test
    settings/             # App settings + SSH key management
    examples/             # UI component playground (dev reference)
  components/
    ui/                   # shadcn primitives + QueryState, DataState, etc.
  lib/auth/               # App password hash, session cookie, isAuthorized
  middleware.ts           # Gates app when password is configured
    navbar.tsx
    providers.tsx         # QueryClientProvider
  lib/
    backup/               # executeBackup, history helpers, log-format
    db/                   # schema, client, migrate.ts
    hooks/                # React Query hooks per domain
    scheduler/            # Cron job registry
    ssh/                  # connectToServer, rsync helpers, capability checks
    utils/                # cn(), rsync-parser, formatBytes
instrumentation.ts        # Startup: migrations + scheduler init
```

Config: `next.config.ts` (standalone output), `drizzle.config.ts`, `docker-compose.yml`, `Dockerfile`, `components.json`.

**Note:** Migrations live in `src/lib/db/migrate.ts` (raw SQL + `PRAGMA` column checks). There is no `migrations/` folder from drizzle-kit generate.

## Architecture

```
Browser (React + useQuery)
    ↓ fetch /api/*
Next.js API Routes (Zod validate → Drizzle → JSON)
    ↓
SQLite (servers, backup_configs, backup_history, ssh_keys, settings)

instrumentation.ts (server start only, NOT during build)
    → runMigration()
    → initializeScheduler() → CronJob per enabled backup_config

Backup run (manual or scheduled):
    connectToServer (node-ssh)
    → optional pre_backup_commands on remote
    → check remote rsync / local scp
    → local rsync -e ssh … OR scp per file
    → update backup_history (success/failed + log_output)
```

Build guard: `instrumentation.ts` skips when `NEXT_PHASE === 'phase-production-build'` or `npm_lifecycle_event === 'build'`.

Node-only guard: backup/SSH/scheduler code checks `process.env.NEXT_RUNTIME === 'nodejs'`.

## Data model (`src/lib/db/schema.ts`)

| Table | Purpose |
|-------|---------|
| `servers` | VPS connection: host, port, username, `authType` (`password` \| `key`), password/privateKey, `sshKeyId`, `systemKeyPath` |
| `ssh_keys` | Stored keys: name, `privateKeyContent` or `privateKeyPath` |
| `backup_configs` | Job: `serverId`, name, `sourcePath` (remote), `destinationPath` (local), cron `schedule`, `excludePatterns` (newline-separated), `preBackupCommands`, `enabled`, `enableVersioning`, `versionsToKeep` |
| `backup_history` | Run: `configId`, `startTime`, `endTime`, `status` (`running` \| `success` \| `failed`), sizes, `errorMessage`, `logOutput` |
| `settings` | Key-value store (`defaultSshKeyPath`, `sshKeepAliveInterval`, `timezone`, optional `appPasswordHash` / `sessionSecret` / `authSetupCompleted`) |

Cascade deletes: server → configs → history.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | DB ping + optional backup dir stats (Docker healthcheck); always public |
| GET | `/api/auth/status` | `{ authEnabled, authSetupCompleted, authenticated }` (public); refreshes session cookie when authenticated (sliding 30-day expiry) |
| POST | `/api/auth/setup` | First-run set password or skip (public; only if no password yet) |
| POST | `/api/auth/login` | Verify password, set session cookie (public) |
| POST | `/api/auth/logout` | Clear session cookie (public) |
| POST | `/api/auth/password` | Set / change / remove app password |
| GET/POST/PUT/DELETE | `/api/servers` | List / create / update / delete servers |
| GET/PUT/DELETE | `/api/servers/[id]` | Single server |
| GET | `/api/servers/[id]/test` | Test saved server backup capabilities |
| POST | `/api/servers/test` | Test unsaved server credentials |
| GET/POST | `/api/backups` | List / create backup configs (schedules on create if enabled) |
| GET/PUT/DELETE | `/api/backups/[id]` | Single config (reschedules on update) |
| POST | `/api/backups/[id]/run` | Manual run (async `executeBackup`) |
| POST | `/api/backups/[id]/toggle` | Enable/disable + schedule/stop cron |
| POST | `/api/backups/start` | Start backup by `configId` (hook alias) |
| GET/POST | `/api/history` | List history (paginated) / create entry |
| GET/PUT/DELETE | `/api/history/[id]` | Single history record |
| GET | `/api/history/stats` | Aggregates; `?chartData=true` for dashboard chart |
| GET/POST | `/api/ssh-keys` | List (`?includeSystem=true` scans `~/.ssh`) / create |
| GET/PUT/DELETE | `/api/ssh-keys/[id]` | Single stored key |
| GET/POST/DELETE | `/api/settings` | Settings CRUD (`DELETE ?key=`); never returns `appPasswordHash` / `sessionSecret` |
| POST | `/api/scheduler/restart` | Restart all cron jobs |
| POST | `/api/seed` | Dev: insert test server if DB empty |

API pattern: parse body with Zod → Drizzle → `NextResponse.json`. Errors return `{ error, details? }`.

## Backup workflow (`src/lib/backup/index.ts`)

1. **Connect** via `connectToServer` (password or key).
2. **Pre-backup commands** (optional): run on remote, log via `log-format.ts`.
3. **Resolve local destination**: expand `~`, make absolute, `mkdir -p`. If versioning: append `YYYY-MM-DD_HH-mm-ss` subfolder.
4. **Transport selection:**
   - Remote has `rsync` → local `rsync -avz --stats -e 'ssh …'` pulling `user@host:source/`.
   - Else if local `scp` exists → remote `find` + per-file `scp` (slower).
   - Else → fail.
5. **Key handling:** `writeTemporarySshIdentityFile` with normalized PEM; SSH uses `-F /dev/null` to ignore host `~/.ssh/config`.
6. **Version cleanup:** if versioning, delete oldest timestamp dirs beyond `versionsToKeep`.
7. **History:** `parseRsyncOutput` for stats; `combineBackupLog` merges pre-backup + transfer logs.

Scheduled runs use the same `executeBackup` via `src/lib/scheduler/index.ts`.

## Frontend conventions

- **Package manager:** Bun (`bun install`, `bun run dev`).
- **Client pages:** `"use client"` + hooks in `src/lib/hooks/`.
- **Query keys:** domain objects like `backupKeys`, `['servers']`, `['stats']`.
- **State UI:** `QueryState`, `DataState`, `LoadingButton`, `DeleteConfirmationDialog`.
- **Toasts:** `sonner` (`toast.success` / `toast.error`).
- **Styling:** `cn()` from `src/lib/utils.ts`, Tailwind + shadcn variants.
- **Mobile nav:** `Sheet` with `modal={false}` (avoids stuck `pointer-events` on body).
- **Path alias:** `@/*` → `src/*`.

Hooks map 1:1 to API routes; prefer extending existing hooks over ad-hoc `fetch` in pages.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `file:./data.db` | SQLite path (`file:/app/data/data.db` in Docker) |
| `PORT` | `3000` | HTTP port |
| `BACKUP_STORAGE_PATH` | `./backups` | Host path for backup files + health endpoint scan |
| `SSH_KEYS_PATH` | `~/.ssh` | Docker volume mount for system keys (read-only) |
| `AUTH_SECRET` | (auto in settings) | HMAC secret for session cookies; if unset, a random `sessionSecret` is stored in SQLite |

Docker Compose mounts `${BACKUP_STORAGE_PATH}` to both `/backups` and `/app/backups`.

## Commands

```bash
bun install
bun run dev              # Development server
bun run build            # Production build (standalone)
bun run start            # Production server (PORT from env)
bun run lint
bun test                 # e.g. src/lib/backup/log-format.test.ts
bun run db:migrate       # Run migrate.ts directly
bun run db:generate      # drizzle-kit generate (schema reference; migrate.ts is authoritative)
bun run db:studio        # Drizzle Studio
```

Docker:

```bash
docker compose up -d     # Uses .env, persists DB in lazybackup_data volume
# or
docker run -d -p 3000:3000 -v lazybackup_data:/app/data \
  -v ./backups:/backups -v ~/.ssh:/root/.ssh:ro \
  -e DATABASE_URL=file:/app/data/data.db ghcr.io/ceneka/lazybackup:latest
```

Production image installs `openssh-client` and `rsync` on the runner stage.

## Deployment

- **CI:** `.github/workflows/publish-ghcr.yml` builds and pushes `ghcr.io/ceneka/lazybackup:latest` on push to `main` or version tags.
- **Runtime:** Bun runs `server.js` from Next standalone output.
- **Startup:** `instrumentation.ts` auto-migrates DB and starts cron scheduler.
- **Health:** `GET /api/health` (compose healthcheck uses curl).

## Code conventions (from `.cursor/rules/rules.mdc`)

- Use Bun, not npm/yarn.
- Next.js 15 + shadcn/ui patterns.
- TanStack Query is configured; use it for server state.
- DRY, but don't over-abstract one-liners.
- Prefer one good solution over listing alternatives.
- Minimize diff scope; match surrounding style.
- ESLint ignored during builds (`next.config.ts`).

## Common pitfalls

1. **Password-only servers cannot run backups** — only SSH test/connect works; backups need a private key.
2. **Destination is local** — paths like `/backups/foo` must exist/be writable on the LazyBackup host (mount a volume in Docker).
3. **Don't run scheduler/migrations during `next build`** — guarded in `instrumentation.ts`; Dockerfile uses temp DB for build.
4. **Cron schedule strings** — standard 5-field cron passed to `cron` package; invalid expressions fail at schedule time.
5. **Mixed ID generators** — `nanoid` vs `randomUUID` in history; don't assume one format.
6. **No LICENSE file** in repo currently — don't reference MIT unless added.
7. **`/api/seed`** exposes test credentials — dev-only, not for production exposure.
8. **App password ≠ SSH password** — optional UI lock (`appPasswordHash` in settings); never expose via `GET /api/settings`. Keep `/api/health` public for Docker.

## Key files to read first

| Task | Files |
|------|-------|
| Backup logic | `src/lib/backup/index.ts`, `src/lib/ssh/index.ts`, `src/lib/ssh/rsync.ts` |
| Scheduling | `src/lib/scheduler/index.ts`, `src/instrumentation.ts` |
| Schema / DB | `src/lib/db/schema.ts`, `src/lib/db/migrate.ts` |
| App password | `src/lib/auth/`, `src/middleware.ts`, `src/app/api/auth/` |
| API example | `src/app/api/backups/route.ts`, `src/app/api/servers/route.ts` |
| UI patterns | `src/lib/hooks/useBackups.ts`, `src/components/ui/query-state.tsx` |
| Log display | `src/lib/backup/log-format.ts`, `src/app/history/[id]/page.tsx` |

## Testing

- Run `bun test` before changing `log-format.ts` or parsers.
- No E2E test suite; manual verification via UI + `/api/servers/[id]/test`.
- For backup changes, verify both rsync path and scp fallback behavior if touched.
