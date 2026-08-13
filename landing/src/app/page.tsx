import type { Metadata } from "next";
import Link from "next/link";
import {
  DOCKER_IMAGE,
  GITHUB_URL,
  LAZYBRO_LINUX_ARM64_URL,
  LAZYBRO_LINUX_URL,
  LAZYBRO_MACOS_ARM64_URL,
  LAZYBRO_MACOS_X64_URL,
  LAZYBRO_WINDOWS_URL,
  OG_IMAGE,
  SITE_URL,
  homeFeatures,
} from "@/components/landing/features-data";
import { HeroOrbs } from "@/components/landing/hero-orbs";
import { InstallTabs } from "@/components/landing/install-tabs";
import { McpDemoStrip } from "@/components/landing/mcp-demo-strip";
import { ScreenshotsGallery } from "@/components/landing/screenshots-gallery";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { TerminalDemo } from "@/components/landing/terminal-demo";

export const metadata: Metadata = {
  title: {
    absolute: "LazyBackup — From → To backups for your servers",
  },
  description:
    "Self-hosted From→To backups: local, SSH, S3; path, Docker volume, database; validate before run, failure webhooks, age vault, Bro Space, passkeys, MCP.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "LazyBackup — From → To backups for your servers",
    description:
      "Endpoints, validate before run, failure webhooks, age vault, Bro Space, passkeys, MCP—self-hosted.",
    url: SITE_URL,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "LazyBackup — From → To backups for your servers",
    description:
      "Self-hosted From→To backups with validate, failure webhooks, age encryption, and MCP.",
    images: [OG_IMAGE.url],
  },
};

const steps = [
  {
    step: 1,
    title: "Deploy",
    desc: "Run LazyBackup on any host—Docker image or Bun—with SSH keys mounted and volumes for SQLite + backup storage.",
  },
  {
    step: 2,
    title: "Pick From → To",
    desc: "Local, server, or S3 endpoints; path, volume, database, or instance source. Enable age encryption or Bro when you need ciphertext.",
  },
  {
    step: 3,
    title: "Validate & notify",
    desc: "Validate SSH/S3/DB before a real run, then History, Status posture, failure webhooks, passkeys, and optional MCP.",
  },
] as const;

const stack = [
  { name: "Next.js 15", hint: "Web UI" },
  { name: "React 19", hint: "Components" },
  { name: "Tailwind + shadcn", hint: "Design" },
  { name: "SQLite + Drizzle", hint: "Persistence" },
  { name: "rsync / scp", hint: "Transfers" },
  { name: "Bun", hint: "Runtime" },
] as const;

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
  -p 3000:3000 \\
  -v lazybackup_data:/app/data \\
  -v ./backups:/backups \\
  -v ~/.ssh:/root/.ssh:ro \\
  -e DATABASE_URL=file:/app/data/data.db \\
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
    volumes:
      - lazybackup_data:/app/data
      - ./backups:/backups
      - ~/.ssh:/root/.ssh:ro

volumes:
  lazybackup_data:
