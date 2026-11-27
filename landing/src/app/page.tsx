import type { Metadata } from "next";
import Link from "next/link";
import { CronVsLazy } from "@/components/landing/cron-vs-lazy";
import { DashboardShowcase } from "@/components/landing/dashboard-showcase";
import { FeatureBento } from "@/components/landing/feature-bento";
import {
  DOCKER_IMAGE,
  GITHUB_URL,
  OG_IMAGE,
  SITE_URL,
} from "@/components/landing/features-data";
import { FlowHero } from "@/components/landing/flow-hero";
import { InstallTabs } from "@/components/landing/install-tabs";
import { ScreenshotsGallery } from "@/components/landing/screenshots-gallery";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { LATEST_VERSION } from "@/lib/version";

export const metadata: Metadata = {
  title: {
    absolute: "LazyBackup — From → To backups for your servers",
  },
  description:
    "Self-hosted From→To backups for local, SSH, and S3: paths, Docker volumes, databases—health at a glance, pause/resume, safer restores, age vault, Bro Space, MCP.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "LazyBackup — From → To backups for your servers",
    description:
      "From→To backups with health at a glance, pause/resume, safer restores, age vault, Bro Space, and MCP—self-hosted.",
    url: SITE_URL,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "LazyBackup — From → To backups for your servers",
    description:
      "Self-hosted From→To backups with backup health, pause/resume, safer restores, age encryption, and MCP.",
    images: [OG_IMAGE.url],
  },
};

const envVars = [
  { name: "DATABASE_URL", default: "file:./data.db" },
  { name: "PORT", default: "3000" },
  { name: "BACKUP_STORAGE_PATH", default: "./backups" },
  { name: "SSH_KEYS_PATH", default: "~/.ssh" },
  { name: "AUTH_SECRET", default: "(auto in settings)" },
  { name: "AUTH_COOKIE_SECURE", default: "unset (false)" },
] as const;

const dockerCommand = `docker run -d \\
  --name lazybackup \\
  --restart unless-stopped \\
  -p 3000:3000 \\
  -v lazybackup_data:/app/data \\
  -v ./backups:/backups \\
  -v ~/.ssh:/root/.ssh:ro \\
  -e DATABASE_URL=file:/app/data/data.db \\
  -e BACKUP_STORAGE_PATH=/backups \\
  ${DOCKER_IMAGE}`;

const bunCommand = `git clone ${GITHUB_URL}.git
cd lazybackup
cp .env.example .env   # optional
bun install
bun run db:migrate
bun run build && bun run start`;

const composeCommand = `cat > docker-compose.yml <<'EOF'
services:
  lazybackup:
    image: ${DOCKER_IMAGE}
    container_name: lazybackup
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: file:/app/data/data.db
      BACKUP_STORAGE_PATH: /backups
    volumes:
      - lazybackup_data:/app/data
      - ./backups:/backups
      - ~/.ssh:/root/.ssh:ro

volumes:
  lazybackup_data:
EOF
docker compose up -d`;

const worksWith = [
  "Postgres",
  "MySQL",
  "MariaDB",
  "SQLite",
  "Docker volumes",
  "Git",
  "AWS S3",
  "Cloudflare R2",
  "MinIO",
  "Backblaze B2",
  "age",
] as const;

const startSteps = [
  {
    title: "Run the container",
    desc: "Mount your SSH keys read-only and a folder for backups.",
  },
  {
    title: "Add a server or bucket",
    desc: "SSH host, S3 profile, or Git remote. Test it on the spot.",
  },
  {
    title: "Pick From → To",
    desc: "Choose what to copy and where, validate, set a schedule. Done.",
  },
] as const;

