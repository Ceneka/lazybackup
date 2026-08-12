# LazyBackup — VPS Backup Manager

[![CI](https://github.com/Ceneka/lazybackup/actions/workflows/ci.yml/badge.svg)](https://github.com/Ceneka/lazybackup/actions/workflows/ci.yml) · **[lazy.zic.ar](https://lazy.zic.ar)** · **[GitHub](https://github.com/Ceneka/lazybackup)**

LazyBackup is a self-hosted web app for managing backups between endpoints: **this host (local)**, any configured **Server**, or **S3-compatible** storage. Connect over SSH, schedule jobs with cron, and transfer filesystem paths, Docker volumes, or logical database dumps—including **server→server** (ephemeral direct or relay) and landings on S3.

Marketing site (static): [`landing/`](./landing) → [lazy.zic.ar](https://lazy.zic.ar) · [Features](https://lazy.zic.ar/features)

## Features

- **From → To** — Endpoints: this host, SSH servers, or S3-compatible storage (MinIO, R2, B2, AWS, …)
- **Server → Server** — Ephemeral SSH key for direct rsync, or relay via the LazyBackup host when peers can’t reach each other
- **Server management** — Add, edit, and test VPS connections (password or SSH key auth)
- **Backup jobs** — Paths, Docker volumes, or database dumps; cron schedules; exclude patterns; pre-backup shell commands
- **Docker volumes** — Discover named volumes on a source server, pack as `.tar.gz` to a destination path/prefix, restore from History
- **Database dumps** — Postgres / MySQL / MariaDB → `.sql.gz` (native client or `docker exec`); restore from History
- **S3 profiles** — Source prefixes and destination prefixes for path trees and archives
- **Versioned backups** — Optional timestamped snapshots with automatic count-based retention
- **File retention** — Optional age-based cleanup for dump-style destinations (keep a minimum number of files)
- **Automated scheduling** — In-process cron scheduler; set an app timezone so schedules run when you expect
- **History & dashboard** — Track runs, view logs, next run times, storage usage, and success rates
- **Validate before run** — Probe SSH/S3/paths/DB without transferring (backup detail → Validate); last result is stored with a timestamp so you can see status without re-running
- **Failure webhooks** — Customizable HTTPS webhook on backup failure (method, headers, `{{tag}}` body/URL templates; Discord / Telegram / Kuma / ntfy / Slack presets)
- **Optional app password** — Single-operator lock (set on first run or later in Settings); session cookie lasts 30 days
- **MCP / API tokens** — Let Cursor, Claude, or other agents manage backups via Streamable HTTP MCP at `/mcp` (Settings → API / MCP)
- **Encryption** — Optional age encryption before storing (Settings → Encryption); works with local, server, and S3 destinations
- **Bro Space** — 1:1 encrypted peer storage with a friend (Settings → Bro Space); invite code pairing, hard quotas

## Tech stack

- **Frontend:** Next.js 15, React 19, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API routes
- **Database:** SQLite (libSQL) with Drizzle ORM
- **Transfer:** rsync (preferred) with scp fallback; S3 via AWS SDK
- **Runtime:** Bun

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.0+ (or Node.js 18+)
- SSH access to your VPS
- **SSH key authentication** on each server endpoint used in a backup transfer (rsync/scp run from the LazyBackup host and need a key). Password auth still works for **Test connection** and other `node-ssh` operations (list volumes/containers, etc.)
- `rsync` and `openssh-client` on the host running LazyBackup

### Docker (recommended)

```bash
docker run -d \
  --name lazybackup \
  -p 3000:3000 \
  -v lazybackup_data:/app/data \
  -v ./backups:/backups \
  -v ~/.ssh:/root/.ssh:ro \
  -e DATABASE_URL=file:/app/data/data.db \
  ghcr.io/ceneka/lazybackup:latest
```

Or with Docker Compose (reads `.env`, persists the database volume):

```bash
cp .env.example .env   # optional; adjust paths/port
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) (or `http://<lan-ip>:3000` on your network).

> **HTTP vs HTTPS:** On plain HTTP (typical LAN), leave `AUTH_COOKIE_SECURE` unset so the app password session cookie works. Set `AUTH_COOKIE_SECURE=true` only when the UI is served over HTTPS.

### Manual install

```bash
git clone https://github.com/Ceneka/lazybackup.git
cd lazybackup
cp .env.example .env   # optional
bun install
bun run db:migrate
bun run dev        # development
# bun run build && bun run start   # production
```

Set `DATABASE_URL` if you want a custom SQLite path (default: `file:./data.db`).

## Usage

1. **Optional password** — On first visit, set an app password or skip. Change or remove it later under Settings.
2. **Add a server** — Servers → add host, user, and SSH credentials. Use **Test connection** to verify rsync/scp (and Docker) availability. Prefer an SSH key for any server you will back up from or to.
3. **(Optional) S3 profile** — S3 Profiles → endpoint, bucket, and keys (path-style for MinIO/R2/B2 as needed).
4. **Create a backup** — Backups → pick **From** and **To** (local, server, or S3), then **filesystem path**, **Docker volume** (volume sources need a source server), or **database**. Default dest is still `/backups/<server>/<name>` on this host when To is local. Optionally enable versioning and/or age-based file retention.
5. **Timezone** — Settings → choose the timezone used for cron schedules and “next run” times.
6. **Encryption (optional)** — Settings → Encryption → generate an age key, then enable “Encrypt before storing” on a backup (or use a Bro destination).
7. **Bro Space (optional)** — Settings → Bro Space → set your instance URL, invite a bro with a shared GB quota, or paste their invite code.
6. **Run or schedule** — Trigger a manual run or rely on the cron schedule. View results, logs, and storage under History and each backup’s detail page.
7. **Restore** — On a successful volume or database backup in History, restore into a named volume or pipe into `psql`/`mysql`. Artifacts on S3 are downloaded first; path-tree restores are not a one-click UI action.

### MCP (agent access)

Connect Cursor, Claude, VS Code, or other MCP clients to this instance:

1. Enable an **app password** (recommended) under Settings.
2. Open **Settings → API / MCP**, create a token, and copy it immediately (shown once).
3. Use **Add to Cursor** / **Add to VS Code**, or copy `mcp.json` / Claude config / Claude Code CLI.

Example `mcp.json` (replace host and token):

```json
{
  "mcpServers": {
    "lazybackup": {
      "url": "https://your-host/mcp",
      "headers": {
        "Authorization": "Bearer lb_…"
      }
    }
  }
}
```

Tokens can manage backups and servers. **Remote shell** (`exec_command` / `POST /api/servers/:id/exec`) and **setting or changing pre-backup commands** require the opt-in **Allow remote command execution** permission when creating the token (browser sessions always have it). Prefer HTTPS or a trusted LAN. Revoke tokens anytime from the same Settings tab. Destructive MCP tools (`delete_*`, `restore_history`, `exec_command`) require `confirm: true`.

### Failure notifications

Under **Settings → General**, configure a failure webhook:

- **Method** — `GET`, `POST`, or `PUT`
- **URL / headers / body** — support `{{tags}}` (`{{event}}`, `{{backupName}}`, `{{configId}}`, `{{historyId}}`, `{{errorMessage}}`, `{{endedAt}}`)
- **Presets** — Default JSON, Discord, Telegram, Uptime Kuma (push), ntfy, Slack

Empty body (POST/PUT) sends the built-in JSON:

```json
{
  "event": "backup.failed",
  "backupName": "Daily DB",
  "configId": "…",
  "historyId": "…",
  "errorMessage": "…",
  "endedAt": "2026-08-10T12:00:00.000Z"
}
```

HTTPS is required (`http://` only for localhost/LAN). Empty URL disables notifications. Use **Send test notification** to verify.

### Secrets in the API

`GET` responses for servers, S3 profiles, and backups **never include** passwords, SSH private keys, S3 secret keys, or DB passwords. Flags such as `hasPassword` / `hasPrivateKey` / `hasSecretAccessKey` / `hasDbPassword` tell the UI a secret is stored. On edit, leave those fields blank to keep the existing value.

### Docker volume notes

- The SSH user needs permission to run `docker` (typically membership in the `docker` group).
- Packing uses a temporary `alpine` helper container; the remote host must be able to pull/run that image.
- Live database volumes can be inconsistent if written during backup — prefer the **database** source type for logical dumps, or stop the service first via pre-backup commands when you need a consistent filesystem snapshot.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./data.db` | SQLite database location (`file:/app/data/data.db` in Docker) |
| `PORT` | `3000` | HTTP port |
| `BACKUP_STORAGE_PATH` | `./backups` | Host directory for backup files (Compose mounts this at `/backups` and `/app/backups`) |
| `SSH_KEYS_PATH` | `~/.ssh` | System SSH keys (Docker mount, read-only) |
| `AUTH_SECRET` | (auto in settings) | HMAC secret for session cookies; auto-generated in SQLite if unset |
| `AUTH_COOKIE_SECURE` | unset (`false`) | Set `true` only behind HTTPS; Secure cookies are dropped on plain HTTP |

See [`.env.example`](./.env.example) for a copy-paste template.

## Development

```bash
bun run dev         # Start dev server
bun run lint        # ESLint
bun test            # Unit tests on the host
bun run test:docker # Alpine unit tests + production image smoke (musl / GHCR parity)
```

`test:docker` builds the Alpine image, runs `bun test` inside it, then starts the production image and hits `/api/health` (migrations + `@libsql` natives). Use this when changing Docker/native deps so host `bun run dev` success doesn’t hide Alpine failures.

See [AGENTS.md](./AGENTS.md) for architecture details aimed at contributors and AI agents.

## License

MIT — see [LICENSE](./LICENSE). Anyone may use, modify, and redistribute LazyBackup.

## Acknowledgements

- [Next.js](https://nextjs.org/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
