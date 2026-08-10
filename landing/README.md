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
