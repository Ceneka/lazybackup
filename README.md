# LazyBackup — VPS Backup Manager

**[lazy.zic.ar](https://lazy.zic.ar)** · **[GitHub](https://github.com/Ceneka/lazybackup)**

LazyBackup is a self-hosted web app for managing backups between endpoints: **this host (local)** or any configured **Server**. Connect over SSH, schedule jobs with cron, and transfer filesystem paths or Docker volumes with rsync/scp—including **server→server** (ephemeral direct or relay).

Marketing site (static): [`landing/`](./landing) → [lazy.zic.ar](https://lazy.zic.ar) · [Features](https://lazy.zic.ar/features)

## Features

- **From → To** — Endpoints: this host, SSH servers, or S3-compatible storage (MinIO, R2, B2, AWS, …)
- **Server → Server** — Ephemeral SSH key for direct rsync, or relay via the LazyBackup host when peers can’t reach each other
- **Server management** — Add, edit, and test VPS connections (password or SSH key auth)
- **Backup jobs** — Paths or Docker volumes, cron schedules, exclude patterns, and pre-backup shell commands
- **Docker volumes** — Discover named volumes on a source server, pack as `.tar.gz` to a destination path, restore from History (local artifact)
- **Versioned backups** — Optional timestamped snapshots with automatic count-based retention
- **File retention** — Optional age-based cleanup for dump-style destinations (keep a minimum number of files)
- **Automated scheduling** — In-process cron scheduler; set an app timezone so schedules run when you expect
- **History & dashboard** — Track runs, view logs, next run times, storage usage, and success rates
- **Optional app password** — Single-operator lock (set on first run or later in Settings); session cookie lasts 30 days
- **MCP / API tokens** — Let Cursor, Claude, or other agents manage backups via Streamable HTTP MCP at `/mcp` (Settings → API / MCP)

## Tech stack

- **Frontend:** Next.js 15, React 19, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API routes
- **Database:** SQLite (libSQL) with Drizzle ORM
- **Transfer:** rsync (preferred) with scp fallback
- **Runtime:** Bun

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.0+ (or Node.js 18+)
- SSH access to your VPS
- **SSH key authentication** for running backups (password auth works for connection tests only)
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
2. **Add a server** — Servers → add host, user, and SSH credentials. Use **Test connection** to verify rsync/scp (and Docker) availability.
3. **Create a backup** — Backups → pick **From** and **To** (local or server), then **filesystem path** or **Docker volume** (volume sources need a source server). Default dest is still `/backups/<server>/<name>` on this host when To is local. For volumes, LazyBackup lists remote named volumes and lands a `.tar.gz` at the destination path. Optionally enable versioning and/or age-based file retention.
4. **Timezone** — Settings → choose the timezone used for cron schedules and “next run” times.
5. **Run or schedule** — Trigger a manual run or rely on the cron schedule. View results, logs, and on-disk storage under History and each backup’s detail page.
6. **Restore (Docker volumes)** — On a successful volume backup in History, use **Restore Docker Volume** to push the archive back and extract into a named volume (creates the volume if missing). Restores data only — not images, networks, or compose files.

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

The token has full operator access (same gate as the UI). Prefer HTTPS or a trusted LAN. Revoke tokens anytime from the same Settings tab. Destructive MCP tools require `confirm: true`.

### Docker volume notes

- The SSH user needs permission to run `docker` (typically membership in the `docker` group).
- Packing uses a temporary `alpine` helper container; the remote host must be able to pull/run that image.
- Live database volumes can be inconsistent if written during backup — stop the service first via pre-backup commands (e.g. `docker compose stop db`) when you need a consistent snapshot.

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
bun run dev      # Start dev server
bun run lint     # ESLint
bun test         # Unit tests (Bun)
```

See [AGENTS.md](./AGENTS.md) for architecture details aimed at contributors and AI agents.

## License

MIT — see [LICENSE](./LICENSE). Anyone may use, modify, and redistribute LazyBackup.

## Acknowledgements

- [Next.js](https://nextjs.org/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
