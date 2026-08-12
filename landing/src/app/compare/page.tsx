import type { Metadata } from "next";
import Link from "next/link";
import {
  GITHUB_URL,
  IconArrows,
  IconDatabase,
  IconDocker,
  IconMcp,
  IconRelay,
  IconServer,
} from "@/components/landing/features-data";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

export const metadata: Metadata = {
  title: "Compare",
  description:
    "LazyBackup vs rsync/cron, and how it differs from Restic, Borg, and Duplicati—control plane for SSH boxes, Docker volumes, DB dumps, and MCP.",
  openGraph: {
    title: "Compare · LazyBackup",
    description:
      "Not another dedup archive CLI. LazyBackup is a From→To control plane for SSH, Docker volumes, database dumps, S3, and MCP.",
    type: "website",
  },
};

const vsRsyncRows = [
  {
    topic: "What it is",
    rsync: "A transfer tool + a schedule you write yourself.",
    lazy: "A self-hosted control plane: jobs, history, retention, auth, restore UI.",
  },
  {
    topic: "From → To",
    rsync: "You invent paths, wrappers, and which host initiates the push/pull.",
    lazy: "Local, SSH server, or S3 on either side—including server→server (ephemeral SSH or host relay).",
  },
  {
    topic: "Docker volumes",
    rsync: "Mount paths by hand; named volumes need extra docker run / alpine glue.",
    lazy: "sourceType=docker_volume packs a named volume to .tar.gz on the source server.",
  },
  {
    topic: "Databases",
    rsync: "Separate pg_dump/mysqldump scripts, credentials, and cron.",
    lazy: "Postgres / MySQL / MariaDB → .sql.gz (native client or docker exec + inspect hints).",
  },
  {
    topic: "S3 / peers",
    rsync: "Not built in (rclone/s3cmd is another stack).",
    lazy: "S3-compatible profiles as source/dest; Bro Space mailbox peers (LazyBro or LB↔LB) with forced age encryption.",
  },
  {
    topic: "Encryption",
    rsync: "You layer age/gpg yourself before/after transfer.",
    lazy: "Optional age vault before land (forced for Bro); recovery recipients + export UX.",
  },
  {
    topic: "Agents / API",
    rsync: "Shell only.",
    lazy: "Streamable HTTP MCP at /mcp + Bearer API tokens (opt-in remote_exec).",
  },
  {
    topic: "When rsync wins",
    rsync: "One-off syncs, existing battle-tested scripts, maximum DIY control.",
    lazy: "Use LazyBackup when you want the same transfers with UI, schedules, and restore—not when you only need a single rsync line.",
  },
] as const;

const otherTools = [
  {
    name: "Restic / Borg",
    blurb:
      "Excellent deduplicating archive tools. You push into a repository format with chunking, pruning, and (usually) repo passwords. LazyBackup is not competing on dedup: it lands path trees, .tar.gz volumes, and .sql.gz dumps at a destination path or S3 prefix—optionally age-encrypted—and tracks runs in History.",
  },
  {
    name: "Duplicati",
    blurb:
      "Desktop/server backup with many cloud backends and a full backup-set model. LazyBackup stays operator-focused on SSH boxes and container hosts: From→To endpoints, volume pack, DB dump, server→server relay, Status posture, and MCP—without replacing a general-purpose backup suite.",
  },
] as const;

