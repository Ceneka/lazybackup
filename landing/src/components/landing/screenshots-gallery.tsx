"use client";

import Image from "next/image";
import { useState } from "react";
import { ScrollReveal } from "./scroll-reveal";

const screenshots = [
  {
    src: "/screenshots/dashboard.png",
    title: "Dashboard",
    alt: "LazyBackup dashboard with last-30-day backup status, success rate, storage, recent activity, and upcoming schedules",
  },
  {
    src: "/screenshots/status.png",
    title: "Status",
    alt: "LazyBackup Status posture page with critical/warn checklist for auth, age keys, instance backup, and failure webhooks",
  },
  {
    src: "/screenshots/servers.png",
    title: "Servers",
    alt: "LazyBackup servers page listing SSH connections with host, port, username, and key auth",
  },
  {
    src: "/screenshots/backups.png",
    title: "Backups",
    alt: "LazyBackup backup jobs page showing scheduled pull jobs with cron expressions and destinations",
  },
  {
    src: "/screenshots/s3-profiles.png",
    title: "S3 profiles",
    alt: "LazyBackup S3 profiles page listing a MinIO-compatible endpoint, bucket, and region",
  },
  {
    src: "/screenshots/encryption.png",
    title: "Encryption",
    alt: "LazyBackup Settings Encryption tab showing the age key vault with active key, export, and recovery recipients",
  },
  {
    src: "/screenshots/mcp-api.png",
    title: "API / MCP",
    alt: "LazyBackup Settings API tab with Bearer token creation, remote_exec checkbox, and MCP client config snippet",
  },
  {
    src: "/screenshots/bro-space.png",
    title: "Bro Space",
    alt: "LazyBackup Settings Bro Space tab for 1:1 peer storage invites, quota, and Tailscale helpers",
  },
  {
    src: "/screenshots/history.png",
    title: "History",
    alt: "LazyBackup history page with backup run logs, status badges, sizes, and timestamps",
  },
  {
    src: "/screenshots/settings.png",
    title: "Settings",
    alt: "LazyBackup settings page for timezone, SSH defaults, and optional app password",
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
        <ScrollReveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-100 md:text-4xl">
              See it in action
            </h2>
            <p className="mt-4 text-lg text-slate-400">
              Status posture, age vault, S3, Bro Space, MCP tokens, From→To
              jobs, and history—on your own host.
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.1}>
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
        </ScrollReveal>

        <ScrollReveal delay={0.15}>
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
        </ScrollReveal>

        <ScrollReveal delay={0.2}>
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
        </ScrollReveal>
      </div>
    </section>
  );
}
