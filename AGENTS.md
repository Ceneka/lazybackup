# AGENTS.md — LazyBackup

Guide for AI coding agents. User-facing setup lives in [README.md](./README.md) and [`.env.example`](./.env.example).

## Mental model

- Backups are **From → To** transfers between endpoints: **this host (local)** or any configured **Server**. All four directions are supported (local↔local, local↔server, server↔server).
- Default for new configs remains **Server → Local** (`/backups/<server-slug>/<backup-slug>`). Destination uniqueness is per endpoint (local path, or `(destinationServerId, path)` for remote).
- **Server → Server** prefers an **ephemeral SSH key** installed on the destination so the source can rsync directly; if the source cannot reach the dest, LazyBackup **relays** (pull then push via the host).
- **Source types:** `path` (filesystem), `docker_volume` (named volume on a **source server** only → alpine tar → `.tar.gz`), or `database` (Postgres/MySQL/MariaDB logical dump → `.sql.gz` via native client or `docker exec`; local or server source). Destinations are always paths. Volume tar is **not** a consistent live-DB backup — use `database` for that. Restore (volume + database) needs a **local** artifact.
- **SSH key required** for any server endpoint involved in transfer. Password auth can test/connect via `node-ssh` only.
- **Optional app password** (single operator, no users table): first-run set/skip; manage in Settings. Hash in settings → middleware gates pages + `/api/*` (public: `/login`, `/api/auth/*`, `/api/health`). Session cookie `lb_session`, 30-day sliding expiry.
- Middleware verifies the session **in-process** (Node.js runtime + SQLite). Never HTTP self-fetch `/api/auth/status` from middleware (LAN Host hangs; loopback from Edge fails → pages load, APIs 401).
- Cookies default **non-Secure**; set `AUTH_COOKIE_SECURE=true` only behind HTTPS.
- Cron runs in the app **timezone** setting. Migrations are **`src/lib/db/migrate.ts`** only (no drizzle `migrations/` folder).

