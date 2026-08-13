# Changelog

All notable user-facing changes to LazyBackup are listed here.
GitHub Releases should track **`v*`** tags (for example `v0.2.0`) and can paste
the matching section below. This file is the source of truth for
[lazy.zic.ar/changelog](https://lazy.zic.ar/changelog) (landing build generates
`landing/src/lib/changelog.ts` via `bun run sync-changelog`).

The format is inspired by [Keep a Changelog](https://keepachangelog.com/).
Versions before a formal `v*` tag are dated unreleased / pre-release notes.

## [Unreleased]

### Added

- **Path-tree one-click restore** — History → Restore for `sourceType=path` when the
  artifact is on this host, S3, or Bro; rsync/push back to the local/SSH/S3 source
  (optional retarget). Encrypted `.tar.gz.age` path archives are decrypted and
  extracted first. Remote SSH destinations remain out of scope for one-click restore.
- **Landing changelog sync** — `/changelog` is generated from this file at
  landing build time (`landing/scripts/sync-changelog.ts`); no hand mirror.
- **Landing compare page** (`/compare`) — LazyBackup vs rsync/cron, with short
  notes on Restic, Borg, and Duplicati. Positions LazyBackup as a From→To
  control plane (SSH, Docker volumes, DB dumps, MCP), not a dedup archive CLI.
- **Landing changelog** (`/changelog`) — user-facing release notes on the static
  site.
- **MCP demo callout** on the marketing home page — links to the
  [manage backups with MCP](https://lazy.zic.ar/blog/manage-backups-with-mcp)
  guide.
- **Screenshot gallery** entries for Status, Encryption (age vault), API/MCP
  settings, S3 profiles, and Bro Space (capture when a seeded UI is available).

### Reliability (recent main)

These landed on `main` ahead of a formal tagged release:

- **CI** — tests and build before GHCR publish; Alpine/musl regressions caught
  in the image pipeline.
- **Concurrent-run lock** — the same backup config cannot overlap itself.
- **Failure webhooks** — notify on failed runs; method, headers, and `{{tag}}`
  body templates (Settings).
- **Backup validate** — probes without transferring data; last validation
  results persist on the config.
- **Secret redaction** — server, S3, and backup API responses strip secrets
  before JSON leaves the process.

### Product surface (context for evaluators)

Also on recent `main` (see README / Features for detail): age encryption vault,
Bro Space peer destinations, instance meta-backup, WebAuthn passkeys, Status
posture page, S3-compatible endpoints, database dumps, MCP + API tokens with
optional `remote_exec`.

## Tagging practice

1. Optional: jot highlights under **Unreleased**. You do not have to list every
   commit — `bun run release -- X.Y.Z` promotes Unreleased and appends git
   subjects since the last `v*` tag (or since this file last changed).
2. Review the new `## [X.Y.Z] - YYYY-MM-DD` section, commit, tag `vX.Y.Z`, and
   `git push origin main --tags`. CI publishes `ghcr.io/ceneka/lazybackup:vX.Y.Z`
   (docs/`LICENSE`/`landing`-only paths are ignored) and opens a GitHub Release
   from that changelog section. Landing `/changelog` syncs on the next landing
   build.

[Unreleased]: https://github.com/Ceneka/lazybackup/compare/main...HEAD
