import Link from "next/link";

const questions = [
  {
    q: "Did it run?",
    a: "Every backup card shows its last and next run. Overdue schedules are flagged on the dashboard and on Status.",
  },
  {
    q: "Did it copy anything?",
    a: "Each run keeps its size, file count, duration, and full log. A 20-byte dump is easy to spot.",
  },
  {
    q: "Who finds out when it breaks?",
    a: "A failure webhook to Discord, ntfy, Slack, Telegram, Gotify, or Uptime Kuma, with the real error.",
  },
  {
    q: "Can you get it back?",
    a: "Restore from History onto the same host or another one. You see what will be overwritten before anything is touched.",
  },
] as const;

function Prompt({ children }: { children: React.ReactNode }) {
  return (
    <p>
      <span className="select-none text-slate-600">$ </span>
      <span className="text-slate-200">{children}</span>
    </p>
  );
}

export function CronVsLazy() {
  return (
    <section
      id="why"
      className="relative border-y border-white/[0.06] bg-white/[0.015] py-24 md:py-32"
    >
      <div className="container mx-auto px-5 md:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400/80">
            Why not just cron?
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-100 md:text-5xl">
            Your cron job won&rsquo;t tell you it stopped.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-400">
            rsync and pg_dump are great. A crontab that fails silently for
            twelve days is not. LazyBackup keeps the tools and adds the parts
            you only miss on the day you need a restore.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          {/* The script */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#05080f]">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
              <span className="font-mono text-xs text-slate-500">
                root@backup-box: ~
              </span>
              <span className="rounded-full bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                the usual
              </span>
            </div>
            <div className="flex-1 space-y-1 overflow-x-auto p-5 font-mono text-[12px] leading-relaxed text-slate-500 sm:text-[13px]">
              <Prompt>crontab -l</Prompt>
              <p className="whitespace-pre">0 3 * * *  rsync -a deploy@prod:/var/www/ /backups/www/ \</p>
              <p className="whitespace-pre">             &gt;&gt; /var/log/backup.log 2&gt;&amp;1</p>
              <p className="whitespace-pre">30 3 * * * pg_dump app | gzip &gt; /backups/db/app.sql.gz</p>
              <div className="h-3" />
              <Prompt>ls -l /backups/db/</Prompt>
              <p className="whitespace-pre">
                -rw-r--r-- 1 root root{" "}
                <span className="text-amber-300">20</span> Nov  9 03:30 app.sql.gz
              </p>
              <div className="h-3" />
              <Prompt>tail -n 1 /var/log/backup.log</Prompt>
              <p className="whitespace-pre text-red-300/80">
                rsync: connection unexpectedly closed (0 bytes received so far)
              </p>
              <div className="h-3" />
              <p className="text-slate-600">
                # last good run: 12 days ago. nobody noticed.
              </p>
            </div>
          </div>

          {/* The same jobs in LazyBackup */}
          <div className="relative flex flex-col gap-3 rounded-2xl border border-emerald-400/20 bg-gradient-to-b from-emerald-400/[0.05] to-transparent p-5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-slate-400">
                LazyBackup · Backups
              </span>
              <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                same jobs
              </span>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-100">WordPress site</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-red-400/10 px-2 py-0.5 text-[11px] font-medium text-red-300 ring-1 ring-inset ring-red-400/30">
                  Failed · 19h ago
                </span>
              </div>
              <p className="mt-2 font-mono text-[12px] text-slate-500">
                prod-fra1:/var/www/html → /backups/prod/wordpress
              </p>
              <p className="mt-2 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 font-mono text-[12px] leading-relaxed text-red-200/90">
                SSH connection to prod-fra1.example.com:22 timed out after 30s
                (ETIMEDOUT)
              </p>
            </div>

            <div className="ml-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-white/10 bg-[#111a2b] p-3 shadow-xl shadow-black/40 sm:w-auto">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-sm" aria-hidden>
                🔔
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-slate-100">
                  ntfy · LazyBackup failure
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-slate-400">
                  WordPress site: SSH connection to prod-fra1.example.com:22
                  timed out…
                </p>
              </div>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">
                03:00
              </span>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-100">PostgreSQL · app DB</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                  Success · 3h ago
                </span>
              </div>
              <p className="mt-2 font-mono text-[12px] text-slate-500">
                app-postgres → /backups/db/postgres · 438 MB · next 01:00
              </p>
            </div>
          </div>
        </div>

        <dl className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {questions.map((item) => (
            <div key={item.q} className="border-l border-emerald-400/30 pl-4">
              <dt className="font-medium text-slate-100">{item.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-slate-400">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-12">
          <Link
            href="/compare"
            className="text-sm font-medium text-emerald-300 transition hover:text-emerald-200"
          >
            Full comparison with rsync + cron, Restic, Borg, and Duplicati{" "}
            <span aria-hidden>→</span>
          </Link>
        </p>
      </div>
    </section>
  );
}
