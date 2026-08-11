# AGENTS.md — LazyBackup

Guide for AI coding agents. User-facing setup lives in [README.md](./README.md) and [`.env.example`](./.env.example).

## Mental model

- Backups are **From → To** transfers between endpoints: **this host (local)**, any configured **Server**, or an **S3-compatible** profile. Directions include local↔local, local↔server, server↔server, and any side with S3 (S3 path sources; archives and path trees can land on S3).
- Default for new configs remains **Server → Local** (`/backups/<server-slug>/<backup-slug>`). Destination uniqueness is per endpoint (local path, `(destinationServerId, path)`, or `(destinationS3ProfileId, prefix)`).
- **Server → Server** prefers an **ephemeral SSH key** installed on the destination so the source can rsync directly; if the source cannot reach the dest, LazyBackup **relays** (pull then push via the host). S3 transfers always relay via the LazyBackup host.
- **Source types:** `path` (filesystem or S3 object prefix), `docker_volume` (named volume on a **source server** only → alpine tar → `.tar.gz`), or `database` (Postgres/MySQL/MariaDB logical dump → `.sql.gz` via native client or `docker exec`; local or server source). Destinations are paths or S3 prefixes. Volume tar is **not** a consistent live-DB backup — use `database` for that. Restore (volume + database) needs a **local** artifact or downloads from **S3** first.
- For **database + docker client** on a server source, the form can list running containers and auto-fill credentials from `docker inspect` env (`POSTGRES_*` / `MYSQL_*` / `MARIADB_*`).
- **SSH key required** for any server endpoint involved in a **transfer** (host-side rsync/scp). Password auth works for Test connection and other `node-ssh` operations (list volumes/containers, remote shell cmds); it is not enough alone to pull/push path backups.
- **Optional app password** (single operator, no users table): first-run set/skip; manage in Settings. Hash in settings → middleware gates pages + `/api/*` (public: `/login`, `/api/auth/*`, `/api/health`). Session cookie `lb_session`, 30-day sliding expiry.
- **API tokens** (Settings → API / MCP): Bearer `Authorization` for agents; hashed in `api_tokens`. Streamable HTTP MCP at `/mcp` (same auth gate). Token CRUD requires a browser session (tokens cannot mint tokens).
- Middleware verifies the session **in-process** (Node.js runtime + SQLite). Never HTTP self-fetch `/api/auth/status` from middleware (LAN Host hangs; loopback from Edge fails → pages load, APIs 401).
- Cookies default **non-Secure**; set `AUTH_COOKIE_SECURE=true` only behind HTTPS.
- Cron runs in the app **timezone** setting. Migrations are **`src/lib/db/migrate.ts`** only (no drizzle `migrations/` folder).

