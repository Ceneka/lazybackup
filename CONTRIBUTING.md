# Contributing

Thanks for contributing to LazyBackup (MIT, self-hosted).

## Dev setup

```bash
bun install
cp .env.example .env   # adjust as needed
bun run db:migrate
bun run dev
```

Tests: `bun test`. Build: `bun run build`.
`bun install` wires a pre-push hook that runs `bun test --randomize` and `bun run build`.

See [README.md](./README.md) and [AGENTS.md](./AGENTS.md) for architecture notes.

## Pull requests

- Keep diffs focused; match existing Bun / Next.js / Drizzle / TanStack Query patterns.
- Prefer extending hooks in `src/lib/hooks/` over ad-hoc `fetch` in pages.
- Add or update tests when changing notify, retention, auth, or other pure helpers.
- Do not commit secrets (`.env`, keys, tokens).

## Issues

Use the Bug report or Feature request templates. Include version/image tag and redacted logs for bugs.

## Scope

LazyBackup is self-hosted. Features that assume a hosted SaaS control plane are out of scope unless they clearly help operators running their own instance.