EOF
docker compose up -d`;

export default function Home() {
  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="bg-grid bg-noise pointer-events-none fixed inset-0 opacity-80" />
      <SiteHeader />

      <section
        id="get-started"
        className="relative overflow-hidden border-b border-white/[0.06]"
      >
        <HeroOrbs />
        <div className="relative container mx-auto grid gap-12 px-5 pb-20 pt-16 md:grid-cols-2 md:items-center md:px-8 md:pb-28 md:pt-24">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-400 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
              Self-hosted · From → To · age · MCP
            </p>
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">
              <span className="text-gradient">LazyBackup</span>
              <br />
              <span className="text-slate-100">
                Backups between any endpoints
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-400">
              Move paths, Docker volumes, and database dumps between this host,
              SSH servers, and S3—plus Bro peer storage and an instance
              meta-backup. Validate before you transfer, ping Discord/ntfy/Kuma
              on failure, optional age vault, passkeys, Status posture, and MCP
              for Cursor/Claude. No agents on your VPS, no cloud lock-in.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href={GITHUB_URL}
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-6 py-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:brightness-110"
              >
                View on GitHub
              </Link>
              <Link
                href="/features"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3.5 text-sm font-medium text-slate-200 backdrop-blur-sm transition hover:border-white/25 hover:bg-white/[0.07]"
              >
                Feature reference
              </Link>
            </div>
            <dl className="mt-12 grid grid-cols-3 gap-6 border-t border-white/10 pt-10 sm:max-w-md">
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">
                  Endpoints
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-100">
                  Local / SSH / S3
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">
                  Sources
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-100">
                  Path · vol · DB
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">
                  Crypto
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-100">
                  age vault
                </dd>
              </div>
            </dl>
          </div>
          <TerminalDemo />
        </div>
      </section>

      <section id="features" className="relative py-24 md:py-32">
        <div className="container mx-auto px-5 md:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-100 md:text-4xl">
              Built for operators who read logs
            </h2>
            <p className="mt-4 text-lg text-slate-400">
              Endpoints, validate before run, failure webhooks, age vault, Bro
              Space, Status checks, and MCP—see the full reference on Features.
            </p>
          </div>
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {homeFeatures.map((f) => (
              <div
                key={f.title}
                className="group relative h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.06] to-transparent p-8 transition hover:border-emerald-500/25 hover:shadow-[0_0_0_1px_rgba(52,211,153,0.15)]"
              >
                  <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20 transition group-hover:bg-emerald-500/15">
                    <f.Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-100">
                    {f.title}
                  </h3>
                  <p className="mt-3 leading-relaxed text-slate-400">{f.desc}</p>
                  {f.title === "Bro Space" ? (
                    <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <a
                        href={LAZYBRO_LINUX_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-emerald-300/90 hover:text-emerald-200"
                      >
                        Linux x64
                      </a>
                      <a
                        href={LAZYBRO_LINUX_ARM64_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-emerald-300/90 hover:text-emerald-200"
                      >
                        Linux ARM64
                      </a>
                      <a
                        href={LAZYBRO_MACOS_ARM64_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-emerald-300/90 hover:text-emerald-200"
                      >
                        macOS ARM
                      </a>
                      <a
                        href={LAZYBRO_MACOS_X64_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-emerald-300/90 hover:text-emerald-200"
                      >
                        macOS Intel
                      </a>
                      <a
                        href={LAZYBRO_WINDOWS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-emerald-300/90 hover:text-emerald-200"
                      >
                        Windows
                      </a>
                    </p>
                  ) : null}
                </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link
              href="/features"
              className="inline-flex items-center gap-2 text-sm font-medium text-emerald-300 transition hover:text-emerald-200"
            >
              Technical feature reference
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>

      <ScreenshotsGallery />

      <McpDemoStrip />

      <section
        id="how-it-works"
        className="relative border-y border-white/[0.06] bg-white/[0.02] py-24 md:py-32"
      >
        <div className="container mx-auto px-5 md:px-8">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-slate-100 md:text-4xl">
            How it works
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-lg text-slate-400">
            LazyBackup runs on your machine and moves data between endpoints—
            default destinations look like{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-sm text-emerald-300/90">
              /backups/mysite
            </code>
            .
          </p>
          <div className="relative mx-auto mt-20 max-w-4xl">
            <div
              className="pointer-events-none absolute top-8 right-[16.666%] left-[16.666%] z-0 hidden h-0.5 md:block"
              aria-hidden
            >
              <div className="h-full w-full bg-gradient-to-r from-emerald-500/30 via-emerald-500/50 to-emerald-500/30" />
            </div>
            <div className="relative z-10 grid gap-12 md:grid-cols-3 md:gap-8">
              {steps.map((s) => (
                <div key={s.step} className="relative text-center">
                  <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0a1220] text-xl font-bold text-emerald-200 shadow-[0_0_0_6px_#0a1220] ring-1 ring-emerald-500/40">
                    <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/25 to-cyan-500/10" />
                    <span className="relative">{s.step}</span>
                  </div>
                  <h3 className="mt-6 text-lg font-semibold text-slate-100">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-slate-400">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="tech-stack" className="relative py-24 md:py-32">
        <div className="container mx-auto px-5 md:px-8">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-slate-100 md:text-4xl">
            Stack we ship on
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-lg text-slate-400">
            Next.js, Bun, SQLite, and rsync—deployed with Docker.
          </p>
          <div className="mx-auto mt-14 flex max-w-3xl flex-wrap justify-center gap-3">
            {stack.map((t) => (
              <div
                key={t.name}
                className="group rounded-2xl border border-white/[0.08] bg-slate-950/40 px-5 py-4 text-center backdrop-blur-sm transition hover:border-cyan-500/30 hover:shadow-[0_0_40px_-12px_rgba(34,211,238,0.35)]"
              >
                <p className="font-semibold text-slate-100">{t.name}</p>
                <p className="mt-1 text-xs text-slate-500">{t.hint}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="community" className="relative py-24 md:py-28">
        <div className="container mx-auto px-5 md:px-8">
          <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-emerald-500/10 via-slate-900/80 to-cyan-500/10 p-10 text-center shadow-[0_0_80px_-20px_rgba(52,211,153,0.35)] md:p-14">
              <h2 className="text-2xl font-semibold text-slate-100 md:text-3xl">
                Open source &amp; self-hosted
              </h2>
              <p className="mt-3 text-slate-400">
                Browse the code on GitHub, or follow the Docker guide and run it
                on your own backup host.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <Link
                  href={GITHUB_URL}
                  className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                >
                  GitHub
                </Link>
                <Link
                  href="/#get-started"
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 px-6 py-3.5 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
                >
                  Get started
                </Link>
              </div>
          </div>
        </div>
      </section>

      <section
        id="cta"
        className="relative overflow-hidden border-t border-white/[0.06] py-24 md:py-28"
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-emerald-950/30 to-transparent" />
        <div className="relative container mx-auto px-5 md:px-8">
          <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-100 md:text-4xl">
                Get started in minutes
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg text-slate-400">
                Docker is recommended—mount SSH keys read-only and volumes for
                the database and backup storage. The GHCR image is multi-arch
                (linux/amd64 and linux/arm64). Compose and Bun are one tab
                away. On plain HTTP (typical LAN), leave AUTH_COOKIE_SECURE
                unset so the app password session works.
              </p>
            </div>
            <InstallTabs
              dockerCommand={dockerCommand}
              composeCommand={composeCommand}
              bunCommand={bunCommand}
            />
            <p className="mx-auto mt-6 max-w-xl text-center text-sm text-slate-500">
              For local development with Bun, use{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-slate-400">
                bun run dev
              </code>{" "}
              instead of build &amp; start.
            </p>
            <div className="mx-auto mt-12 max-w-2xl">
              <h3 className="text-center text-sm font-medium uppercase tracking-wider text-slate-500">
                Environment variables
              </h3>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                {envVars.map((v) => (
                  <div
                    key={v.name}
                    className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
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
            </div>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href={GITHUB_URL}
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-8 py-4 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
              >
                View on GitHub
              </Link>
              <Link
                href="/features"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 px-8 py-4 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
              >
                Feature reference
              </Link>
              <Link
                href="/blog"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 px-8 py-4 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
              >
                Read the blog
              </Link>
            </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
