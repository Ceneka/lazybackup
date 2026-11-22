import Image from "next/image";

/** Pin positions are percentages of dashboard.png (1440×900). */
const pins = [
  {
    n: 1,
    x: 43.5,
    y: 30.9,
    title: "When it last worked",
    desc: "Last successful backup by name, plus an Overdue count when a schedule should have fired and didn't.",
  },
  {
    n: 2,
    x: 55,
    y: 37.8,
    title: "What needs you",
    desc: "Overdue or failing backups are listed by name, not buried in a log.",
  },
  {
    n: 3,
    x: 25,
    y: 45.8,
    title: "Honest success rate",
    desc: "Counts finished runs only. Five failures out of 130 never rounds up to 100%.",
  },
  {
    n: 4,
    x: 27.5,
    y: 93,
    title: "The actual error",
    desc: "The last failure keeps its real message, here an SSH timeout, and how many runs succeeded since.",
  },
] as const;

export function DashboardShowcase() {
  return (
    <section id="dashboard" className="relative py-24 md:py-32">
      <div className="container mx-auto px-5 md:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400/80">
            The first screen
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-100 md:text-5xl">
            Open it. Know in two seconds.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-400">
            The dashboard answers the only question that matters at 9 a.m.:
            did last night&rsquo;s backups actually happen?
          </p>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start xl:gap-14">
          <figure className="relative">
            <div
              className="absolute -inset-px rounded-2xl bg-gradient-to-br from-emerald-400/30 via-cyan-400/10 to-transparent opacity-70 blur-[2px]"
              aria-hidden
            />
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b1322] shadow-2xl shadow-black/50">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="ml-3 truncate rounded-md bg-white/[0.04] px-3 py-0.5 font-mono text-[11px] text-slate-500">
                  backups.example.com
                </span>
              </div>
              <div className="relative aspect-[1440/900]">
                <Image
                  src="/screenshots/dashboard.png"
                  alt="LazyBackup dashboard: last success with an Overdue badge, a Needs attention box naming the Redis backup, a 96% success rate of finished runs, a 30-day chart, storage totals, and the last failure with its SSH timeout error."
                  fill
                  sizes="(max-width: 1024px) 100vw, 900px"
                  className="object-cover object-top"
                />
                {pins.map((pin) => (
                  <span
                    key={pin.n}
                    className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-emerald-400 font-mono text-[10px] font-bold text-slate-950 shadow-[0_0_0_3px_rgba(52,211,153,0.25),0_4px_12px_rgba(0,0,0,0.35)] sm:h-7 sm:w-7 sm:text-xs sm:shadow-[0_0_0_4px_rgba(52,211,153,0.25),0_6px_16px_rgba(0,0,0,0.35)]"
                    style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                    aria-hidden
                  >
                    {pin.n}
                  </span>
                ))}
              </div>
            </div>
          </figure>

          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
            {pins.map((pin) => (
              <li key={pin.n} className="flex gap-4">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 font-mono text-xs font-bold text-emerald-300"
                  aria-hidden
                >
                  {pin.n}
                </span>
                <div>
                  <p className="font-medium text-slate-100">{pin.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">
                    {pin.desc}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