Links: [GitHub](https://github.com/Ceneka/lazybackup) · [landing](https://lazy.zic.ar) (`landing/` static export; Cloudflare Pages root = `landing`, output `out`) · image `ghcr.io/ceneka/lazybackup:latest`

## Stack

Bun · Next.js 15.5 App Router · React 19 · Tailwind 4 / shadcn · TanStack Query · Zod · SQLite (`@libsql/client`) + Drizzle · `node-ssh` · `cron` · `nanoid` (mostly; some history IDs use `randomUUID`) · auth middleware on Node.js runtime

## Layout

```
src/app/           # pages + api/* routes
src/components/    # ui/*, backup-config-form (From→To), app-shell, navbar
src/lib/auth/      # password hash, session cookie, isAuthorized
src/lib/backup/    # executeBackup, restore*, file-retention, storage-stats, destination, log-format
src/lib/database/  # dump/restore/test command builders for Postgres/MySQL/MariaDB
src/lib/docker/    # remote volume list/pack/restore helpers
src/lib/db/        # schema, client, migrate.ts
src/lib/hooks/     # React Query hooks (1:1 with APIs)
src/lib/scheduler/ # CronJob registry (timezone-aware)
src/lib/ssh/       # connect, rsync/scp pull+push, ephemeral S2S helpers
src/middleware.ts  # app-password gate
src/instrumentation.ts  # migrate + scheduler (skip during next build)
```

Alias `@/*` → `src/*`. Config: `next.config.ts` (standalone), `docker-compose.yml`, `Dockerfile`.

## Architecture

```
Browser (useQuery) → /api/* (Zod → Drizzle → JSON) → SQLite
instrumentation (nodejs, not during build) → migrate → schedule enabled configs
Backup: resolve From/To → pre-backup cmds → path transfer **or** docker pack **or** database dump → land artifact → version/file retention → history + artifactPath
Restore (volume/database, local dest only): history artifact → push/load → extract into volume or pipe into psql/mysql
```

## Data (`schema.ts`)

| Table | Notes |
|-------|--------|
| `servers` | host/port/user, `authType` password\|key, password / privateKey / `sshKeyId` / `systemKeyPath` |
| `ssh_keys` | name + content or path |
| `backup_configs` | `sourceKind`/`destinationKind` local\|server, nullable `serverId` (source) + `destinationServerId`, `sourceType` path\|docker_volume\|database, `sourcePath`/`destinationPath`, `db_*` for dumps, cron, excludes, pre-cmds, versioning + file retention |
| `backup_history` | status running\|success\|failed, sizes, `logOutput`, `artifactPath` (path of archive/dir; restore needs local dest) |
| `settings` | KV: timezone, SSH defaults, `appPasswordHash`, `sessionSecret`, `authSetupCompleted` |

Cascade: server → configs → history. Never return `appPasswordHash` / `sessionSecret` from `GET /api/settings`.

## API map

Pattern: Zod → Drizzle → `NextResponse.json`; errors `{ error, details? }`.

| Area | Paths |
|------|--------|
| Public | `GET /api/health`, `/api/auth/{status,setup,login,logout}` |
| Auth | `POST /api/auth/password` (set/change/remove) |
| Servers | `/api/servers`, `/api/servers/[id]`, `…/test`, `…/docker/volumes`, `POST /api/servers/test` |
| Backups | `/api/backups`, `/api/backups/[id]`, `…/run`, `…/toggle`, `…/storage`, `POST /api/backups/start`, `POST /api/backups/database/test` |
| History | `/api/history`, `/api/history/[id]`, `…/restore`, `/api/history/stats?chartData=` |
| Other | `/api/ssh-keys`, `/api/settings`, `/api/scheduler/restart`, `/api/dashboard`, `/api/seed` (dev only) |

## Backup workflow (`lib/backup/index.ts`)

1. Resolve From/To endpoints; optional pre-backup commands on source (SSH or local shell).
2. Prepare destination (local mkdir or remote mkdir). Versioning → `YYYY-MM-DD_HH-mm-ss` subfolder.
3. **Path:** local→local rsync; server→local pull; local→server push; server→server ephemeral direct or relay.
4. **Docker volume (source server only):** pack with alpine on source → land `.tar.gz` at destination path.
5. **Database (local or server):** `pg_dump` / `mysqldump` (native or `docker exec`) → `.sql.gz` temp file → land at destination (same pull/push/relay as volume archives).
6. Temp SSH identity + `-F /dev/null` (ignore host ssh config); ephemeral keys cleaned in `finally`.
7. Cleanup: version count and/or age-based file retention (local FS or remote over SSH).
8. History + `combineBackupLog`; storage stats for local dest (`storage-stats.ts`); remote dest returns a marker.
9. **Restore:** `POST /api/history/[id]/restore` → local artifact → volume extract **or** database load (local destinations only).

## Frontend

- Bun only; `"use client"` pages + hooks in `lib/hooks/`.
- Query keys: `backupKeys`, `['servers']`, `['stats']`, `authStatusKey`, etc.
- UI: `QueryState`, `DataState`, `LoadingButton`, `DeleteConfirmationDialog`, sonner toasts, `cn()`.
- Mobile `Sheet` uses `modal={false}` (avoids stuck body `pointer-events`).

## Env & commands

See README / `.env.example`. Important: `DATABASE_URL`, `PORT`, `BACKUP_STORAGE_PATH`, `SSH_KEYS_PATH`, `AUTH_SECRET`, `AUTH_COOKIE_SECURE`.

```bash
bun install && bun run dev
bun test                 # especially log-format, file-retention, storage-stats, session
bun run db:migrate       # migrate.ts is authoritative
bun run build && bun run start
docker compose up -d
```

CI publishes GHCR on `main` / `v*` tags (skips docs/`LICENSE`/`landing` via `paths-ignore`). Startup: migrate + cron via instrumentation. Healthcheck: `GET /api/health`.

## Conventions

- Match surrounding style; small diffs; one solid approach.
- Prefer extending existing hooks over ad-hoc `fetch`.
- ESLint ignored during builds (`next.config.ts`).

## Pitfalls

1. Password-only servers cannot execute transfers (need a key on each server endpoint).
2. Destinations may be **local or remote**; uniqueness is per endpoint (local path, or same server + path). Nested overlaps are UI warnings only.
3. Do not run migrate/scheduler during `next build` (already guarded).
4. Cron is 5-field; invalid expressions fail at schedule time; respect timezone setting.
5. Mixed IDs (`nanoid` vs `randomUUID`) — don’t assume one format.
6. App password ≠ SSH password; keep `/api/health` public.
7. `/api/seed` is dev-only. Licensed under MIT (`LICENSE`).
8. Auth middleware must run on the Node.js runtime and check the session in-process — no self-fetch.
9. Docker volume sources need remote `docker` + `alpine`; destinations are always paths (never “to volume”). Restore requires a **local** artifact.
10. Server→server ephemeral transfer needs source→dest network reachability; otherwise relay is used.
11. Database dumps need client tools on the source (`pg_dump`/`mysqldump` or inside the DB container). Do not stream dump SQL through `execCommand` stdout — always write a temp `.sql.gz` then transfer.

## Read first

| Task | Files |
|------|--------|
| Backup / retention / storage | `lib/backup/{index,file-retention,storage-stats,log-format,destination}.ts`, `lib/ssh/` (incl. `ephemeral.ts`) |
| From→To form UI | `components/backup-config-form.tsx`, `app/backups/new`, `app/backups/[id]/edit` |
| Docker volumes | `lib/docker/volumes.ts`, `GET …/docker/volumes`, `POST …/history/[id]/restore` |
| Database dumps | `lib/database/`, `POST /api/backups/database/test`, restore via `POST …/history/[id]/restore` |
| Scheduling / timezone | `lib/scheduler/`, `instrumentation.ts` |
| DB | `lib/db/schema.ts`, `lib/db/migrate.ts` |
| App password | `lib/auth/`, `middleware.ts`, `app/api/auth/` |
| UI patterns | `lib/hooks/useBackups.ts`, `components/ui/query-state.tsx` |