const wedge = [
  {
    title: "SSH control plane",
    desc: "Reuse servers as From or To. Path transfers need a key; password auth still works for test/list helpers.",
    Icon: IconServer,
  },
  {
    title: "Docker volumes + DB dumps",
    desc: "Named-volume alpine packs and logical dumps with restore from History (local or S3 artifact).",
    Icon: IconDocker,
  },
  {
    title: "Database sources",
    desc: "Postgres / MySQL / MariaDB via native client or docker exec—not “rsync the data directory.”",
    Icon: IconDatabase,
  },
  {
    title: "Server → Server",
    desc: "Ephemeral SSH for direct rsync when reachable; otherwise pull then push via the LazyBackup host.",
    Icon: IconRelay,
  },
  {
    title: "MCP for agents",
    desc: "Point Cursor/Claude at /mcp with a Bearer token. Destructive tools require confirm=true.",
    Icon: IconMcp,
  },
  {
    title: "From → To, not a repo",
    desc: "Endpoints and source types—not a proprietary chunk store. Destinations are paths or object prefixes.",
    Icon: IconArrows,
  },
] as const;

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="bg-grid pointer-events-none fixed inset-0 opacity-40" />
      <SiteHeader variant="features" />

      <header className="relative border-b border-white/[0.08]">
        <div className="container mx-auto px-5 py-14 md:px-8 md:py-16">
          <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
            /compare
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">
            LazyBackup vs rsync/cron
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            LazyBackup is a{" "}
            <strong className="font-medium text-slate-200">
              control plane
            </strong>{" "}
            for From→To transfers across SSH boxes, Docker volumes, database
            dumps, S3, and MCP—not another deduplicating archive CLI. It still
            uses rsync/scp under the hood for path jobs.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/#cta"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-500/15 px-5 py-2.5 text-sm font-medium text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25"
            >
              Get started
            </Link>
            <Link
              href="/features"
              className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
            >
              Feature reference
            </Link>
            <Link
              href={GITHUB_URL}
              className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </Link>
          </div>
        </div>
      </header>

      <main className="relative">
        <section className="border-b border-white/[0.06] py-14 md:py-16">
          <div className="container mx-auto px-5 md:px-8">
            <h2 className="text-xl font-semibold tracking-tight text-slate-100">
              The wedge
            </h2>
            <p className="mt-2 max-w-2xl text-slate-400">
              Pick LazyBackup when you want UI + schedules + restore for the
              same class of work you already do with SSH and dump scripts.
            </p>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {wedge.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6"
                >
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20">
                    <item.Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-slate-100">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-white/[0.06] py-14 md:py-16">
          <div className="container mx-auto px-5 md:px-8">
            <h2 className="text-xl font-semibold tracking-tight text-slate-100">
              Side by side with rsync + cron
            </h2>
            <p className="mt-2 max-w-2xl text-slate-400">
              Honest comparison. LazyBackup does not replace every shell
              pipeline—it packages the operator loop.
            </p>
            <div className="mt-10 overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[0.1]">
                    <th className="py-3 pr-4 font-medium text-slate-500">
                      Topic
                    </th>
                    <th className="py-3 pr-4 font-medium text-slate-500">
                      rsync + cron
                    </th>
                    <th className="py-3 font-medium text-emerald-300/90">
                      LazyBackup
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vsRsyncRows.map((row) => (
                    <tr
                      key={row.topic}
                      className="border-b border-white/[0.06] align-top"
                    >
                      <th className="py-4 pr-4 font-medium text-slate-200">
                        {row.topic}
                      </th>
                      <td className="py-4 pr-4 text-slate-400">{row.rsync}</td>
                      <td className="py-4 text-slate-300">{row.lazy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="border-b border-white/[0.06] py-14 md:py-16">
          <div className="container mx-auto max-w-3xl px-5 md:px-8">
            <h2 className="text-xl font-semibold tracking-tight text-slate-100">
              Briefly: Restic, Borg, Duplicati
            </h2>
            <p className="mt-2 text-slate-400">
              Different jobs. Those tools excel at deduplicated backup
              repositories. LazyBackup schedules and lands transfers between
              endpoints you already operate.
            </p>
            <ul className="mt-8 space-y-6">
              {otherTools.map((tool) => (
                <li key={tool.name}>
                  <h3 className="font-semibold text-slate-100">{tool.name}</h3>
                  <p className="mt-2 leading-relaxed text-slate-400">
                    {tool.blurb}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-8 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm text-slate-400">
              Many operators run both: Restic/Borg for laptop or whole-disk
              archives, LazyBackup for VPS path pulls, volume packs, and DB
              dumps into a known folder or S3 prefix.
            </p>
          </div>
        </section>

        <section className="py-14 md:py-16">
          <div className="container mx-auto px-5 text-center md:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-100">
              Ready to try the control plane?
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-slate-400">
              Deploy with Docker, add an SSH server, and create a From→To job.
              Optional age vault, Status posture, and MCP when you want them.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/#cta"
                className="inline-flex rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
              >
                Deploy LazyBackup
              </Link>
              <Link
                href="/blog/manage-backups-with-mcp"
                className="inline-flex rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
              >
                MCP guide
              </Link>
              <Link
                href="/changelog"
                className="inline-flex rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
              >
                Changelog
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
