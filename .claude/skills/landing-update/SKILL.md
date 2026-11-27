---
name: landing-update
description: Refresh the LazyBackup landing site (lazy.zic.ar, `landing/`) after user-facing changes — fresh screenshots from seeded fake data, home/features copy, a "what's new" blog post, and fixes to content the change made outdated — by orchestrating a parallel fleet of subagents. Use after a release or merge with notable Added/Changed items, when the UI changed visibly, or when asked to "update the landing", "refresh screenshots", "write the release blog post", or "market this feature".
---

# Update the landing for a change that matters

The landing (`landing/`, static Next.js export → Cloudflare Pages, root
`landing`, output `out`) must not drift from the app. Do this whenever a change
is visible to operators: new source/destination/feature, a UI redesign, changed
behavior or wording, or any release whose `CHANGELOG.md` section has `### Added`
or user-visible `### Changed` items. Pure deps/CI/internal releases → skip (the
changelog page already syncs on build).

Pieces that already exist — reuse them, don't rebuild:

| Piece | Where |
|---|---|
| Fake demo data (dev-only, replaces app data) | `src/lib/db/seed-demo.ts` via `POST /api/seed` (403 in production) |
| Shot list as data | `landing/scripts/screenshots.config.ts` |
| Playwright capture (locks the instance with a demo password + logs in, seeds, masks the scratch storage path as `/backups`, themes, per-shot actions, mocks fake-host probes) | `landing/scripts/capture-screenshots.ts` — exact commands in `landing/README.md` → "Screenshots" (`mktemp -d` dev instance on port 3917, then `bunx --package playwright …`; `SHOTS=a,b` for a subset) |
| Screenshots | `landing/public/screenshots/*.png` (1440×900 light unless noted) |
| Home page sections | `landing/src/app/page.tsx` (hero copy, "works with", deploy), `components/landing/flow-hero.tsx` (From → To diagram + example routes), `dashboard-showcase.tsx` (dashboard.png + numbered pins as % of the image — re-place them when the shot changes), `cron-vs-lazy.tsx`, `feature-bento.tsx` (feature cards with small product visuals + "Also included"), `screenshots-gallery.tsx` |
| Features page | `landing/src/app/features/page.tsx`, `components/landing/features-data.tsx` (`detailedFeatures`) |
| Blog | `landing/src/lib/blog/posts.ts` (typed blocks; drives index + sitemap) |
| Compare | `landing/src/app/compare/page.tsx` |
| Changelog page | generated from repo `CHANGELOG.md` by `bun run sync-changelog` (prebuild) |

## 1. Scope it (you, not a subagent)

- Read the relevant `CHANGELOG.md` section (or `[Unreleased]`) and the actual
  diffs/commit bodies for the change. List 3–7 marketing themes in operator
  terms, plus behavior changes users must know when upgrading.
- Decide which screens changed → which shots to retake or add. Update
  `landing/scripts/screenshots.config.ts` yourself if a new screen/state is
  needed (or assign it to the screenshots agent). Keep existing filenames when
  the screen is the same; add new files for new screens.
- Write a shared brief in the scratchpad (`<scratchpad>/landing/BRIEF.md`):
  themes, the shot table (file → page/state), "don't invent features — check
  `src/`", hard rules (below), and each agent's file ownership.

## 2. Run the fleet (parallel, disjoint file ownership)

Default model: whatever the user asked for; if none, the fleet used before —
`delegate_task` with `providerInstanceId: "opencode"`,
`model: "opencode-go/deepseek-v4.1-flash"`, `options: {variant: "max"}` (check
`orchestrator_capabilities` first; if unavailable say so, don't silently
switch). Each brief starts with "Read <BRIEF.md> first and follow its rules."

| Agent | Owns | Job |
|---|---|---|
| **Screenshots + fake data** | `src/lib/db/seed-demo.ts`, `landing/scripts/*screenshots*`, `landing/public/screenshots/`, README "Screenshots" | Extend the seed so the new screens look rich; run the app in **dev** on a disposable DB + port 3917; capture; open every PNG and iterate until nothing is empty/loading/errored; stop the server |
| **Home + features** | `landing/src/app/page.tsx`, `features/page.tsx`, `features-data.tsx`, `screenshots-gallery.tsx`, `layout.tsx` metadata, header/footer | Weave the themes into existing copy, add/refresh a compact "What's new" strip for big releases, gallery entries + alt text matching the new UI, fix now-outdated claims |
| **Blog + compare** | `landing/src/lib/blog/posts.ts`, `blog-blocks.tsx`, `landing/src/app/blog/**`, `compare/page.tsx`, README "Routes" | New post (slug agreed in the brief so Home can link it) for releases/features worth a story; audit old posts + compare for statements the change made wrong |

Add more agents only for genuinely separate work (e.g. a new docs-style page),
never two agents on the same file. Small releases: one agent (copy + shots) is
enough.

**Hard rules for every agent:** edit only owned files; no git
commit/checkout/stash/reset/push; no new dependencies (Playwright via
`bunx playwright`, browsers are cached); fake data only — documentation IPs
(`203.0.113.x`, `198.51.100.x`), `*.example.com`, generic names, freshly
generated throwaway keys, never the user's real hosts, emails or `data.db`;
seed must not touch auth password settings; finish with
`cd landing && bun run build` and report anything blocked on another agent's
file instead of editing it. Copy voice: concise, operator-focused, real UI
labels, no hype words.

## 3. Verify (you)

- Look at every new/changed PNG yourself (Read the image). Reject: spinners,
  empty states where data was intended, error toasts, the first-run auth
  prompt, real-looking personal data, stale old UI, scratch paths
  (`/tmp/...`, home dirs) instead of `/backups`, a red "Critical" badge on hero
  shots (means the instance wasn't locked), and cards clipped under the sticky
  Settings tab bar (frame from the top or a section heading). Fix the shot
  config/seed and rerun with `SHOTS=…` rather than accepting a bad frame.
- `cd landing && bun run build` (static export) and `bun test` at the repo root
  (the seed lives in the app).
- Cross-check: every `/screenshots/*.png` referenced in `landing/src` exists
  (`grep -rho '/screenshots/[a-z0-9-]*\.png' landing/src | sort -u`), the new
  blog slug appears in the index/sitemap output (`landing/out/`), Home links
  resolve, and claims match the app.
- Fix small issues yourself; re-delegate only real rework.

## 4. Ship

Landing-only commits don't publish images (CI `paths-ignore` skips
`landing`), but pushing `main` deploys lazy.zic.ar via Cloudflare Pages. Commit
with a message like `docs(landing): refresh for vX.Y.Z` (plus the session's
attribution trailer), show the user the summary + a few key screenshots, and
push only with their approval. Don't bundle landing changes into a `Release
vX.Y.Z` commit — the release skill expects that commit to touch only the
version/changelog files.
