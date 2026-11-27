# LazyBackup landing

Marketing site for [LazyBackup](https://github.com/Ceneka/lazybackup) — static Next.js export served at [lazy.zic.ar](https://lazy.zic.ar).

## Develop

```bash
cd landing
bun install
bun run dev
```

## Build (Cloudflare Pages)

Keep the Pages build the same as the old standalone repo; only set the project root to this folder:

| Setting | Value |
|---------|--------|
| **Root directory** | `landing` |
| **Build command** | `bun install && bun run build` |
| **Output directory** | `out` |

(`npm ci && npm run build` also works if you prefer npm.)

The app uses `output: "export"` so the build produces a static `out/` directory.

## Changelog

Repo-root [`CHANGELOG.md`](../CHANGELOG.md) is the single source of truth.
`prebuild` runs `bun run sync-changelog`, which parses Keep a Changelog sections
into `src/lib/changelog.ts` for `/changelog`. Regenerate anytime with:

```bash
bun run sync-changelog
```

(Requires the monorepo checkout so `../CHANGELOG.md` exists — Cloudflare Pages
Root directory = `landing` still has the parent repo on disk.)

## Routes

- `/` — product landing
- `/features` — detailed feature walkthrough
- `/compare` — LazyBackup vs rsync/cron (and briefly Restic/Borg/Duplicati)
- `/changelog` — user-facing release notes (from repo `CHANGELOG.md`)
- `/blog` — guides and product notes
- `/blog/lazybackup-0-3-0-ui-ux` — v0.3.0 UI/UX release (health, restores, settings)
- `/blog/introducing-lazybackup` — product presentation
- `/blog/age-vault-recovery` — age vault export, recovery recipients, disaster restore
- `/blog/easily-backup-docker-database` — Docker DB dump howto
- `/blog/failure-webhooks-discord-ntfy-kuma` — Discord / ntfy / Uptime Kuma webhooks
- `/blog/database-dumps-to-s3` — Postgres/MySQL dumps to MinIO/R2/B2/AWS
- `/blog/bro-space-pairing-lazybro` — Bro Space invite + LazyBro / mailbox walkthrough
- `/blog/manage-backups-with-mcp` — MCP / API tokens for agents

Posts live in `src/lib/blog/posts.ts` (typed blocks; easy to extend). SEO: `src/app/sitemap.ts`, `src/app/robots.ts`, and `metadataBase` in `layout.tsx` (canonical + Open Graph / Twitter).

## Screenshots

`public/screenshots/*.png` feed the home gallery and blog posts. They come from
fake demo data in [`src/lib/db/seed-demo.ts`](../src/lib/db/seed-demo.ts) and a
**disposable** dev database — never point this at your real instance. The shot
list (file, path, theme, viewport, waits, UI actions) lives in
[`scripts/screenshots.config.ts`](./scripts/screenshots.config.ts); the runner is
[`scripts/capture-screenshots.ts`](./scripts/capture-screenshots.ts).

The runner locks the fresh instance with a demo app password (`SHOTS_PASSWORD`,
default `lazybackup-demo-screenshots`) and logs in, so Status shows a protected
install; seeds via `POST /api/seed`; replaces the scratch storage path with
`/backups` in the rendered text (`DISPLAY_STORAGE_ROOT`, screenshot-only);
switches light/dark through the theme
storage key, mocks the probes that would otherwise hit fake hosts (Docker
containers, SSH test, DB test), and waits for real content. It writes light
1440×900 PNGs (Database form shots are 984×974).

Start a throwaway dev instance from the repo root:

```bash
S=$(mktemp -d)   # fresh every run; never reuse your real data.db
mkdir -p $S/backups $S/keys
DATABASE_URL=file:$S/shots.db BACKUP_STORAGE_PATH=$S/backups \
SSH_KEYS_PATH=$S/keys PORT=3917 bun run dev -- --port 3917
```

Then capture from `landing/` (Playwright comes from `bunx`, no dependency added):

```bash
cd landing
BASE_URL=http://localhost:3917 bunx --package playwright -- \
  sh -c 'NODE_PATH="$(dirname "$(dirname "$(command -v playwright)")")" bun scripts/capture-screenshots.ts'
```

The `NODE_PATH` line lets the script import Playwright from the `bunx` cache.
Override `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome` if the cached Chromium
build is missing. `SHOTS=dashboard,history` captures only those files while
iterating. Stop the dev server when done; the disposable DB and storage path keep
`data.db` and the repo `backups/` untouched. The seed only writes demo placeholder
files when `BACKUP_STORAGE_PATH` is set, and cleans only its own marked fixture
directories on re-runs.

