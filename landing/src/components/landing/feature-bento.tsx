import Link from "next/link";
import {
  LAZYBRO_LINUX_URL,
  LAZYBRO_MACOS_ARM64_URL,
  LAZYBRO_RELEASE_URL,
  LAZYBRO_WINDOWS_URL,
} from "./features-data";

function Card({
  className = "",
  eyebrow,
  title,
  children,
  visual,
}: {
  className?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  visual: React.ReactNode;
}) {
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a1120] p-6 transition hover:border-white/[0.14] md:p-7 ${className}`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400/80">
        {eyebrow}
      </p>
      <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-100">
        {title}
      </h3>
      <div className="mt-2 text-[15px] leading-relaxed text-slate-400">{children}</div>
      <div className="mt-6 flex flex-1 flex-col justify-end">{visual}</div>
    </div>
  );
}

function Check({ ok = true, label, detail }: { ok?: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          ok ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"
        }`}
        aria-hidden
      >
        {ok ? "✓" : "!"}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-slate-200">{label}</span>
        <span className="block truncate font-mono text-[11px] text-slate-500">{detail}</span>
      </span>
    </li>
  );
}

const also = [
  {
    title: "Status posture",
    desc: "A checklist of what's weak on this instance: no password, unexported keys, overdue schedules, password-only SSH.",
  },
  {
    title: "Pause / Resume",
    desc: "Stop a schedule from the card menu without opening the form. Validation results stay.",
  },
  {
    title: "Versioning & retention",
    desc: "Timestamped folders with keep-N, or age-based file retention with a minimum to keep.",
  },
  {
    title: "Restore anywhere",
    desc: "Paths, volumes, databases, and Git mirrors back onto the same host or a different one.",
  },
  {
    title: "Passkeys & app password",
    desc: "Lock the UI with WebAuthn, a password, or both. No user table to manage.",
  },
  {
    title: "Instance meta-backup",
    desc: "Back up LazyBackup itself: SQLite, age vault, and SSH keys, optionally passphrase-wrapped.",
  },
  {
    title: "Pre-backup commands",
    desc: "Run a command on the source first, like flushing a cache or stopping a worker.",
  },
  {
    title: "Success pings",
    desc: "Healthchecks-style pings after each good run, so silence itself raises an alarm.",
  },
] as const;

