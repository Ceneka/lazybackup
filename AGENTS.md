# AGENTS.md — LazyBackup

Guide for AI coding agents. User-facing setup lives in [README.md](./README.md) and [`.env.example`](./.env.example).

## Mental model

- Backups are **From → To** transfers between endpoints: **this host (local)**, any configured **Server**, an **S3-compatible** profile, a **Bro Space peer**, or a **Git** remote (source only). Directions include local↔local, local↔server, server↔server, and any side with S3 (S3 path sources; archives and path trees can land on S3). Git sources clone a bare mirror on this host, tar it, then land like a volume archive.
- Default for new configs remains **Server → Local** (`/backups/<server-slug>/<backup-slug>`). Destination uniqueness is per endpoint: normalized local path, `(destinationServerId, path)`, `(destinationS3ProfileId, prefix)` and `(destinationPeerId, prefix)` (`lib/backup/destination-guard.ts`).
- **Server → Server** prefers an **ephemeral SSH key** installed on the destination so the source can rsync directly; if the source cannot reach the dest, LazyBackup **relays** (pull then push via the host). S3 transfers always relay via the LazyBackup host.
- Source types: `path` (filesystem or S3 object prefix), `docker_volume` (named volume on a **source server** or **this host’s Docker socket** → alpine tar → `.tar.gz`), `database` (Postgres/MySQL/MariaDB/SQLite dump → `.sql.gz` / `.sqlite.gz` via native client or `docker exec`; SQLite is native-only; local or server source), **`lazybackup_instance`** (local only; packs SQLite + age vault + DB-stored SSH key rows; passphrase wrap), or **`git_repo`** (Git connection → `git clone --mirror` on this host → `.tar.gz`). Destinations are paths, S3 prefixes or peer prefixes. Volume tar is **not** a consistent live-DB backup — use `database` for that. Restore (path + volume + database + Git mirror) pulls a **local** artifact, downloads from **S3**/Bro, or pulls from an **SSH destination with key auth**; History can retarget onto a different host. Password-only SSH dests cannot pull.
- For **database + docker client** on a server source, the form can list running containers and auto-fill credentials from `docker inspect` env (`POSTGRES_*` / `MYSQL_*` / `MARIADB_*`).
- **SSH key required** for any server endpoint involved in a **transfer** (host-side rsync/scp), including pulling volume/database archives; password auth works for Test connection and other `node-ssh` operations (list volumes/containers, remote shell cmds) but is not enough to move artifacts. Write-time key validation lives in `lib/ssh/key-validate.ts`.
- **Optional app password** (single operator, no users table): first-run set/skip; manage in Settings. Hash in settings → middleware gates pages + `/api/*` (see the exact public list below). Session cookie `lb_session`, 30-day sliding expiry. **Passkeys** (WebAuthn) can lock the instance alone or alongside the password (`webauthn_credentials`). Session mutations require a same-origin request (CSRF); mutations with a body require `application/json` (415 otherwise). Tokens, passkey registration and vault changes need **step-up** (current password or passkey) and a *locked* browser session.
- Public paths are exact (`lib/auth/public-paths.ts`): `/login`, `/api/health`, `/api/auth/status|login|setup`, `/api/auth/webauthn/login`, `/api/peers/pair`, `/manifest.webmanifest`, `/api/peers/store(/…)`, `/api/peers/agent/*`, plus Next assets and top-level files. `/api/auth/logout`, `/api/auth/password` and `/mcp` are gated.
- **API tokens** (Settings → API / MCP): Bearer `Authorization` for agents; hashed in `api_tokens`. Streamable HTTP MCP at `/mcp` (same auth gate). Token CRUD requires a locked browser session (tokens cannot mint tokens). Opt-in `remote_exec` gates `exec_command` and setting/changing `preBackupCommands` (session/unlocked always allowed). Opt-in `read_only` (mutually exclusive with `remote_exec`) omits mutating MCP tools from `tools/list` and blocks non-GET `/api/*` **except** `/mcp`, `POST /api/backups/:id/validate`, `POST /api/servers/:id/test`, `POST /api/s3-profiles/:id/test` and `POST|DELETE /api/servers/:id/authorize-key`; ad-hoc probes (`POST /api/servers/test`, `/api/s3-profiles/test`, `/api/git-repos/test`, `/api/backups/database/test`) are denied so a token cannot SSRF/port-scan. Opt-in `authorize_keys` (combinable with `read_only`; implied by `remote_exec`) gates `POST`/`DELETE /api/servers/[id]/authorize-key`, which adds/removes a caller's OpenSSH public key in that server's `~/.ssh/authorized_keys` using the stored credentials (`lib/ssh/authorize-key.ts`; strict key parsing, no options, audit `authorize_key`/`revoke_key` with the fingerprint). sshya's lazybackup link uses it so vault private keys never leave the instance.
- **Encryption** (Settings → Encryption): optional per-backup **age** encryption before land (local/server/S3). Forced on for Bro destinations. Keys live in an **`age_keys` vault** (one **active** for new encrypts; **retired** / **compromised** kept for decrypt). Optional **recovery recipients** (`age1…`) are added on every encrypt. Private identities stay on this instance; export (plaintext or passphrase-wrapped) for disaster recovery. **Create new key** demotes the previous active to retired (never silent overwrite).
- **Instance meta-backup** (`sourceType=lazybackup_instance`): packs SQLite (Bun `VACUUM INTO`, else a WAL-safe copy of `db + -wal + -shm`) + age-vault export + `ssh-keys.json` **rows**; key material that only exists at `privateKeyPath`/system keys is not included. The archive **passphrase is required for any non-local destination** (optional only under `BACKUP_STORAGE_PATH`). Restore is manual.
- **Bro Space** (Settings → Bro Space): 1:1 reciprocal peer storage. Invite code → accept → `destinationKind=peer`. **Mailbox** transport (default for new pairs): land to local staging, peer pulls via `/api/peers/agent/*`; ACK = off-site. **LazyBro** clients are outbound-only (`mode=client`, no remote URL). Full LB↔LB both run the outbound sync worker. Opaque quota’d blobs (32 GiB / 20 000 objects per peer); instances need a reachable HTTPS/Tailscale URL for LazyBro to dial.
- Middleware verifies the session **in-process** (Node.js runtime + SQLite). Never HTTP self-fetch `/api/auth/status` from middleware (LAN Host hangs; loopback from Edge fails → pages load, APIs 401).
- Cookies default **non-Secure**; set `AUTH_COOKIE_SECURE=true` only behind HTTPS.
- Cron runs in the app **timezone** setting. Migrations are **`src/lib/db/migrate.ts`** only (never `bun run db:generate`, which writes `./migrations`).