Links: [GitHub](https://github.com/Ceneka/lazybackup) · [landing](https://lazy.zic.ar) (`landing/` static export; Cloudflare Pages root = `landing`, output `out`) · image `ghcr.io/ceneka/lazybackup:latest`

## Stack

Bun · Next.js 15.5 App Router · React 19 · Tailwind 4 / shadcn · TanStack Query · Zod · SQLite (`@libsql/client`) + Drizzle · `node-ssh` · `@aws-sdk/client-s3` · `cron` · `nanoid` (mostly; some history IDs use `randomUUID`) · auth middleware on Node.js runtime

## Layout

```
src/app/           # pages + api/* routes
src/components/    # ui/*, page-layout, backup-config-form (From→To), s3-profile-form, app-shell, navbar
src/lib/auth/      # password hash, session cookie, isAuthorized
src/lib/backup/    # executeBackup, validateBackupConfig, restore*, file-retention, storage-stats, destination, log-format
src/lib/api/       # resource-in-use, redact (strip secrets from API responses)
src/lib/database/  # dump/restore/test command builders for Postgres/MySQL/MariaDB
src/lib/docker/    # remote volume/container list, pack/restore, DB inspect hints
src/lib/notify/    # failure webhook (templates, presets)
src/lib/s3/        # S3-compatible client (upload/download/list/delete/test)
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
Backup: resolve From/To → pre-backup cmds → path transfer **or** docker pack **or** database dump → land artifact (FS or S3) → version/file retention → history + artifactPath
Restore (volume/database, local or S3 dest): history artifact → download from S3 if needed → push/load → extract into volume or pipe into psql/mysql
```

## Data (`schema.ts`)

| Table | Notes |
|-------|--------|
| `servers` | host/port/user, `authType` password\|key, password / privateKey / `sshKeyId` / `systemKeyPath` |
| `ssh_keys` | name + content or path |
| `s3_profiles` | endpoint, region, bucket, access/secret keys, `forcePathStyle` |
| `backup_configs` | `sourceKind`/`destinationKind` local\|server\|s3, nullable `serverId` / `destinationServerId` / `sourceS3ProfileId` / `destinationS3ProfileId`, `sourceType` path\|docker_volume\|database, `sourcePath`/`destinationPath` (prefix when S3), `db_*` for dumps, cron, excludes, pre-cmds, versioning + file retention, optional last validation (`lastValidatedAt` / `lastValidationOk` / `lastValidationChecks`; cleared on config update) |
| `backup_history` | status running\|success\|failed, sizes, `logOutput`, `artifactPath` (local path or `s3://bucket/key`) |
| `settings` | KV: timezone, SSH defaults, `appPasswordHash`, `sessionSecret`, `authSetupCompleted`, failure webhook URL/method/headers/body |
| `api_tokens` | Named Bearer tokens (SHA-256 hash + prefix); used by MCP / machine clients |
| `audit_log` | Token/MCP action audit (no secrets) |

Cascade: server/S3 profile → configs → history. Never return `appPasswordHash` / `sessionSecret` from `GET /api/settings`.

## API map

Pattern: Zod → Drizzle → `NextResponse.json`; errors `{ error, details? }`.

| Area | Paths |
|------|--------|
| Public | `GET /api/health`, `/api/auth/{status,setup,login,logout}` |
| Auth | `POST /api/auth/password` (set/change/remove) |
| API tokens | `/api/api-tokens`, `/api/api-tokens/[id]` (session-only manage); MCP `GET|POST|DELETE /mcp` |
| MCP discovery | Tools: `find_server`, `list_docker_volumes`, `list_docker_containers`, `get_container_db_hints`, `test_server`, `test_database` (wrap existing SSH/Docker/DB helpers) |
| Servers | `/api/servers`, `/api/servers/[id]`, `…/test`, `…/docker/volumes`, `…/docker/containers`, `…/docker/containers/[name]/db-hints`, `POST /api/servers/test` |
| S3 | `/api/s3-profiles`, `/api/s3-profiles/[id]`, `…/test`, `POST /api/s3-profiles/test` |
| Backups | `/api/backups`, `/api/backups/[id]`, `…/run`, `…/validate`, `…/toggle`, `…/storage`, `POST /api/backups/start`, `POST /api/backups/database/test` |
| History | `/api/history`, `/api/history/[id]`, `…/restore`, `/api/history/stats?chartData=` |
| Other | `/api/ssh-keys`, `/api/settings`, `/api/scheduler/restart`, `/api/dashboard`, `/api/seed` (dev only) |

## Backup workflow (`lib/backup/index.ts`)

1. Resolve From/To endpoints; optional pre-backup commands on source (SSH or local shell; skipped for S3 sources).
2. Prepare destination (local mkdir, remote mkdir, or S3 prefix). Versioning → `YYYY-MM-DD_HH-mm-ss` subfolder/prefix.
3. **Path:** local→local rsync; server→local pull; local→server push; server→server ephemeral direct or relay; any side with S3 via host upload/download.
4. **Docker volume (source server only):** pack with alpine on source → land `.tar.gz` at destination path/prefix.
5. **Database (local or server):** `pg_dump` / `mysqldump` (native or `docker exec`) → `.sql.gz` temp file → land at destination.
6. Temp SSH identity + `-F /dev/null` (ignore host ssh config); ephemeral keys cleaned in `finally`.
7. Cleanup: version count and/or age-based file retention (local FS, remote SSH, or S3 delete).
8. History + `combineBackupLog`; storage stats for local dest (`storage-stats.ts`); remote/S3 dest returns a marker.
9. **Restore:** `POST /api/history/[id]/restore` → local artifact or download from S3 → volume extract **or** database load.

## Frontend

- Bun only; `"use client"` pages + hooks in `lib/hooks/`.
- Page chrome: `AppShell` owns `container` + padding; list/detail pages use `PageLayout` / `PageHeader` (do not nest another `container py-*` layout).
- Query keys: `backupKeys`, `['servers']`, `['stats']`, `authStatusKey`, etc.
- UI: `QueryState`, `DataState`, `LoadingButton`, `DeleteConfirmationDialog`, sonner toasts, `cn()`.
- Mobile `Sheet` uses `modal={false}` (avoids stuck body `pointer-events`).
- Failure webhooks: Settings KV `failureWebhookUrl` / `Method` / `Headers` / `Body` with `{{tag}}` templates (`lib/notify/failure-webhook.ts`).

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

1. Password-only servers can test/connect and run some SSH helpers, but cannot complete path transfers — need a key on each server endpoint used in a backup.
2. Destinations may be **local or remote**; uniqueness is per endpoint (local path, or same server + path). Nested overlaps are UI warnings only.
3. Do not run migrate/scheduler during `next build` (already guarded).
4. Cron is 5-field; invalid expressions fail at schedule time; respect timezone setting.
5. Mixed IDs (`nanoid` vs `randomUUID`) — don’t assume one format.
6. App password ≠ SSH password; keep `/api/health` public.
7. `/api/seed` is dev-only. Licensed under MIT (`LICENSE`).
8. Auth middleware must run on the Node.js runtime and check the session in-process — no self-fetch.
9. Docker volume sources need remote `docker` + `alpine`; destinations are always paths/prefixes (never “to volume”). Restore requires a **local** artifact or an **S3** download.
10. Server→server ephemeral transfer needs source→dest network reachability; otherwise relay is used.
11. Database dumps need client tools on the source (`pg_dump`/`mysqldump` or inside the DB container). Do not stream dump SQL through `execCommand` stdout — always write a temp `.sql.gz` then transfer.
12. S3 sources only support `sourceType=path` (object prefix). Use `@aws-sdk/client-s3` with custom endpoint + path-style for MinIO/R2/B2.

## Read first

| Task | Files |
|------|--------|
| Backup / retention / storage | `lib/backup/{index,file-retention,storage-stats,log-format,destination}.ts`, `lib/ssh/` (incl. `ephemeral.ts`) |
| From→To form UI | `components/backup-config-form.tsx`, `app/backups/new`, `app/backups/[id]/edit` |
| Docker volumes / DB containers | `lib/docker/{volumes,containers}.ts`, `GET …/docker/volumes`, `GET …/docker/containers`, `GET …/db-hints`, `POST …/history/[id]/restore` |
| S3 profiles | `lib/s3/`, `/api/s3-profiles`, `app/s3-profiles` |
| Database dumps | `lib/database/`, `POST /api/backups/database/test`, restore via `POST …/history/[id]/restore` |
| Scheduling / timezone | `lib/scheduler/`, `instrumentation.ts` |
| DB | `lib/db/schema.ts`, `lib/db/migrate.ts` |
| App password | `lib/auth/`, `middleware.ts`, `app/api/auth/` |
| UI patterns | `lib/hooks/useBackups.ts`, `components/ui/query-state.tsx` |
