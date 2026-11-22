---
name: release
description: Cut a LazyBackup release from what landed on main since the last v* tag — survey commits, verify, write CHANGELOG notes, bump versions, then (with approval) commit, tag and push, and confirm CI published the GHCR image and GitHub Release. Use when asked to "prepare a release", "cut vX.Y.Z", "ship what's on main", or after changes were pushed to main.
---

# Release LazyBackup

Releases are **`v*` git tags on `main`**. Pushing a tag is what ships: CI builds
`ghcr.io/ceneka/lazybackup:{vX.Y.Z,latest}` (amd64 + arm64 manifest), attaches
LazyBro binaries (`publish-lazybro.yml`), and the `github-release` job sets the
Release body from the matching `CHANGELOG.md` section
(`bun run scripts/cut-release.ts notes X.Y.Z`). Pushes to `main` alone publish
nothing.

`CHANGELOG.md` is the source of truth (also feeds lazy.zic.ar/changelog).
`scripts/cut-release.ts` promotes `[Unreleased]` → `[X.Y.Z] - date`, appends any
undocumented commit subjects under `### Changes`, fixes compare links, and bumps
`package.json`, `bro/package.json`, `landing/package.json`. It never commits,
tags or pushes.

## 1. Survey

```bash
git checkout main && git fetch origin --tags && git pull --ff-only   # a bare fetch --tags misses new main commits
git describe --tags --match 'v*' --abbrev=0          # last release
git log --oneline --no-merges $(git describe --tags --match 'v*' --abbrev=0)..HEAD
git diff --stat $(git describe --tags --match 'v*' --abbrev=0)..HEAD
gh run list --branch main --limit 3                    # main CI must be green
```

- Nothing but Release commits since the tag → stop; nothing to release.
- Read the actual diffs (not just subjects) for anything user-facing.
  For dependency bumps, read the commit bodies / Dependabot PRs for advisories
  (GHSA ids, CVEs) — those go under **Security**.
- Uncommitted or untracked files in the tree are never part of a release; leave
  them alone and don't `git add -A`.

**Version:** patch (`0.2.7 → 0.2.8`) for fixes, deps, security and small
additions (0.2.7 and 0.2.8 shipped `### Added` items as patches); minor for new
source/destination types, migrations, or behavior changes users must notice. Pre-1.0, never major. Recommend one and say why; if unsure, ask.

## 2. Verify locally (same as CI + pre-push hook)

```bash
bun install --frozen-lockfile
(cd bro && bun install --frozen-lockfile) && (cd landing && bun install --frozen-lockfile)
bunx tsc --noEmit
bun test --randomize
(cd bro && bun test)
DATABASE_URL=file:/tmp/lazybackup-release.db bun run build
(cd landing && bun run build)        # only if landing/ changed; prebuild syncs changelog
```

Any failure blocks the release — report it with output, don't paper over it.
Major-version dependency bumps (e.g. SimpleWebAuthn, Next, motion) deserve a
note on what was checked; flag anything only verifiable by hand (passkey login,
Docker image) to the user.

## 3. Write the notes under `## [Unreleased]`

House style (match previous sections):

- Groups in this order, only those that apply: `### Added`, `### Fixed`,
  `### Security`, `### Changed`.
- Each bullet: `- **Short label** — one or two sentences on the user-visible
  effect`, wrapped at ~80 cols. Say what changes for the operator, not how the
  code changed.
- Security: name the package + version and the advisory in plain words
  (RCE, DoS, cache poisoning…). Group small transitive bumps into one bullet.
- Pure internal churn (type renames, CI tweaks, dependabot config) belongs in
  one `### Changed` bullet at most, or nowhere.

Then dry-run and check what the script would append:

```bash
bun run release -- X.Y.Z --dry-run
```

If it adds a `### Changes` block of raw commit subjects that are already
covered (or are noise like `fix(types): …`), reword the Unreleased bullets so
they are matched, or accept and then delete the redundant lines after cutting.
The final section should read as curated notes, not a git log.

## 4. Cut

```bash
bun run release -- X.Y.Z
(cd landing && bun run sync-changelog)    # regenerates landing/src/lib/changelog.ts
bun run release -- notes X.Y.Z           # eyeball the exact Release body
git diff
```

Release commits touch exactly: `CHANGELOG.md`, `package.json`,
`bro/package.json`, `landing/package.json`, `landing/src/lib/changelog.ts`.

**Stop here and show the user the notes + diff.** Committing, tagging and
pushing are outward-facing — get explicit approval first (unless the user
already said to ship it this turn).

## 5. Ship (after approval)

Others merge PRs to `main` while you work. Re-fetch right before shipping; if
`origin/main` moved, reset onto it and redo step 4 (the new PR may have written
its own Unreleased notes — merge yours under them), re-run the checks, then
ship. Push `main` **first** and tag only after it succeeds, in one chain:

```bash
git add CHANGELOG.md package.json bro/package.json landing/package.json landing/src/lib/changelog.ts
git commit -m "Release vX.Y.Z"           # plus the session's attribution trailer
git fetch origin && test -z "$(git log HEAD..origin/main --oneline)" \
  && git push origin main \
  && git tag vX.Y.Z && git push origin vX.Y.Z
```

Push the branch and tag explicitly (not `--tags`, which would push any stray
local tags). A tag pushed for a commit that is not on `main` starts publishing
right away: cancel its runs (`gh run cancel`) and delete it
(`git push origin :refs/tags/vX.Y.Z`) before any image or Release exists.
Once a release is published, never move or re-push its tag; fix forward with
the next patch.

## 6. Confirm it landed

```bash
gh run list --limit 5                              # CI + Publish LazyBro on the tag
gh run watch <run-id> --exit-status                # or check back later
gh release view vX.Y.Z                             # title "LazyBackup vX.Y.Z", notes, 5 lazybro binaries
docker manifest inspect ghcr.io/ceneka/lazybackup:vX.Y.Z   # amd64 + arm64
```

Report: tag, Release URL, image tags, and any failed job with its log excerpt.
If `github-release` failed but images pushed, re-running that job is safe
(it edits an existing Release).

## 7. Landing follow-up

If the release has `### Added` items or visible UI/behavior changes, offer to
run the `landing-update` skill (screenshots, home/features copy, release blog
post) once the tag is out.
