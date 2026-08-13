# Changelog

All notable user-facing changes to LazyBackup are listed here.
GitHub Releases should track **`v*`** tags (for example `v0.2.0`) and can paste
the matching section below. This file is the source of truth for
[lazy.zic.ar/changelog](https://lazy.zic.ar/changelog) (landing build generates
`landing/src/lib/changelog.ts` via `bun run sync-changelog`).

The format is inspired by [Keep a Changelog](https://keepachangelog.com/).
Versions before a formal `v*` tag are dated unreleased / pre-release notes.

## [Unreleased]

## [0.2.0] - 2026-08-13

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

### Changes

- Cut GitHub Releases from CHANGELOG on v* tags, and simplify the landing page.
- Restore from SSH destinations and onto a new host.
- Have LazyBro unlink retained objects from mailbox /work.
- Apply backup retention to Bro mailbox destinations.
- Self-host Inter so next dev does not fetch Google Fonts.
- Unify resource cards and S3 pages with shared detail layout and overflow actions.
- Show S3 and Bro endpoints on backup details, and wait for Run now to finish.
- Fix the backup form in the browser: wrap sibling SQLite fields so JSX parses, and split transfer-key helpers so the client never loads libsql.
- Return 202 when Bro still has the artifact instead of blocking restore.
- Ship LazyBro on more platforms and keep it running at login.
- Add read_only API tokens plus MCP validate_backup and get_status.
- Add native SQLite dumps as a first-class database engine.
- Allow Docker volume backups from this host’s socket.
- Let operators download a history artifact without restoring it.
- Add Unraid, TrueNAS, and awesome-selfhosted install catalog copy.
- Publish the GHCR image for linux/amd64 and linux/arm64.
- Document age vault setup, export, and recovery on the landing blog.
- Surface missed schedules on Status and add Discord/ntfy/Telegram success-ping presets.
- Make the first backup the default job: VPS path recipes, cron chips, and SSH key gate.
- fix: unblock Next typecheck on vault step-up and related unions.
- fix: keep Next typecheck off LazyBro and bump checkout to v5.
- fix: keep passkey unit tests off the SimpleWebAuthn module graph.
- fix: stop auth unit tests from loading the Next.js auth barrel.

## Tagging practice

1. Optional: jot highlights under **Unreleased**. You do not have to list every
   commit — `bun run release -- X.Y.Z` promotes Unreleased and appends git
   subjects since the last `v*` tag (or since this file last changed).
2. Review the new `## [X.Y.Z] - YYYY-MM-DD` section, commit, tag `vX.Y.Z`, and
   `git push origin main --tags`. CI publishes `ghcr.io/ceneka/lazybackup:vX.Y.Z`
   (docs/`LICENSE`/`landing`-only paths are ignored) and opens a GitHub Release
   from that changelog section. Landing `/changelog` syncs on the next landing
   build.

[Unreleased]: https://github.com/Ceneka/lazybackup/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.0