export function FeatureBento() {
  return (
    <section id="features" className="relative py-24 md:py-32">
      <div className="container mx-auto px-5 md:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400/80">
            What it does
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-100 md:text-5xl">
            The boring parts, done properly.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-400">
            Checks before it runs, real errors when it fails, encryption you
            hold the keys to, and an API your agents can use.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-6">
          <Card
            className="md:col-span-3"
            eyebrow="Validate"
            title="Find out before 3 a.m., not at it"
            visual={
              <div className="rounded-xl border border-white/[0.06] bg-slate-950/70 px-4 py-2">
                <ul className="divide-y divide-white/[0.05]">
                  <Check label="Configuration" detail="server → this host · path · versioned" />
                  <Check label="Cron schedule" detail="0 2 * * * → Daily at 02:00 (Europe/Madrid)" />
                  <Check label="Source SSH" detail="deploy@prod-fra1.example.com · key auth" />
                  <Check label="Source path on server" detail="/var/www/html exists, readable" />
                  <Check label="Local destination" detail="/backups/prod/wordpress writable" />
                </ul>
                <p className="border-t border-white/[0.05] py-2 font-mono text-[11px] text-emerald-300/80">
                  Validation passed · 5 checks · nothing transferred
                </p>
              </div>
            }
          >
            One click probes SSH, paths, S3, Docker, and database credentials
            without moving a byte. The result stays on the backup page.
          </Card>

          <Card
            className="md:col-span-3"
            eyebrow="MCP"
            title="Ask your agent how last night went"
            visual={
              <div className="space-y-2.5 rounded-xl border border-white/[0.06] bg-slate-950/70 p-4 text-[13px]">
                <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-emerald-400/15 px-3 py-2 text-emerald-50">
                  Is anything failing?
                </p>
                <p className="w-fit rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-slate-500">
                  → get_status
                </p>
                <p className="w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-white/[0.06] px-3 py-2 text-slate-200">
                  Nginx configs failed 19h ago: SSH timed out on prod-fra1.
                  Everything else succeeded. Run it again?
                </p>
                <p className="ml-auto w-fit rounded-2xl rounded-br-md bg-emerald-400/15 px-3 py-2 text-emerald-50">
                  Yes
                </p>
                <p className="w-fit rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-slate-500">
                  → run_backup {"{"} id: &quot;nginx-configs&quot; {"}"}
                </p>
              </div>
            }
          >
            A Streamable HTTP MCP server at{" "}
            <code className="font-mono text-[13px] text-emerald-300/90">/mcp</code>.
            Tokens are Read only, Read &amp; write, or shell. Destructive tools
            need <code className="font-mono text-[13px] text-slate-300">confirm=true</code>.{" "}
            <Link href="/blog/manage-backups-with-mcp" className="text-emerald-300 hover:text-emerald-200">
              MCP guide →
            </Link>
          </Card>

          <Card
            className="md:col-span-2"
            eyebrow="Alerts"
            title="Failures land where you look"
            visual={
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {["Discord", "ntfy", "Slack", "Telegram", "Gotify", "Uptime Kuma"].map((p) => (
                    <span
                      key={p}
                      className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[12px] text-slate-300"
                    >
                      {p}
                    </span>
                  ))}
                </div>
                <p className="rounded-lg bg-slate-950/70 px-3 py-2 font-mono text-[12px] text-slate-400">
                  <span className="text-cyan-300/90">{"{{backupName}}"}</span>:{" "}
                  <span className="text-cyan-300/90">{"{{errorMessage}}"}</span>
                </p>
              </div>
            }
          >
            Presets fill the method, headers, and body. Templates use the real
            backup name and error.
          </Card>

          <Card
            className="md:col-span-2"
            eyebrow="Databases"
            title="Dumps, not tarballs of a live DB"
            visual={
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {["Postgres", "MySQL", "MariaDB", "SQLite"].map((p) => (
                    <span
                      key={p}
                      className="rounded-md border border-cyan-400/20 bg-cyan-400/[0.06] px-2 py-1 text-[12px] text-cyan-200"
                    >
                      {p}
                    </span>
                  ))}
                </div>
                <p className="rounded-lg bg-slate-950/70 px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-400">
                  docker exec app-postgres pg_dump
                  <br />
                  <span className="text-slate-500">→ app_2026-11-21_0100.sql.gz</span>
                </p>
              </div>
            }
          >
            Native client or <code className="font-mono text-[13px]">docker exec</code>.
            Pick the container and credentials fill in from its environment.
          </Card>

          <Card
            className="md:col-span-2"
            eyebrow="Encryption"
            title="Your keys, on your box"
            visual={
              <ul className="space-y-1.5 rounded-xl border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-[11px]">
                <li className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-300">age1qyf7…8m3x</span>
                  <span className="shrink-0 rounded bg-emerald-400/15 px-1.5 text-emerald-300">active</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-500">age1z3vp…k2pd</span>
                  <span className="shrink-0 rounded bg-white/[0.06] px-1.5 text-slate-400">retired</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-500">age1r9cw…q7tn</span>
                  <span className="shrink-0 rounded bg-cyan-400/10 px-1.5 text-cyan-300">recovery</span>
                </li>
              </ul>
            }
          >
            Optional age encryption before anything lands. Old keys are retired,
            never overwritten, so old backups still decrypt.
          </Card>

          <Card
            className="md:col-span-3"
            eyebrow="Server → Server"
            title="Direct when they can see each other"
            visual={
              <div className="rounded-xl border border-white/[0.06] bg-slate-950/70 p-4">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-slate-200">
                    prod-fra1
                  </span>
                  <span className="min-w-0 flex-1 text-center">
                    <span className="block font-mono text-[10px] leading-tight text-emerald-300/80">
                      direct rsync
                    </span>
                    <span className="mt-1.5 block h-px bg-emerald-400/70" />
                  </span>
                  <span className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-slate-200">
                    staging-nyc1
                  </span>
                </div>
                <p className="mt-4 text-center font-mono text-[11px] text-slate-500">
                  can&rsquo;t reach? pulls to this host, then pushes
                </p>
              </div>
            }
          >
            LazyBackup installs a short-lived key on the destination so the
            source rsyncs straight to it. The key is removed when the run ends.
          </Card>

          <Card
            className="md:col-span-3"
            eyebrow="Bro Space"
            title="Offsite at a friend's place"
            visual={
              <div className="rounded-xl border border-white/[0.06] bg-slate-950/70 p-4">
                <div className="flex items-center justify-between gap-3 font-mono text-[12px]">
                  <span className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-slate-200">
                    your LazyBackup
                  </span>
                  <span className="flex-1 text-center text-[10px] text-amber-200/80">
                    ⇄ age ciphertext only
                  </span>
                  <span className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-slate-200">
                    their LazyBro
                  </span>
                </div>
                <p className="mt-3 text-center text-[12px] text-slate-500">
                  Get LazyBro:{" "}
                  <a href={LAZYBRO_LINUX_URL} className="text-emerald-300 hover:text-emerald-200">Linux</a>
                  {" · "}
                  <a href={LAZYBRO_MACOS_ARM64_URL} className="text-emerald-300 hover:text-emerald-200">macOS</a>
                  {" · "}
                  <a href={LAZYBRO_WINDOWS_URL} className="text-emerald-300 hover:text-emerald-200">Windows</a>
                  {" · "}
                  <a href={LAZYBRO_RELEASE_URL} className="text-slate-400 hover:text-slate-200">all builds</a>
                </p>
              </div>
            }
          >
            Pair with an invite code and trade disk space. They only ever see
            encrypted blobs, and a restore pulls your copy back from them.
          </Card>
        </div>

        <div className="mt-16">
          <h3 className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">
            Also included
          </h3>
          <dl className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {also.map((item) => (
              <div key={item.title}>
                <dt className="text-[15px] font-medium text-slate-200">{item.title}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-slate-500">{item.desc}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-10">
            <Link
              href="/features"
              className="inline-flex items-center gap-2 text-sm font-medium text-emerald-300 transition hover:text-emerald-200"
            >
              Full feature reference
              <span aria-hidden>→</span>
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
