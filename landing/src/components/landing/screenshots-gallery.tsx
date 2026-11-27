"use client";

import Image from "next/image";
import { useState } from "react";

const screenshots = [
  {
    src: "/screenshots/dashboard.png",
    title: "Dashboard",
    alt: "LazyBackup dashboard with last successful backup, overdue schedules, needs-attention list, backup status chart, recent activity, and upcoming runs",
  },
  {
    src: "/screenshots/backups.png",
    title: "Backups",
    alt: "Backups page cards with last-run badges for success, failed, running, paused, and never run, next-run times, validation warnings, and Pause / Resume",
  },
  {
    src: "/screenshots/backup-detail.png",
    title: "Backup detail",
    alt: "Backup detail page with a live Running since banner and log link, last and next run, Pause / Resume, and encryption and file-retention settings",
  },
  {
    src: "/screenshots/backup-form.png",
    title: "Backup form",
    alt: "New backup From → To form with a server to S3 destination, schedule label, next run, encryption, and retention options",
  },
  {
    src: "/screenshots/history.png",
    title: "History",
    alt: "History list with mixed run statuses, search and status filters, Today / 7 days / 30 days date chips, and a statistics link",
  },
  {
    src: "/screenshots/history-detail.png",
    title: "History detail",
    alt: "Failed backup run detail with the error alert at the top, run summary, timestamps, log, restore, and download actions",
  },
  {
    src: "/screenshots/restore-dialog.png",
    title: "Restore",
    alt: "Restore dialog for a successful run showing the run date and size, From and To endpoints, merge note, and confirmation",
  },
  {
    src: "/screenshots/connections.png",
    title: "Connections",
    alt: "Connections servers tab with Key and Password only badges, SSH key names, and persistent connection test results",
  },
  {
    src: "/screenshots/servers.png",
    title: "Server detail",
    alt: "Server detail page with transport details for rsync, SCP, and Docker, plus the SSH key in use",
  },
  {
    src: "/screenshots/s3-profiles.png",
    title: "S3 profiles",
    alt: "Connections S3 tab listing an S3-compatible profile with endpoint, bucket, region, and path-style setting",
  },
  {
    src: "/screenshots/status.png",
    title: "Status",
    alt: "Status page checklist with text severities for auth, age keys, instance backup, password-only servers, and failure webhooks",
  },
  {
    src: "/screenshots/settings.png",
    title: "Settings",
    alt: "Settings General tab with timezone, SSH defaults, failure webhook and success-ping presets, and an explicit Save changes button",
  },
  {
    src: "/screenshots/encryption.png",
    title: "Encryption",
    alt: "Settings Encryption tab with the age key vault showing active and retired keys, export, and a recovery recipient",
  },
  {
    src: "/screenshots/mcp-api.png",
    title: "API / MCP",
    alt: "Settings API / MCP tab with token access levels Read only, Read & write, and shell, permission badges including Full access, and an MCP client config snippet",
  },
  {
    src: "/screenshots/bro-space.png",
    title: "Bro Space",
    alt: "Settings Bro Space tab with a paired peer, a pending invite code, and LazyBro download options",
  },
  {
    src: "/screenshots/dashboard-dark.png",
    title: "Dark mode",
    alt: "LazyBackup dashboard in dark mode with the same health summary, backup status chart, recent activity, and upcoming runs",
  },
] as const;

export function ScreenshotsGallery() {
  const [active, setActive] = useState(0);
  const current = screenshots[active];

  return (
    <section
      id="screenshots"
      className="relative border-y border-white/[0.06] bg-white/[0.02] py-24 md:py-32"
    >
      <div className="container mx-auto px-5 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-100 md:text-4xl">
            See it in action
          </h2>
          <p className="mt-4 text-lg text-slate-400">
            Dashboard health, Pause / Resume, safer restores, history filters,
            connection readiness, age vault, and MCP—on your own host.
          </p>
        </div>

        <div className="relative mx-auto mt-14 max-w-5xl">
            <div
              className="absolute -inset-px rounded-2xl bg-gradient-to-br from-emerald-500/30 via-cyan-500/15 to-transparent opacity-50 blur-sm"
              aria-hidden
            />
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-2xl shadow-emerald-950/30">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-red-500/80" />
                <span className="h-3 w-3 rounded-full bg-amber-500/80" />
                <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
                <span className="ml-3 font-mono text-xs text-slate-500">
                  lazybackup — {current.title.toLowerCase()}
                </span>
              </div>
              <div className="relative aspect-[1440/900] w-full bg-slate-900">
                <Image
                  key={current.src}
                  src={current.src}
                  alt={current.alt}
                  fill
                  priority={active === 0}
                  className="object-cover object-top"
                  sizes="(max-width: 768px) 100vw, 1024px"
                />
              </div>
            </div>
        </div>

        <div
          className="mx-auto mt-8 flex max-w-5xl flex-wrap justify-center gap-2"
          role="tablist"
          aria-label="App screenshots"
        >
            {screenshots.map((shot, i) => (
              <button
                key={shot.src}
                type="button"
                role="tab"
                aria-selected={active === i}
                aria-controls="screenshot-panel"
                onClick={() => setActive(i)}
                className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                  active === i
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                {shot.title}
              </button>
            ))}
        </div>

        <div className="mx-auto mt-10 max-w-5xl -mx-1">
            <div className="flex gap-2 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:pb-0 lg:grid-cols-5">
              {screenshots.map((shot, i) => (
                <button
                  key={`thumb-${shot.src}`}
                  type="button"
                  onClick={() => setActive(i)}
                  className={`group w-[6.75rem] shrink-0 overflow-hidden rounded-lg border bg-slate-950/60 text-left transition sm:w-auto sm:rounded-xl ${
                    active === i
                      ? "border-emerald-500/40 ring-1 ring-emerald-500/20"
                      : "border-white/[0.08] hover:border-white/15"
                  }`}
                >
                  <div className="relative aspect-[16/10] w-full">
                    <Image
                      src={shot.src}
                      alt=""
                      fill
                      className="object-cover object-top opacity-80 transition group-hover:opacity-100"
                      sizes="(max-width: 640px) 108px, 200px"
                    />
                  </div>
                  <p className="truncate px-2 py-1.5 text-[10px] font-medium text-slate-400 group-hover:text-slate-300 sm:px-3 sm:py-2 sm:text-xs">
                    {shot.title}
                  </p>
                </button>
              ))}
            </div>
        </div>
      </div>
    </section>
  );
}
