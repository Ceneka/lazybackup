# Changelog

All notable user-facing changes to LazyBackup are listed here.
GitHub Releases should track **`v*`** tags (for example `v0.2.0`) and can paste
the matching section below. This file is the source of truth for
[lazy.zic.ar/changelog](https://lazy.zic.ar/changelog) (landing build generates
`landing/src/lib/changelog.ts` via `bun run sync-changelog`).

The format is inspired by [Keep a Changelog](https://keepachangelog.com/).
Versions before a formal `v*` tag are dated unreleased / pre-release notes.

## [Unreleased]

### Fixed

- **Fast dashboard first load** — the local storage walk (backup file count and
  size under `BACKUP_STORAGE_PATH`) no longer blocks the dashboard response. It
  loads in its own card: totals are cached server-side for 5 minutes
  (stale-while-revalidate), warmed at startup, and refreshed after a backup
  finishes. Large backup trees no longer make the dashboard wait seconds on a
  cold first visit.

## [0.4.1] - 2026-11-27

### Fixed

- **v0.4.0 image build** — the Docker image was not published because two tests
  assumed a host environment (bash available, directory permissions enforced
  for non-root) and failed inside the Alpine build. They now use POSIX `sh` and
  skip the root-only permission probe. No application code changed in this
  release; v0.4.1 ships the same changes as v0.4.0.

## [0.4.0] - 2026-11-27

### Added

- **Bro Space rebuilt around friends** — an invite wizard detects a reachable
  LAN or Tailscale address (and warns about localhost), then gives you one
  message to paste with the invite and LazyBro download links. It moves to Done
  by itself when your friend accepts. Each friend has a card with online state,
  space used in both directions, waiting uploads and the last error, plus
  "Back up to", Rename and Remove.
- **Truthful friend delivery** — History and the dashboard say "Waiting for
  {friend}" until the friend's app confirms the copy. An offline friend no
  longer fails the run; it waits and catches up. A full quota or a corrupted
  copy shows a clear error instead of a silent success.
- **Large friend restores and downloads** — artifacts move in 4 MB pieces, so
  restores from 30 MB to 800 MB work in both directions and fit Cloudflare
  Tunnel's 100 MB upload limit. The restore dialog shows progress stages, an
  offline warning and a working cancel, and never polls forever.
- **Restore from the run's own settings** — target path, database, volume and
  host are prefilled from the run snapshot instead of today's config, with a
  clear acknowledgment when you retarget.
- **LazyBro redesigned** — one three-step setup card, a connected view and
  plain-language error states. It disconnects cleanly and refuses to change the
  folder while backups are stored in it.
- **Authorize SSH keys for linked clients** — new `authorize_keys` API token
  permission (works together with Read only) and
  `POST`/`DELETE /api/servers/:id/authorize-key`. A client such as
  [sshya](https://github.com/Ceneka/sshya) sends its own public key and
  LazyBackup adds it to the server's `~/.ssh/authorized_keys` with the stored
  credentials, so keys generated inside LazyBackup stay inside it. Each call is
  audited with the key fingerprint.
- **Friends on full LazyBackup** report online state, used space and errors the
  same way LazyBro does, so mixed pairs get the same friend card.

### Fixed

- **Docker volume restores** always failed; they now upload and extract the
  archive correctly.
- **Database restores** — a failed SQLite restore could wipe the live database;
  restores are now atomic and refuse unsafe targets. Postgres restores into an
  existing database no longer apply only half the dump, MariaDB restores work
  as a non-root user, and truncated or interrupted dumps fail instead of
  reporting success.
- **Restore reliability** — restoring from an SSH destination works without
  bash and with quotes in paths; archives are verified before extraction;
  members nested under a symlink are skipped; signal-killed remote commands
  fail the restore; and two restores of the same backup can no longer race.
- **Retention** — the backup just written is never deleted, failed runs don't
  count toward the version limit, version folders no longer collide, and
  age-based cleanup works on BusyBox servers.
- **Bro Space races** — a sync timing issue could delete a freshly landed
  backup while still reporting it delivered; the friend could copy an object
  before it was fully written; revoking a friend left backups "succeeding" into
  nowhere; and one frozen friend stopped syncing for everyone. Unpairing
  deletes only this instance's tracked objects.
- **Friend lifecycle** — backups and restores fail fast against a revoked
  friend, stale delete acknowledgements can't unlink a newer artifact, and the
  history of a removed friend is marked unrestorable instead of looking valid.
- **Pre-backup commands** — a command that exits non-zero now fails the run
  before anything is transferred, instead of producing a "successful" backup.
- **Instance data** — the SQLite database is snapshotted instead of copied
  under live writes, and restores refuse to overwrite the instance's own data.
- **S3 downloads** are written with `0600`, and skipped symlinks are reported
  in the backup log.
- **History stats** count a single-archive transfer as its files and size.
- **Runs and restores are serialized** — starting a backup while the same config
  is already running attaches to that run, and a backup and a restore of the
  same config can no longer overlap.
- **Encryption preflight** — encrypted or friend backups are refused up front
  when the vault has no active age key, instead of failing mid-run.
- **Server-to-server transfers** resolve `~` in remote paths and pin the
  destination host key.

### Security

- **Next.js 15.5.29** — cross-client response injection and disclosure in
  self-hosted apps that forward fetched responses, an SVG rejection bypass in
  image optimization, and HttpOnly cookie exposure on Edge runtime routes.
- **Command injection via paths** — an API token without `remote_exec` could run
  commands on a server by using a path that started with `-`; option-like paths
  are now rejected for ssh, scp and rsync.
- **Read-only tokens** could reach a friend's write token through the API and
  probe your network through test endpoints. Read-only now blocks ad-hoc
  probes, and peer bearer tokens are redacted from responses.
- **SSRF** — a storage address of `[::]` could reach this machine's own
  services; IPv6 unspecified and multicast addresses are rejected.
- **Auth bypass via asset paths** — a request path ending in `.png` skipped the
  login check.
- **CSRF and first-run takeover** — another website could set your first
  password or make changes using your session; cookie mutations now require
  JSON from the same site, and the public setup/password routes check content
  type.
- **Durable credentials** — creating API tokens or passkeys asks for your
  password (or a passkey) again once the instance is locked, and password
  checks are throttled.
- **Secrets at rest and in `ps`** — database passwords are no longer visible in
  the process list, and the SQLite database and its WAL files are `0600`.
- **Download retries** (`?retry=1`, a recall mutation) now require write access,
  so read-only tokens cannot trigger them.
- **Bro Space hardening** — mailbox objects are capped, request bodies are
  limited, outbound requests time out, staging files stay out of the object
  namespace, and invite secrets are compared in constant time.
- **Supply chain** — GitHub Actions are pinned to commit SHAs with
  least-privilege permissions, and LazyBro releases publish `SHA256SUMS`.

### Changed

- **Public Bro addresses must use `https://`**; plain `http://` still works for
  LAN and Tailscale addresses.
- **API changes from the browser must be JSON and same-site** (CSRF
  protection).
- **Creating API tokens or passkeys** asks for a fresh password or passkey once
  the instance is protected.
- **Read-only tokens** can no longer run test requests against arbitrary hosts;
  tests of stored endpoints by id still work.
- **Success pings for friend backups** fire when the friend confirms delivery,
  not when the backup is staged here.
- **Unprotected instances** warn prominently and cannot mint API tokens or
  register passkeys until an app password or passkey exists.
- **TrueNAS compose** now pins `HOSTNAME=0.0.0.0`, so the container healthcheck
  passes like the root compose file.
- **Docs** gained a deployment hardening checklist and notes on CSRF, step-up
  and read-only token scope.

## [0.3.0] - 2026-11-21

An app-wide UI/UX pass: every screen was audited and roughly 90 issues fixed.

### Added

- **Pause / Resume backups** — toggle a schedule from the backup detail page
  or the card menu without opening the edit form (validation results are
  kept).
- **Backup health at a glance** — backup cards show the last run (success,
  failed, running, never run), the next run or "Paused", and a warning when
  validation failed. The detail page shows a live "Running since…" banner
  with a link to the log, plus encryption and file-retention settings.
- **Dashboard answers "am I protected?"** — last successful backup, overdue
  schedules, a short "needs attention" list, an alert when every backup is
  disabled, and Bro runs still waiting for the peer are no longer shown as
  landed.
- **History filters that stick** — page, search, status and date live in the
  URL (Back returns to the same view), with Today / 7 days / 30 days chips, a
  day picker, Clear filters, and a linked Statistics page with a run chart.
- **Safer restores** — the restore dialog shows which run (date, size), the
  source → target endpoints, that files missing from the backup are not
  deleted, and asks for an extra confirmation when restoring to a different
  host or path. Results stay on the page.
- **Connection readiness** — password-only servers are flagged ("path backups
  need an SSH key") on cards, detail and test results; servers show which key
  they use; test results stay visible with a copyable error; secret fields
  get show/hide; the Git form can create an SSH key.
- **Create backup from an S3 profile** — prefills the S3 source.

### Fixed

- **Backup form** — path inputs no longer lose focus on every keystroke;
  invalid cron expressions block saving instead of silently never running;
  server validation errors appear next to the field; switching source type,
  server or destination no longer leaves stale paths, containers or forced
  encryption behind; destination suggestions use the real
  `BACKUP_STORAGE_PATH` and no longer overwrite recipe defaults; missing age
  key or instance passphrase is flagged before the first run; the database
  test works with a stored password.
- **Settings** — a new API token or Bro invite code is no longer lost when
  switching tabs; a failed settings load shows an error instead of blank
  fields that could overwrite your config; Copy works on plain-HTTP LAN
  setups; webhook presets fill the form and need an explicit Save; tabs are
  kept in the URL.
- **Error states** — History, SSH keys, passkeys and Bro peers show load
  errors with Retry instead of looking empty; a failed background refresh
  keeps the data on screen with a "Couldn't refresh" notice.
- **Downloads** — the History download no longer leaves a stuck "Loading…"
  overlay, streams large artifacts instead of buffering them in the browser,
  labels encrypted `.age` files, and stops waiting for Bro when you leave.
- **Times and rates** — dashboard, history day filters and chart buckets all
  use the app timezone; success rates count finished runs only and never
  round failures up to 100%.
- **Schedules** — labels for step expressions are correct ("Every 6 hours"
  instead of "Daily at */6:00").
- **Edit pages test what's on screen** — server, S3 and Git "Test connection"
  on edit pages use the current form values, not the saved ones.
- **"Shared destination"** — no longer flagged for backups on different Bro
  peers.
- **Usability and accessibility** — card menus open upward near the bottom of
  the screen and work with the keyboard; long dialogs scroll; readable status
  badges in light and dark mode; skip-to-content link; labelled controls and
  clearer delete / revoke confirmations that name what is affected.

### Changed

- **Settings → General** saves with an explicit Save button; API tokens ask
  for an access level (Read only / Read & write / shell) before creation and
  unrestricted tokens are labelled "Full access".
- **API (additive)** — `GET /api/backups` and `/api/backups/:id` include
  `latestRun`, `nextRun` and `scheduleLabel`; `GET /api/history` accepts
  `from`/`to` day keys; `POST /api/settings` accepts a batch
  `{ settings: { … } }`; server responses include the SSH key name.

## [0.2.8] - 2026-11-21

### Added

- **Authorize SSH keys for linked clients** — new `authorize_keys` API token
  permission (works together with Read only) and
  `POST`/`DELETE /api/servers/:id/authorize-key`. A client such as
  [sshya](https://github.com/Ceneka/sshya) sends its own public key and
  LazyBackup adds it to the server's `~/.ssh/authorized_keys` with the stored
  credentials, so keys generated inside LazyBackup stay inside it. Each call is
  audited with the key fingerprint.

### Security

- **SimpleWebAuthn 14** — passkey registration and login move to
  `@simplewebauthn/server` 14.1.0 / browser 14, which fix GHSA-2g3p-m8c9-hhwh
  and GHSA-j3h4-m3m2-7p7j.
- **Landing site** — Next.js 16.4.5 for lazy.zic.ar (static export, not
  shipped in the Docker image).

### Changed

- **Dependency refresh** — 34 minor/patch updates across the app (AWS SDK,
  libsql client, Radix UI, TanStack Query, React 19.3, Tailwind 4.3, cron,
  drizzle-kit, …) and LazyBro (nanoid 6, age-encryption 0.3.1).
- **Dependabot** — now tracks the Bun lockfiles for the app, LazyBro and the
  landing site, so dependency and security updates arrive as PRs again.

## [0.2.7] - 2026-11-10

### Added

- **Backups list search** — filter the list by name as you type, client-side.

### Fixed

- **Docker healthcheck** — containers sat at `unhealthy` forever: Next.js
  standalone listened on the container IP instead of `0.0.0.0`, so the probe
  against loopback found nothing. The image and `docker-compose.yml` now set
  `HOSTNAME=0.0.0.0`; the healthcheck goes healthy without a rebuild.

### Security

- **Next.js 15.5.28** — unauthenticated RCE in the Image Optimization API via
  SVG input, a Server Actions denial of service, and SSG/ISR cache poisoning on
  self-hosted instances.
- **MCP server SDK 2.4.0** — request body and JSON-RPC batch size limits,
  per-client message isolation, and bearer token audience validation on `/mcp`.
- **drizzle-orm 0.45.4** — SQL injection via improperly escaped identifiers;
  a `shell-quote` override closes the advisory reachable through its `gel`
  driver.
- **zod 4.6.7, nanoid 5.1.16** — memory exhaustion while validating oversized
  constrained collections, and generator loops on non-positive sizes.
- **Transitive** — sharp 0.35.5 (libvips/libheif/librsvg CVEs), ws 8.22.2,
  postcss 8.5.32, source-map-js 1.2.2.

### Changed

- **Bun 1.4.4** — image and CI run the same Bun again, with the Dockerfile pin
  kept in step by hand. The 1.4.2 musl `bun test` segfault is gone; verified on
  amd64 and arm64 Alpine.
- **LazyBro release** — `softprops/action-gh-release` v3 (Node 24 runtime).

## [0.2.6] - 2026-09-21

### Fixed

- **Mobile dashboard** — header stats (servers, S3, backups) wrap under the
  title instead of overflowing.
- **History on phones** — each run is a card with name, status, source, size,
  and time at a glance. Desktop still uses the table.
- **Menu navigation** — the sheet stays open with a spinner until the new page
  is ready, plus a progress bar so a slow load is not a blank wait.
- **SSH authorize box** — shorter copy; the install command stays selectable so
  it can be copied on HTTP/LAN when the clipboard button cannot.

### Changed

- **GHCR publish** — `:latest` and version tags publish only on `v*` releases
  (not every `main` push). amd64 and arm64 build natively in parallel, then
  CI stitches a multi-arch manifest (no QEMU).

## [0.2.5] - 2026-09-18

### Fixed

- **GHCR / Alpine image** — pin Bun 1.3.13 in the Docker image (same as CI).
  Floating `oven/bun:1-alpine` pulled 1.4.2, which segfaults `bun test` on musl.

## [0.2.4] - 2026-09-18

### Security

- **Next.js 15.5.24** — patch the 15.5.x unauthenticated RCEs (Windows-hosted
  servers and Image Optimization AVIF).

## [0.2.3] - 2026-09-09

### Added

- **Git repository sources** — clone a bare mirror on this host (`git clone
  --mirror`, vault SSH key for SSH remotes), tar it, then land like a volume
  archive. Restore unpacks the mirror. Connections has a Git tab.
- **Live History** — backup start and finish stream over SSE so History
  refreshes without a reload, and a toast reports the result.
- **rsync `--delete`** — opt-in on path backups so destination files that
  vanished at the source are dropped.

### Changed

- **Connections** — Servers, S3, and Git live under one navbar item instead of
  separate top-level links.

### Fixed

- **S3 Test connection** — restore the stored-profile helper so S3 detail and
  Connections overflow menus can probe a saved profile.

## [0.2.2] - 2026-09-05

### Added

- **Dashboard day filter** — hover a Backup status bar for that day’s counts and
  success rate; click to filter the card, then open History for that day.

### Fixed

- **Verbose failure text** — Recent Activity shows a short snippet instead of
  dumping the full error across the dashboard. The history detail still has the
  complete message, in a scrollable block.
- **Toasts covering Save** — connection-test toasts sit under the navbar
  (top-right) instead of on top of Add Server / Save.
- **Docker-exec DB host** — honor a custom database host so the client inside
  the container can reach a VPS-internal or docker-network database.

## [0.2.1] - 2026-09-04

### Added

- **Docker first-run** — Compose pulls `ghcr.io/ceneka/lazybackup:latest` without
  a required `.env` (copy-paste `docker compose up`).
- **README and landing storefront** — screenshots and badges on GitHub; Get
  started points at the Docker snippet; Open Graph card for sharing.
- **GitHub community files** — CODE_OF_CONDUCT, PR/issue templates, Dependabot,
  FUNDING, and package metadata so the repo looks installable.
- **Dashboard first hour** — backup recipes and honest empty stats so a new
  instance does not look like a perfect backup record.
- **404, PWA, and version** — branded 404/error pages, web app manifest, and a
  visible app version in Settings.
- **Next cron run** — the backup form shows when the schedule will fire next
  (app timezone).
- **Gotify and Slack** — failure-webhook and success-ping presets.
- **Config export** — Settings downloads a non-secret `lazybackup-config.json`
  (no passwords, SSH/S3 keys, token hashes, or age identities). Session-only;
  no import yet.
- **Update check** — Settings (and Status) compare the running version to the
  latest GitHub release, cached about 24 hours. Offline or rate-limited
  checks stay quiet.

### Changed

- **MCP `read_only` catalog** — mutating tools are omitted from `tools/list`
  (still denied at call time). `exec_command` is only advertised when
  `remote_exec` (or a browser session) is allowed.

### Fixed

- **Empty dashboard** — recipes no longer stack on an empty Backups card; next-run
  times use a stable locale to avoid hydration mismatches.
- **Restore on Alpine** — inspect archives without requiring GNU tar.
- **Landing restore copy** — docs match SSH destination pull and host retarget.

### Security

- Fresh authentication required for age vault changes.
- Safer restore archives (reject unsafe paths / contents).
- Browser security headers.
- Logout is caller-local; outbound connections are pinned after validation.
- LazyBro control/transfer boundaries tightened; peer object streaming uses
  bounded memory.

## [0.2.0] - 2026-08-13

### Added

- **Restore from History** — Path, volume, and database restore when the artifact
  is local, on S3, on Bro, or on an SSH destination with key auth (pulled onto this
  host first). History can restore onto a different host (server picker). Encrypted
  `.age` archives decrypt automatically. Password-only SSH destinations cannot pull
  for restore. Download the artifact without restoring in place
  (`GET /api/history/:id/download`).
- **Bro mailbox retention** — Version-count and age/min-keep cleanup use the same
  rules as S3. LazyBackup advertises `deletes[]`; LazyBro unlinks and acks. Open
  recalls are skipped until they finish. Restore/download while the peer still
  holds the blob returns HTTP 202 (waiting)—not a backup failure.
- **Local Docker socket** — Volume packs and docker-exec dumps from this host’s
  Docker, not only a remote SSH server.
- **SQLite dumps** — First-class database engine → `.sqlite.gz` (native file /
  sqlite3 `.backup` only).
- **Multi-arch GHCR** — `linux/amd64` and `linux/arm64`.
- **LazyBro binaries** — linux-x64, linux-arm64, darwin-arm64, darwin-x64,
  windows-x64 ([release tag `lazybro`](https://github.com/Ceneka/lazybackup/releases/tag/lazybro)).
- **MCP** — `validate_backup`, `get_status`, and opt-in `read_only` API tokens
  (mutually exclusive with `remote_exec`).
- **Status missed schedules** — warn when enabled crons are overdue. Success-ping
  presets for Discord, ntfy, and Telegram (plus Healthchecks-style GET).
- **Install catalogs** — Unraid Community Applications XML and TrueNAS SCALE
  compose under `deploy/`.
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
- **Age vault blog** — [keys, export, and recovery](https://lazy.zic.ar/blog/age-vault-recovery).

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
- Unify resource cards and S3 pages; show S3 and Bro endpoints on backup details.
- New Backup first-hour UX: VPS path/volume recipes, cron preset chips, and SSH
  key gate for path transfers.
- Self-host Inter so next dev does not fetch Google Fonts.

## Tagging practice

1. Optional: jot highlights under **Unreleased**. You do not have to list every
   commit — `bun run release -- X.Y.Z` promotes Unreleased and appends git
   subjects since the last `v*` tag (or since this file last changed).
2. Review the new `## [X.Y.Z] - YYYY-MM-DD` section, commit, tag `vX.Y.Z`, and
   `git push origin main --tags`. CI publishes `ghcr.io/ceneka/lazybackup:vX.Y.Z`
   and `:latest` on the version tag only (docs/`LICENSE`/`landing`-only paths are
   ignored) and opens a GitHub Release from that changelog section. Landing
   `/changelog` syncs on the next landing build.

[Unreleased]: https://github.com/Ceneka/lazybackup/compare/v0.4.1...HEAD
[0.2.0]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.0
[0.2.1]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.1
[0.2.2]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.2
[0.2.3]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.3
[0.2.4]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.4
[0.2.5]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.5
[0.2.6]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.6
[0.2.7]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.7
[0.2.8]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.8
[0.3.0]: https://github.com/Ceneka/lazybackup/releases/tag/v0.3.0
[0.4.0]: https://github.com/Ceneka/lazybackup/releases/tag/v0.4.0
[0.4.1]: https://github.com/Ceneka/lazybackup/releases/tag/v0.4.1
