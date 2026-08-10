# LazyBackup — VPS Backup Manager

**[lazy.zic.ar](https://lazy.zic.ar)** · **[GitHub](https://github.com/Ceneka/lazybackup)**

LazyBackup is a self-hosted web app for managing backups of your VPS servers. Connect over SSH, schedule jobs with cron expressions, and pull data from remote paths to a local destination on the machine running LazyBackup (using rsync or scp).

## Features

- **Server management** — Add, edit, and test VPS connections (password or SSH key auth)
- **Backup jobs** — Configure remote source paths or Docker volumes, local destinations, cron schedules, exclude patterns, and pre-backup shell commands
- **Docker volumes** — Discover named volumes on the remote host, back them up as `.tar.gz`, and restore from History
- **Versioned backups** — Optional timestamped snapshots with automatic count-based retention
- **File retention** — Optional age-based cleanup for dump-style destinations (keep a minimum number of files)
- **Automated scheduling** — In-process cron scheduler; set an app timezone so schedules run when you expect
- **History & dashboard** — Track runs, view logs, next run times, on-disk storage usage, and success rates
- **Optional app password** — Single-operator lock (set on first run or later in Settings); session cookie lasts 30 days

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
3. **Create a backup** — Backups → pick a server, choose **filesystem path** or **Docker volume**. Destination defaults to `/backups/<server>/<name>` on the **LazyBackup host** (override allowed; paths must be unique). For volumes, LazyBackup lists remote named volumes and stores a `.tar.gz`. Optionally enable versioning and/or age-based file retention.
4. **Timezone** — Settings → choose the timezone used for cron schedules and “next run” times.
5. **Run or schedule** — Trigger a manual run or rely on the cron schedule. View results, logs, and on-disk storage under History and each backup’s detail page.
6. **Restore (Docker volumes)** — On a successful volume backup in History, use **Restore Docker Volume** to push the archive back and extract into a named volume (creates the volume if missing). Restores data only — not images, networks, or compose files.

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

## Acknowledgements

- [Next.js](https://nextjs.org/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
