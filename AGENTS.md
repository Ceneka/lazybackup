# AGENTS.md — LazyBackup

Guide for AI coding agents. User-facing setup lives in [README.md](./README.md) and [`.env.example`](./.env.example).

## Mental model

- Backups **pull** from the remote VPS to the **LazyBackup host** (`rsync` preferred, `scp` fallback). Destinations like `/backups/foo` are local (Docker volume). New configs default to `/backups/<server-slug>/<backup-slug>`; destination paths must be unique (resolved-path check on create/update).
- **Source types:** `path` (remote filesystem) or `docker_volume` (named volume → remote alpine tar → pull `.tar.gz`). Restore pushes the archive back and extracts into a volume.
- **SSH key required to run backups.** Password auth can test/connect via `node-ssh` only; transfer needs a private key (`resolvePrivateKeyForServer`).
- **Optional app password** (single operator, no users table): first-run set/skip; manage in Settings. Hash in settings → middleware gates pages + `/api/*` (public: `/login`, `/api/auth/*`, `/api/health`). Session cookie `lb_session`, 30-day sliding expiry.
- Middleware verifies the session **in-process** (Node.js runtime + SQLite). Never HTTP self-fetch `/api/auth/status` from middleware (LAN Host hangs; loopback from Edge fails → pages load, APIs 401).
- Cookies default **non-Secure**; set `AUTH_COOKIE_SECURE=true` only behind HTTPS.
- Cron runs in the app **timezone** setting. Migrations are **`src/lib/db/migrate.ts`** only (no drizzle `migrations/` folder).

Links: [GitHub](https://github.com/Ceneka/lazybackup) · [landing](https://lazy.zic.ar) · image `ghcr.io/ceneka/lazybackup:latest`

## Stack

Bun · Next.js 15.5 App Router · React 19 · Tailwind 4 / shadcn · TanStack Query · Zod · SQLite (`@libsql/client`) + Drizzle · `node-ssh` · `cron` · `nanoid` (mostly; some history IDs use `randomUUID`) · auth middleware on Node.js runtime

## Layout

```
src/app/           # pages + api/* routes
src/components/    # ui/*, app-shell, auth-setup-prompt, navbar
src/lib/auth/      # password hash, session cookie, isAuthorized
src/lib/backup/    # executeBackup, restoreDockerVolumeBackup, file-retention, storage-stats, log-format
src/lib/docker/    # remote volume list/pack/restore helpers
src/lib/db/        # schema, client, migrate.ts
src/lib/hooks/     # React Query hooks (1:1 with APIs)
src/lib/scheduler/ # CronJob registry (timezone-aware)
src/lib/ssh/       # connect, rsync/scp pull+push helpers
src/middleware.ts  # app-password gate
src/instrumentation.ts  # migrate + scheduler (skip during next build)
```

Alias `@/*` → `src/*`. Config: `next.config.ts` (standalone), `docker-compose.yml`, `Dockerfile`.

## Architecture

```
Browser (useQuery) → /api/* (Zod → Drizzle → JSON) → SQLite
instrumentation (nodejs, not during build) → migrate → schedule enabled configs
Backup: connect → pre-backup cmds → path rsync|scp **or** docker pack+pull → version/file retention → history + artifactPath
Restore (docker): history artifact → push → alpine extract into volume
```

## Data (`schema.ts`)

| Table | Notes |
|-------|--------|
| `servers` | host/port/user, `authType` password\|key, password / privateKey / `sshKeyId` / `systemKeyPath` |
| `ssh_keys` | name + content or path |
| `backup_configs` | `sourceType` path\|docker_volume, remote `sourcePath` (path or volume name), local `destinationPath`, cron, excludes, pre-cmds, `enableVersioning`/`versionsToKeep`, `enableFileRetention`/`retentionMaxAge`(+unit)/`retentionMinKeep` |
| `backup_history` | status running\|success\|failed, sizes, `logOutput`, `artifactPath` (local archive/dir for restore) |
| `settings` | KV: timezone, SSH defaults, `appPasswordHash`, `sessionSecret`, `authSetupCompleted` |

Cascade: server → configs → history. Never return `appPasswordHash` / `sessionSecret` from `GET /api/settings`.

## API map

Pattern: Zod → Drizzle → `NextResponse.json`; errors `{ error, details? }`.

| Area | Paths |
|------|--------|
| Public | `GET /api/health`, `/api/auth/{status,setup,login,logout}` |
| Auth | `POST /api/auth/password` (set/change/remove) |
| Servers | `/api/servers`, `/api/servers/[id]`, `…/test`, `…/docker/volumes`, `POST /api/servers/test` |
| Backups | `/api/backups`, `/api/backups/[id]`, `…/run`, `…/toggle`, `…/storage`, `POST /api/backups/start` |
| History | `/api/history`, `/api/history/[id]`, `…/restore`, `/api/history/stats?chartData=` |
| Other | `/api/ssh-keys`, `/api/settings`, `/api/scheduler/restart`, `/api/dashboard`, `/api/seed` (dev only) |

## Backup workflow (`lib/backup/index.ts`)

1. Connect → optional remote pre-backup commands (`log-format.ts`).
2. Resolve local dest (`~` expand, mkdir). Versioning → `YYYY-MM-DD_HH-mm-ss` subfolder.
3. **Path:** remote rsync → local `rsync -avz -e 'ssh …'`; else local scp per file; else fail.
4. **Docker volume:** pack with alpine helper on remote → pull `.tar.gz` → store `artifactPath`.
5. Temp SSH identity + `-F /dev/null` (ignore host ssh config).
6. Cleanup: version count and/or age-based file retention (`file-retention.ts`).
7. History + `combineBackupLog`; on-disk resume via `storage-stats.ts` / `GET …/storage`.
8. **Restore:** `POST /api/history/[id]/restore` → push artifact → extract into volume (`lib/docker/volumes.ts`).

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

CI publishes GHCR on `main` / `v*` tags. Startup: migrate + cron via instrumentation. Healthcheck: `GET /api/health`.

## Conventions

- Match surrounding style; small diffs; one solid approach.
- Prefer extending existing hooks over ad-hoc `fetch`.
- ESLint ignored during builds (`next.config.ts`).

## Pitfalls

1. Password-only servers cannot execute backups (need a key).
2. Destination paths are on the **app host**, not the VPS. They must be unique across configs (API returns 409 on conflict); existing paths are not auto-migrated.
3. Do not run migrate/scheduler during `next build` (already guarded).
4. Cron is 5-field; invalid expressions fail at schedule time; respect timezone setting.
5. Mixed IDs (`nanoid` vs `randomUUID`) — don’t assume one format.
6. App password ≠ SSH password; keep `/api/health` public.
7. `/api/seed` is dev-only. No LICENSE in repo — don’t claim MIT.
8. Auth middleware must run on the Node.js runtime and check the session in-process — no self-fetch.
9. Docker volume backups need remote `docker` access + ability to pull `alpine`; restore overwrites volume data only.

## Read first

| Task | Files |
|------|--------|
| Backup / retention / storage | `lib/backup/{index,file-retention,storage-stats,log-format,destination}.ts`, `lib/ssh/` |
| Docker volumes | `lib/docker/volumes.ts`, `GET …/docker/volumes`, `POST …/history/[id]/restore` |
| Scheduling / timezone | `lib/scheduler/`, `instrumentation.ts` |
| DB | `lib/db/schema.ts`, `lib/db/migrate.ts` |
| App password | `lib/auth/`, `middleware.ts`, `app/api/auth/` |
| UI patterns | `lib/hooks/useBackups.ts`, `components/ui/query-state.tsx` |
