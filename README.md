# LazyBackup — VPS Backup Manager

**[lazy.zic.ar](https://lazy.zic.ar)** · **[GitHub](https://github.com/Ceneka/lazybackup)**

LazyBackup is a self-hosted web app for managing backups of your VPS servers. Connect over SSH, schedule jobs with cron expressions, and pull data from remote paths to a local destination on the machine running LazyBackup (using rsync or scp).

## Features

- **Server management** — Add, edit, and test VPS connections (password or SSH key auth)
- **Backup jobs** — Configure remote source paths, local destinations, cron schedules, exclude patterns, and pre-backup shell commands
- **Versioned backups** — Optional timestamped snapshots with automatic retention
- **Automated scheduling** — In-process cron scheduler runs enabled jobs
- **History & dashboard** — Track runs, view logs, and monitor success rates

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
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000).

### Manual install

```bash
git clone https://github.com/Ceneka/lazybackup.git
cd lazybackup
bun install
bun run db:migrate
bun run dev        # development
# bun run build && bun run start   # production
```

Set `DATABASE_URL` if you want a custom SQLite path (default: `file:./data.db`).

## Usage

1. **Add a server** — Servers → add host, user, and SSH credentials. Use **Test connection** to verify rsync/scp availability.
2. **Create a backup** — Backups → pick a server, set the remote `sourcePath` and a **local** `destinationPath` (e.g. `/backups/mysite` in Docker, where `/backups` is your mounted volume).
3. **Run or schedule** — Trigger a manual run or rely on the cron schedule. View results under History.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./data.db` | SQLite database location |
| `PORT` | `3000` | HTTP port |
| `BACKUP_STORAGE_PATH` | `./backups` | Host directory for backup files |
| `SSH_KEYS_PATH` | `~/.ssh` | System SSH keys (Docker mount) |

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