export default function Home() {
  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="bg-noise pointer-events-none fixed inset-0 opacity-60" />
      <SiteHeader />

      <section
        id="hero"
        className="relative overflow-hidden border-b border-white/[0.06]"
      >
        <div
          className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_25%,transparent_70%)]"
          aria-hidden
        />
        <div className="relative container mx-auto grid grid-cols-[minmax(0,1fr)] gap-14 px-5 pb-16 pt-12 md:px-8 md:pb-20 md:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14">
          <div className="min-w-0">
            <Link
              href="/changelog"
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1 pr-3 text-sm text-slate-300 transition hover:border-emerald-400/30 hover:bg-white/[0.05]"
            >
              <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                v{LATEST_VERSION}
              </span>
              <span className="truncate">See what changed in this release</span>
              <span aria-hidden className="text-slate-500">
                →
              </span>
            </Link>
            <h1 className="mt-7 text-[2.5rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl xl:text-[4.25rem]">
              Lazy to set up.
              <br />
              <span className="text-gradient">Paranoid about your data.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-400">
              A self-hosted panel that copies files, Docker volumes, databases,
              and Git repos from any server to any disk, SSH host, or S3
              bucket. It checks the route before it runs, shows every
              backup&rsquo;s last and next run, and tells you the moment one
              fails.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="#cta"
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-6 py-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
              >
                Run it with Docker
              </Link>
              <Link
                href={GITHUB_URL}
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.06]"
              >
                View on GitHub
              </Link>
            </div>
            <p className="mt-6 font-mono text-xs leading-relaxed text-slate-500">
              <span className="text-slate-400 [overflow-wrap:anywhere]">
                docker pull ghcr.io/ceneka/lazybackup
              </span>{" "}
              <span className="whitespace-nowrap">
                <span className="mx-1 text-slate-700">·</span>MIT
              </span>{" "}
              <span className="whitespace-nowrap">
                <span className="mx-1 text-slate-700">·</span>amd64 + arm64
              </span>
            </p>
          </div>
          <div className="min-w-0">
            <FlowHero />
          </div>
        </div>
        <div className="relative border-t border-white/[0.06]">
          <div className="container mx-auto flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-6 md:px-8">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-600">
              Works with
            </span>
            {worksWith.map((name) => (
              <span key={name} className="text-sm text-slate-400">
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      <DashboardShowcase />

      <CronVsLazy />

      <FeatureBento />

      <ScreenshotsGallery />

      <section
        id="cta"
        className="relative overflow-hidden py-24 md:py-32"
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-emerald-950/30 to-transparent" />
        <div className="relative container mx-auto px-5 md:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400/80">
              Deploy
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-100 md:text-5xl">
              Running in five minutes.
            </h2>
          </div>

          <ol className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
            {startSteps.map((step, i) => (
              <li key={step.title} className="flex gap-3 sm:flex-col">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 font-mono text-sm text-emerald-300">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-slate-100">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">
                    {step.desc}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mx-auto max-w-3xl">
            <InstallTabs
              dockerCommand={dockerCommand}
              composeCommand={composeCommand}
              bunCommand={bunCommand}
            />
            <p className="mt-5 text-center text-sm leading-relaxed text-slate-500">
              Multi-arch image (linux/amd64, linux/arm64). Unraid and TrueNAS
              SCALE templates live in{" "}
              <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-slate-400">
                deploy/
              </code>
              . On plain HTTP (typical LAN), leave{" "}
              <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-slate-400">
                AUTH_COOKIE_SECURE
              </code>{" "}
              unset so the login session works.
            </p>

            <details className="group mt-10 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
              <summary className="cursor-pointer list-none text-sm font-medium text-slate-300 marker:hidden">
                <span className="inline-flex items-center gap-2">
                  <span className="text-slate-500 transition group-open:rotate-90" aria-hidden>
                    ▸
                  </span>
                  Environment variables
                </span>
              </summary>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                {envVars.map((v) => (
                  <div
                    key={v.name}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                  >
                    <dt className="font-mono text-sm text-emerald-300/90">
                      {v.name}
                    </dt>
                    <dd className="mt-1 font-mono text-xs text-slate-500">
                      default: {v.default}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>

            <p className="mt-10 text-center text-sm text-slate-500">
              Built with Bun, Next.js, SQLite, rsync, and age. Open source
              under MIT.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href={GITHUB_URL}
                className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
              >
                View on GitHub
              </Link>
              <Link
                href="/features"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
              >
                Feature reference
              </Link>
              <Link
                href="/blog"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
              >
                Read the blog
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