Links: [GitHub](https://github.com/Ceneka/lazybackup) · [landing](https://lazy.zic.ar) (`landing/` static export; Cloudflare Pages root = `landing`, output `out`) · image `ghcr.io/ceneka/lazybackup:latest`

## Stack

Bun · Next.js 15.5 App Router · React 19 · Tailwind 4 / shadcn · TanStack Query · Zod · SQLite (`@libsql/client`) + Drizzle · `node-ssh` · `@aws-sdk/client-s3` · `cron` · `nanoid` (mostly; some history IDs use `randomUUID`) · auth middleware on Node.js runtime

## Layout

```
src/app/           # pages + api/* routes; manifest.ts → public /manifest.webmanifest
src/components/    # ui/*, page-layout, backup-config-form (From→To), connections/*, s3-profile-form, app-shell, navbar
src/lib/auth/      # password hash, session cookie, isAuthorized, public-path list, permissions, CSRF/content guards
src/lib/crypto/    # age encrypt/decrypt (streaming), key settings helpers
src/lib/peer/      # Bro Space pairing, mailbox staging/recall, sync worker, reports, opaque store, per-peer lock
bro/               # LazyBro outbound agent (Bun); see bro/README.md
src/lib/backup/    # executeBackup, config-update (PUT merge), validate, restore*, encrypt-artifact, land-file, retention, storage-stats (cached)
src/lib/api/       # resource-in-use, redact (strip secrets), method-allow (405 map)
src/lib/database/  # dump/restore/test command builders for Postgres/MySQL/MariaDB **and SQLite** (snapshot, cp fallback)
src/lib/docker/    # volume/container list (local socket + remote), pack/restore, DB inspect hints, volume-exists guard
src/lib/notify/    # failure webhook + success ping (templates, presets)
src/lib/s3/        # S3-compatible client, endpoint guard, bucket-name rules
src/lib/git/       # Git URL parse, ls-remote test, SSH env/timeouts, clone --mirror + tar
src/lib/db/        # schema, client, migrate.ts (authoritative; indexes live here)
src/lib/hooks/     # React Query hooks (1:1 with APIs)
src/lib/scheduler/ # CronJob registry (timezone-aware)
src/lib/ssh/       # connect, key validation, rsync/scp pull+push, ephemeral S2S helpers, known_hosts
src/middleware.ts  # auth gate, CSRF, JSON content-type, read_only, 405/Allow
src/instrumentation.ts  # migrate + scheduler + storage cache warm (skip during next build)
```

Alias `@/*` → `src/*`. Config: `next.config.ts` (standalone), `docker-compose.yml`, `Dockerfile`.

## Architecture

```
Browser (useQuery) → /api/* (Zod → Drizzle → JSON) → SQLite
instrumentation (nodejs, not during build) → migrate → schedule enabled configs → warm storage cache
Backup: resolve From/To → pre-backup cmds → path transfer **or** docker pack **or** database dump **or** Git mirror **or** instance pack → land artifact (FS, S3, peer staging, SSH dest) → version/file retention → history + artifactPath
Restore (path/volume/database/git; local, S3, bro, SSH dest): run's configSnapshot → artifact (download if needed) → rsync/push tree, extract volume, load dump, or unpack a Git bare mirror
Storage totals: on demand (`/api/dashboard/storage`, `/api/backups/[id]/storage`), 5 min stale-while-revalidate cache, warmed at startup, dirtied on backup.finished
```

## Data (`schema.ts`)

| Table | Notes |
|-------|--------|
| `servers` | host/port/user (1–65535), `authType` password\|key, password / privateKey / `sshKeyId` / `systemKeyPath` (`~` expanded); keys are parsed on write |
| `ssh_keys` | name + content or path (exactly one; validated) |
| `s3_profiles` | endpoint, region, bucket (provider naming rules), access/secret keys, `forcePathStyle`; loopback/private endpoints refused on save unless `ALLOW_PRIVATE_S3_ENDPOINTS=true` |
| `git_repos` | name, URL (`git@…` / `ssh://` / public `https://`), optional `sshKeyId` → `ssh_keys` `ON DELETE SET NULL` (existence + key material validated) |
| `backup_configs` | `sourceKind`/`destinationKind` local\|server\|s3\|**peer** (source also **git**), nullable `serverId` / `destinationServerId` / `sourceS3ProfileId` / `destinationS3ProfileId` / **`destinationPeerId`** / **`sourceGitRepoId`**, `sourceType` path\|docker_volume\|database\|**`lazybackup_instance`**\|**`git_repo`**, `sourcePath`/`destinationPath` (prefix when S3/peer), `db_*` for dumps, `instanceBackupPassphrase`, 5-field cron, excludes, pre-cmds, **`enableEncryption`**, **`deleteExtraneous`**, versioning + file retention (**mutually exclusive**), last validation (stored flat; `GET` exposes nested `lastValidation: { ok, at, checks }`). Save validates referenced ids (400), never stores dangling peers. |
| `backup_history` | status running\|success\|failed, file/size counters, `logOutput` (**capped at 512 KiB**, tail kept + marker), `artifactPath` (local path, `s3://bucket/key`, `peer://<peerId>/<key>` or an SSH-destination path), `artifactSha256`, `mailboxPending`, `artifactRemoved`(+`Reason`), `deliveryError` (API also returns the legacy `mailboxError` alias), `configSnapshot` (restores use the run's settings). Indexes: `(config_id,start_time)`, `(start_time)`, `(mailbox_pending)`, `(status,start_time)`. |
| `settings` | KV: timezone, SSH defaults, `appPasswordHash`, `sessionSecret`, `sessionEpoch` (invalidates sessions on password change), `authSetupCompleted`, failure webhook + success ping URL/method/headers/body |
| `age_keys` | Age vault: identity + recipient, status active\|retired\|compromised, export ack |
| `age_recovery_recipients` | Extra public `age1…` included on every encrypt |
| `webauthn_credentials` | Passkey login credentials |
| `api_tokens` | Named Bearer tokens (SHA-256 hash + prefix); optional JSON `permissions` (e.g. `["remote_exec"]`, `["read_only"]`, `["read_only","authorize_keys"]`); used by MCP / machine clients |
| `peers` / `peer_invites` / `peer_recalls` / `peer_deletes` | Bro Space pairing, mailbox recalls and mailbox delete tombstones; peers have `transport` mailbox\|direct, `lastSeenAt`, `remote_*` report columns (`remoteUsedBytes` = our data on THEIR disk, `remoteQuotaBytes`, `remoteLastError`, `remoteLastSyncAt`, `remoteAppVersion`, `remoteReportedAt`); LazyBro has empty `remoteBaseUrl`; `GET /api/peers` adds `kind`/`online`/pending staging totals |
| `audit_log` | Token/MCP action audit (no secrets) |

Cascade: server/S3 profile/Git repo → configs → history. Never return `appPasswordHash` / `sessionSecret` from `GET /api/settings`; `redact*` helpers strip secrets and add `has*` booleans.

## API map

Pattern: Zod → Drizzle → `NextResponse.json`; errors `{ error, details? }`. Schedules must be valid 5-field cron expressions, rejected at create/update time. Unknown `/api/*` paths return JSON `404 {error}` (catch-all `app/api/[...notFound]`). Unsupported methods on **static** API paths return `405 { error }` + `Allow` after the auth/read-only gate; `OPTIONS` → `204` + `Allow` (`lib/api/method-allow.ts`, drift-tested against every `route.ts`); dynamic routes keep Next's empty 405.

| Area | Paths |
|------|--------|
| Public | `GET /api/health`, `/api/auth/{status,login,setup}`, `/api/auth/webauthn/login`, `/api/peers/pair`, `/api/peers/store`, `/api/peers/agent/*` (all authenticate inside the route) |
| Auth | `POST /api/auth/password` (set/change/remove; step-up), `POST /api/auth/logout` |
| API tokens | `/api/api-tokens`, `/api/api-tokens/[id]` (locked session + step-up); MCP `GET|POST|DELETE /mcp` |
| Encryption | `/api/encryption` (locked session + step-up; age vault CRUD, export, recovery recipients) |
| Passkeys | `/api/auth/webauthn/{register,login,credentials,step-up}` |
| Bro Space | `/api/peers` (session manage), `POST /api/peers/pair`, `/api/peers/store` (peer Bearer `lbpeer_`), `/api/peers/agent/{ping,work,pending,ack,recall}` + `PUT /api/peers/agent/recall/[id]`, `POST /api/peers/recall` (session wait), `/api/peers/addresses`, `/api/peers/tailscale` |
| MCP tools | Read: `list_backups`, `get_backup`, `list_history`, `get_history`, `list_servers`, `list_s3_profiles`, `get_dashboard`, `get_status`, `find_server`, `list_docker_volumes`, `list_docker_containers`, `get_container_db_hints`, `test_server`, `test_database`, `validate_backup`; plus write tools (`create/update/delete/run/toggle/restore`, server/profile/repo CRUD) gated by permission; `exec_command` only with `remote_exec` |
| Servers | `/api/servers`, `/api/servers/[id]`, `…/test`, `…/exec` (Bearer needs `remote_exec`), `…/authorize-key` (POST/DELETE; `authorize_keys` or `remote_exec`), `…/docker/volumes`, `…/docker/containers`, `…/docker/containers/[name]/db-hints`, `POST /api/servers/test` (ad-hoc probe) |
| S3 | `/api/s3-profiles`, `/api/s3-profiles/[id]`, `…/test`, `POST /api/s3-profiles/test` |
| Git | `/api/git-repos`, `/api/git-repos/[id]`, `…/test`, `POST /api/git-repos/test` (`ls-remote`, 20 s) |
| Backups | `/api/backups`, `/api/backups/[id]` (GET/PUT partial merge/DELETE), `…/run`, `…/validate`, `…/toggle`, `…/storage`, `GET /api/backups/storage-root`, `POST /api/backups/start`, `POST /api/backups/database/test`. Clone is UI-only (`/backups/new?cloneFrom=<id>`) |
| History | `/api/history`, `/api/history/[id]`, `…/restore`, `…/download`, `/api/history/stats?chartData=`, `GET /api/events` (SSE). `/api/history/[id]/download?retry=1` needs write access |
| SSH keys | `/api/ssh-keys`, `/api/ssh-keys/[id]`, `POST /api/ssh-keys/generate`, `GET /api/ssh-keys/[id]/install-command` (400 for an unparseable saved key) |
| Settings | `POST /api/settings` (writes; `GET` lists, `DELETE` removes a key), `GET /api/settings/export`, `POST /api/settings/webhook-test`, `POST /api/settings/success-ping-test` |
| Local Docker | `GET /api/docker/volumes`, `GET /api/docker/containers`, `GET /api/docker/containers/[name]/db-hints` |
| Other | `GET /api/version` (session-only, GitHub latest cache), `/api/scheduler/restart`, `/api/dashboard`, `GET /api/dashboard/storage` (cached walk; warmed at startup, dirtied on `backup.finished`), `/api/status`, `/api/seed` (dev only) |

## Backup workflow (`lib/backup/index.ts`)

1. Resolve From/To endpoints; optional pre-backup commands on source (SSH or local shell; **skipped for S3, Git and `lazybackup_instance`**). A non-zero exit aborts before any destination work; the log keeps the command output.
2. Prepare destination (local mkdir, remote mkdir, S3 prefix, peer staging). Versioning → `YYYY-MM-DD_HH-mm-ss` subfolder/prefix.
3. **Path:** local→local rsync; server→local pull; local→server push; server→server ephemeral direct or relay; any side with S3 via host upload/download.
4. **Docker volume (source server or local Docker):** `docker volume inspect` first (a missing name fails the run; `docker run -v/--mount` would silently create it) → alpine tar via `--mount …,volume-nocopy` → land `.tar.gz`.
5. **Database dump (local or server):** `pg_dump` / `mysqldump` (native or `docker exec`) → `.sql.gz`; SQLite → `.sqlite.gz` via Bun `VACUUM INTO`, `sqlite3` CLI, or a `cp` fallback with a one-line inconsistency warning.
5b. **LazyBackup instance:** SQLite snapshot (Bun, else WAL copy — logged) + age vault + SSH key rows → optional passphrase wrap (**required for non-local**) → land (not Bro; not instance age-key encrypt).
5c. **Git repository:** `git clone --mirror` on this host (vault SSH key for SSH URLs, `GIT_SSH_COMMAND` with `ConnectTimeout=10`, 15 min ceiling) → tar `mirror.git` → land `.tar.gz` (optional age / Bro).
6. Temp SSH identity + `-F /dev/null` (ignore host ssh config); host keys pinned in `ssh_known_hosts` (TOFU); ephemeral keys cleaned in `finally`.
7. Cleanup: version count and/or age-based file retention (local FS, remote SSH, S3, or Bro mailbox delete).
8. History + `combineBackupLog` (headers: path/scp, `Docker Volume Backup`, `Database Dump Backup`, `LazyBackup Instance Backup`). The run does **not** walk storage; totals come from the cached storage endpoints.
9. **Restore:** `POST /api/history/[id]/restore` → uses the run's `configSnapshot` → local artifact, S3/Bro download, or SSH-destination pull → path tree rsync/push **or** volume extract **or** database load **or** Git bare-mirror unpack (optional host retarget; backup and restore of one config are serialized). Download without restore: `GET /api/history/[id]/download`.

## Frontend

- Bun only; `"use client"` pages + hooks in `lib/hooks/`.
- Page chrome: `AppShell` owns `container` + padding; list/detail pages use `PageLayout` / `PageHeader`, detail/new/edit pages use `ResourceDetailLayout` / `ResourceEditLayout` (do not nest another `container py-*` layout).
- Navbar: Dashboard, **Connections** (`/connections?tab=servers|s3|git`; SSH keys stay in Settings), Backups, History, Status, Settings. `/servers`, `/s3-profiles`, and `/git-repos` list routes redirect to the matching tab.
- Query keys: `backupKeys`/`['backups']`, `['backup', id]`, `['servers']`, `['gitRepos']`, `['ssh-keys']`, `['history']`, `['history', id]`, `['historyStats']`, `['dashboard']`, `['dashboard','storage']`, `['status']`, `['settings']`, `authStatusKey`.
- UI: `QueryState`, `DataState`, `LoadingButton`, `DeleteConfirmationDialog`, sonner toasts, `cn()`.
- Mobile `Sheet` uses `modal={false}` (avoids stuck body `pointer-events`).
- Failure webhooks: Settings KV `failureWebhookUrl` / `Method` / `Headers` / `Body` with `{{tag}}` templates (`lib/notify/failure-webhook.ts`); URL/method validated on write.
- Success pings: Settings KV `successPingUrl` / `Method` / `Headers` / `Body` (default GET; Healthchecks-style); fire-and-forget once a run is actually delivered (`lib/notify/success-ping.ts`). Bro Space mailbox runs are staged first: no ping while `mailboxPending`, the verified ACK (or the success-write race reconciliation) fires it exactly once. Soft "friend offline / waiting" is not a failure and must not fire failure webhooks.
- Landing: `landing/` pages are static; `prebuild`/`predev` run `sync-changelog`, which also writes `src/lib/version.ts` (`LATEST_VERSION`) used by the hero — never hardcode a version.

## Env & commands

See README / `.env.example`. Important: `DATABASE_URL`, `PORT`, `BACKUP_STORAGE_PATH`, `SSH_KEYS_PATH`, `AUTH_SECRET`, `AUTH_COOKIE_SECURE`. Local path/SSRF/TOFU knobs: `ALLOW_ARBITRARY_LOCAL_PATHS`, `ALLOW_PRIVATE_S3_ENDPOINTS`, `LAZYBACKUP_KNOWN_HOSTS`, `ALLOW_PRIVATE_PEER_URLS`, `ALLOW_LAN_WEBHOOKS`, `AUTH_TRUST_PROXY`, `AUTH_PUBLIC_URL`, `ENABLE_HSTS`.

```bash
bun install && bun run dev
bun test --isolate       # matches CI; pre-push runs --randomize --isolate + build
bunx tsc --noEmit
bun run db:migrate       # migrate.ts is authoritative (never db:generate)
bun run build && bun run start
docker compose up -d
```

CI publishes GHCR on `v*` tags only (`:latest` + `:vX.Y.Z`; amd64 and arm64 native, then a manifest — not on `main`). Docs/`LICENSE`/`landing` are skipped via `paths-ignore`; LazyBro has its own `bro-test` job. Startup: migrate + cron + storage warm via instrumentation. Healthcheck: `GET /api/health`.

## Conventions

- Match surrounding style; small diffs; one solid approach.
- Prefer extending existing hooks over ad-hoc `fetch`.
- ESLint ignored during builds (`next.config.ts`).
- Tests: `bun test --isolate` matches CI. The pre-push hook runs
  `bun test --randomize --isolate` plus `bun run build`. Bun module mocks are
  process-wide, so never `mock.module('child_process')` or mock `@/lib/db` in a
  file other tests rely on — prefer the injected executor/parameter seams or a
  cache-busted import, and verify with `--randomize --isolate`.

## External communication

- When replying on GitHub (issue, PR, release notes) **on Ceneka's behalf**,
  start the body with this disclosure blockquote:

  ```markdown
  > 🤖 LLM responding on behalf of Ceneka
  ```

- Keep replies factual and short: what changed, how it was verified (release tag
  or `main`), and the upgrade command. Close an issue only after the fix is
  verified on a released image (or on `main` when the release was explicitly
  requested); otherwise say what is pending.

## Pitfalls

1. Password-only servers can test/connect and run some SSH helpers, but cannot move artifacts (path pulls/pushes and volume/database archive transfers need a key). `assertTransferServersHaveKeys` only pre-validates `sourceType=path`, so other configs can save and fail at run time.
2. Destinations may be **local, remote, S3 or peer**; uniqueness is per endpoint and local paths are normalized (`~`/cwd expanded). Nested overlaps are UI warnings only.
3. Do not run migrate/scheduler during `next build` (already guarded).
4. Cron is 5-field; invalid expressions are rejected when the config is saved (and still guarded at schedule time); respect the timezone setting.
5. `PUT /api/backups/:id` is a **merge**: an omitted key keeps the stored value, `null` clears/resets, a value sets. Blank `dbPassword`/`instanceBackupPassphrase` keep the stored secret; changing source type clears secrets and stale endpoint ids. MCP `update_backup` follows the same rules (GET redacts secrets, so a full round-trip must keep them).
6. Credentials are validated at write time: private keys must parse, password auth needs a password, ports are 1–65535, S3 bucket names/endpoints follow provider rules, referenced ids must exist (400, not a 500 FK).
7. **Docker volume auto-create:** `docker run -v/--mount` creates a missing volume. Packing inspects first and fails; restore intentionally calls `docker volume create`. A missing volume must never produce a "successful" empty archive.
8. Instance snapshots need a Bun binary (resolved from `BUN_BINARY`/PATH); without one the exporter copies `db + -wal + -shm` and says so in the log. Instance archives include only DB-stored key material.
9. Mixed IDs (`nanoid` vs `randomUUID`) — don’t assume one format.
10. App password ≠ SSH password; keep `/api/health` public. Unprotected instances cannot mint tokens or register passkeys.
11. Auth middleware must run on the Node.js runtime and check the session in-process — no self-fetch. It also enforces CSRF (session mutations), JSON content-type (415), `read_only`, and 405/`Allow`.
12. Docker volume sources need `docker` + `alpine` on the source (SSH server **or** this host’s socket). Restore for path/volume/database requires a **local** artifact or a download from **S3**, Bro, or an **SSH destination with key auth** (password-only dests cannot pull). History can restore onto a different host; targets `/`, `/dev`, `/proc`, the instance DB dir and the backup storage root are refused.
13. Server→server ephemeral transfer needs source→dest network reachability; otherwise relay is used.
14. Database dumps need the client tools on the source (`pg_dump`/`mysqldump`, or inside the DB container); SQLite never streams SQL — it writes a temp archive, with a `cp` fallback warning when `sqlite3` is absent.
15. S3 sources only support `sourceType=path` (object prefix). Use `@aws-sdk/client-s3` with custom endpoint + path-style for MinIO/R2/B2; loopback/private endpoints are refused unless `ALLOW_PRIVATE_S3_ENDPOINTS=true`.
16. Bearer tokens without `remote_exec` cannot set/change `preBackupCommands` or call `exec_command` / `POST …/servers/:id/exec`. Browser sessions always can. Bearer `read_only` tokens cannot mutate via MCP or REST; ad-hoc probe routes are denied (stored-endpoint `test`/`validate` allowed); `authorize_keys` is the only write they may perform.
17. Encrypted backups need an age key in the vault. Peer destinations always encrypt. Losing all private identities (instance + offline exports + recovery keys) means you cannot restore ciphertext. Creating a new key retires the old one; decrypt tries all vault identities.
18. Bro Space mailbox: LazyBro only needs the host LB reachable (outbound phone-home). Two full LBs each need a URL and both run the sync worker. `/api/peers/pair`, `/api/peers/store`, and `/api/peers/agent/*` are middleware-public (auth inside route). Offline/pending is soft status — do not fire failure webhooks or success pings while only staged (`deliveryState: waiting`); a persisted `deliveryError` means the delivery failed and belongs in History.
19. Peer limits: 32 GiB / 20 000 objects per peer, 4 MiB recall chunks, per-peer lock queue capped at 8 (`PEER_LOCK_QUEUE_MAX`, 429 when full). Uploads stream to disk; never buffer a chunk.
20. Git probes fail fast (`ls-remote` 20 s, SSH connect 10 s, clone 15 min). SSH remotes need a vault key; public HTTPS do not. Pre-backup commands and rsync `--delete` do not apply to Git sources.
21. Run logs are capped at 512 KiB (tail kept + marker); long rsync runs lose the beginning, so keep errors readable and chatty flags off.
22. `/api/seed` is dev-only, replaces demo data, and generates a real ed25519 demo key when `ssh-keygen` exists (placeholder otherwise). Licensed under MIT (`LICENSE`).
23. Tailscale is **not** bundled in the Docker image. Detect via LocalAPI socket or host CLI; optional `docker-compose.tailscale.yml` sidecar. Settings → Bro Space can fill `http://100.x:PORT`.
24. Auth locks when an app password **or** ≥1 passkey is configured. Passkey login is public; registration requires a locked session (auth enabled + session), like token minting.

## Read first

| Task | Files |
|------|-------|
| Backup / retention / storage | `lib/backup/{index,config-update,file-retention,storage-stats,log-format,destination,destination-guard,local-paths}.ts`, `lib/ssh/` (incl. `ephemeral.ts`) |
| From→To form UI | `components/backup-config-form.tsx`, `lib/backup/form-payload.ts`, `app/backups/new`, `app/backups/[id]/edit` |
| Connections | `app/connections`, `components/connections/*`; server/S3/Git detail still `app/servers`, `app/s3-profiles`, `app/git-repos` |
| Docker volumes / DB containers | `lib/docker/{volumes,containers}.ts`, `GET /api/docker/volumes` (local) + `GET …/servers/:id/docker/volumes`, same for containers/`db-hints`, `POST …/history/[id]/restore` |
| S3 profiles | `lib/s3/` (incl. `bucket.ts`, `endpoint.ts`), `/api/s3-profiles`, `app/connections` (S3 tab), `app/s3-profiles` |
| Git repositories | `lib/git/` (incl. `ssh-env.ts`), `/api/git-repos`, `app/connections` (Git tab), `app/git-repos` |
| Database dumps | `lib/database/`, `POST /api/backups/database/test`, restore via `POST …/history/[id]/restore` |
| Scheduling / timezone | `lib/scheduler/`, `instrumentation.ts` |
| DB | `lib/db/schema.ts`, `lib/db/migrate.ts` (indexes) |
| Encryption / vault / passkeys | `lib/crypto/` (age streaming), `lib/auth/webauthn.ts`, `/api/encryption`, `/api/auth/webauthn/*`, `components/encryption-settings-panel.tsx` |
| Auth / tokens / permissions | `lib/auth/{public-paths,permissions,csrf,request-content}.ts`, `middleware.ts`, `app/api/auth/`, `app/api/api-tokens/` |
| Safety status | `lib/status/build-status.ts`, `/api/status`, `app/status` |
| UI patterns | `lib/hooks/useBackups.ts`, `components/ui/query-state.tsx` |
