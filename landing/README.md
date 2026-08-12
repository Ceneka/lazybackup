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

## Routes

- `/` — product landing
- `/features` — detailed feature walkthrough
- `/compare` — LazyBackup vs rsync/cron (and briefly Restic/Borg/Duplicati)
- `/changelog` — user-facing release notes (mirrors repo `CHANGELOG.md`)
- `/blog` — guides and product notes
- `/blog/introducing-lazybackup` — product presentation
- `/blog/easily-backup-docker-database` — Docker DB dump howto
- `/blog/failure-webhooks-discord-ntfy-kuma` — Discord / ntfy / Uptime Kuma webhooks
- `/blog/database-dumps-to-s3` — Postgres/MySQL dumps to MinIO/R2/B2/AWS
- `/blog/manage-backups-with-mcp` — MCP / API tokens for agents

Posts live in `src/lib/blog/posts.ts` (typed blocks; easy to extend). SEO: `src/app/sitemap.ts`, `src/app/robots.ts`, and `metadataBase` in `layout.tsx` (canonical + Open Graph / Twitter).

## Screenshots

PNGs in `public/screenshots/` feed the home gallery. Fresh Status / Encryption / MCP / Bro / S3 shots were captured from a local `bun` dev instance (`POST /api/seed` plus a disposable age key + MinIO profile). Prefer Playwright (wait for content) over Chrome `--screenshot` so React Query can settle; dismiss the first-run “Protect LazyBackup?” modal with Skip. No MCP screen-recording GIF yet—the home page uses an animated MCP demo strip linking to the MCP blog post.
