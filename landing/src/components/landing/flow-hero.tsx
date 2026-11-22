"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Logo } from "./logo";

type Endpoint = { kind: string; label: string; detail: string };

const sources: readonly Endpoint[] = [
  { kind: "Files", label: "prod-fra1", detail: "/var/www · /etc/nginx" },
  { kind: "Postgres", label: "app-postgres", detail: "pg_dump via docker exec" },
  { kind: "Docker volume", label: "app_redis_data", detail: "named volume on prod-fra1" },
  { kind: "Git", label: "acme/site.git", detail: "mirror clone, all refs" },
];

const destinations: readonly Endpoint[] = [
  { kind: "This host", label: "/backups", detail: "versioned folders" },
  { kind: "S3", label: "Cloudflare R2", detail: "bucket offsite/" },
  { kind: "SSH", label: "staging-nyc1", detail: "/srv/backups" },
  { kind: "Bro Space", label: "Basement NAS", detail: "a friend's disk" },
];

type Status = "success" | "failed" | "waiting";

type Scenario = {
  name: string;
  from: number;
  to: number;
  route: string;
  status: Status;
  when: string;
  note: string;
  next: string;
};

const scenarios: readonly Scenario[] = [
  {
    name: "WordPress site",
    from: 0,
    to: 0,
    route: "prod-fra1:/var/www/html → /backups/prod/wordpress",
    status: "success",
    when: "3h ago",
    note: "1.2 GB · 18,402 files · rsync · keeps 7 versions",
    next: "Daily at 02:00",
  },
  {
    name: "PostgreSQL · app DB",
    from: 1,
    to: 1,
    route: "app-postgres → r2:offsite/db/app.sql.gz.age",
    status: "success",
    when: "1h ago",
    note: "438 MB dump · age-encrypted before upload",
    next: "Daily at 01:00",
  },
  {
    name: "Redis data volume",
    from: 2,
    to: 3,
    route: "volume app_redis_data → Basement NAS",
    status: "waiting",
    when: "12m ago",
    note: "Encrypted and staged until your friend's LazyBro pulls it",
    next: "Every 6 hours",
  },
  {
    name: "Static site (Git mirror)",
    from: 3,
    to: 2,
    route: "git@git.example.com:acme/site.git → staging-nyc1:/srv/backups",
    status: "success",
    when: "12h ago",
    note: "Bare mirror · every branch and tag",
    next: "Daily at 04:30",
  },
  {
    name: "Nginx configs",
    from: 0,
    to: 2,
    route: "prod-fra1:/etc/nginx → staging-nyc1:/srv/backups/nginx",
    status: "failed",
    when: "19h ago",
    note: "SSH to staging-nyc1:22 timed out (ETIMEDOUT) · ntfy notified",
    next: "Daily at 03:00",
  },
];

const statusStyles: Record<Status, { badge: string; label: string; line: string; pill: string }> = {
  success: {
    badge: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
    label: "Success",
    line: "stroke-emerald-400",
    pill: "border-emerald-400/50 bg-emerald-400/[0.08]",
  },
  failed: {
    badge: "bg-red-400/10 text-red-300 ring-red-400/30",
    label: "Failed",
    line: "stroke-red-400",
    pill: "border-red-400/50 bg-red-400/[0.08]",
  },
  waiting: {
    badge: "bg-amber-400/10 text-amber-300 ring-amber-400/30",
    label: "Waiting for bro",
    line: "stroke-amber-300",
    pill: "border-amber-300/50 bg-amber-300/[0.08]",
  },
};

const CYCLE_MS = 3800;

type Paths = { src: string[]; dst: string[] };

function curve(x1: number, y1: number, x2: number, y2: number) {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "success") {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.2 8.2l1.9 1.9 3.7-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function EndpointPill({
  endpoint,
  active,
  activeClass,
  setRef,
}: {
  endpoint: Endpoint;
  active: boolean;
  activeClass: string;
  setRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={setRef}
      className={`rounded-xl border px-3 py-2.5 transition-colors duration-500 ${
        active ? activeClass : "border-white/[0.07] bg-white/[0.02]"
      }`}
    >
      <p
        className={`font-mono text-[10px] uppercase tracking-wider transition-colors duration-500 ${
          active ? "text-slate-300" : "text-slate-500"
        }`}
      >
        {endpoint.kind}
      </p>
      <p
        className={`mt-0.5 truncate text-sm font-medium transition-colors duration-500 ${
          active ? "text-slate-50" : "text-slate-400"
        }`}
      >
        {endpoint.label}
      </p>
      <p className="truncate text-[11px] text-slate-500">{endpoint.detail}</p>
    </div>
  );
}

/**
 * Hero visual: sources → LazyBackup → destinations, cycling through real
 * route types with a status card that mirrors the app's backup cards.
 */
export function FlowHero() {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [paths, setPaths] = useState<Paths | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const hubRef = useRef<HTMLDivElement | null>(null);
  const srcRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dstRefs = useRef<Array<HTMLDivElement | null>>([]);

  const scenario = scenarios[index];
  const tone = statusStyles[scenario.status];

  const measure = useCallback(() => {
    const container = containerRef.current;
    const hub = hubRef.current;
    if (!container || !hub) return;
    const c = container.getBoundingClientRect();
    const h = hub.getBoundingClientRect();
    const hubLeft = { x: h.left - c.left, y: h.top - c.top + h.height / 2 };
    const hubRight = { x: h.right - c.left, y: h.top - c.top + h.height / 2 };
    const src = srcRefs.current.map((el) => {
      if (!el) return "";
      const r = el.getBoundingClientRect();
      return curve(r.right - c.left, r.top - c.top + r.height / 2, hubLeft.x, hubLeft.y);
    });
    const dst = dstRefs.current.map((el) => {
      if (!el) return "";
      const r = el.getBoundingClientRect();
      return curve(hubRight.x, hubRight.y, r.left - c.left, r.top - c.top + r.height / 2);
    });
    setBox({ w: c.width, h: c.height });
    setPaths({ src, dst });
  }, []);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (reduceMotion || paused) return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % scenarios.length),
      CYCLE_MS
    );
    return () => window.clearInterval(timer);
  }, [reduceMotion, paused]);

  const flowClass = reduceMotion ? "" : "flow-dash";

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        className="pointer-events-none absolute -inset-10 rounded-[3rem] bg-[radial-gradient(ellipse_at_center,rgba(52,211,153,0.14),transparent_65%)]"
        aria-hidden
      />

      {/* Desktop / tablet: full routing diagram */}
      <div
        ref={containerRef}
        className="relative hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-8 sm:grid lg:gap-x-10"
        aria-hidden
      >
        {paths ? (
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={box.w}
            height={box.h}
            viewBox={`0 0 ${box.w} ${box.h}`}
          >
            {paths.src.map((d, i) => (
              <path
                key={`s${i}`}
                d={d}
                fill="none"
                className="stroke-white/[0.08]"
                strokeWidth={1.25}
              />
            ))}
            {paths.dst.map((d, i) => (
              <path
                key={`d${i}`}
                d={d}
                fill="none"
                className="stroke-white/[0.08]"
                strokeWidth={1.25}
              />
            ))}
            <path
              key={`as-${index}`}
              d={paths.src[scenario.from]}
              fill="none"
              className={`${tone.line} ${flowClass}`}
              strokeWidth={2}
              strokeDasharray={reduceMotion ? undefined : "6 8"}
              strokeLinecap="round"
            />
            <path
              key={`ad-${index}`}
              d={paths.dst[scenario.to]}
              fill="none"
              className={`${tone.line} ${flowClass}`}
              strokeWidth={2}
              strokeDasharray={reduceMotion ? undefined : "6 8"}
              strokeLinecap="round"
            />
          </svg>
        ) : null}

        <div className="relative flex flex-col gap-2.5">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
            From
          </p>
          {sources.map((s, i) => (
            <EndpointPill
              key={s.label}
              endpoint={s}
              active={i === scenario.from}
              activeClass="border-emerald-400/40 bg-emerald-400/[0.06]"
              setRef={(el) => {
                srcRefs.current[i] = el;
              }}
            />
          ))}
        </div>

        <div className="relative flex flex-col items-center pt-6">
          <div
            ref={hubRef}
            className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0b1322] ring-1 ring-emerald-400/30 shadow-[0_0_40px_-8px_rgba(52,211,153,0.45)]"
          >
            <Logo markClassName="h-10 w-10" />
          </div>
          <p className="mt-3 text-center font-mono text-[10px] leading-relaxed text-slate-500">
            validate
            <br />
            transfer
            <br />
            land
          </p>
        </div>

        <div className="relative flex flex-col gap-2.5">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
            To
          </p>
          {destinations.map((d, i) => (
            <EndpointPill
              key={d.label}
              endpoint={d}
              active={i === scenario.to}
              activeClass={tone.pill}
              setRef={(el) => {
                dstRefs.current[i] = el;
              }}
            />
          ))}
        </div>
      </div>

      {/* Phone: compact From → To */}
      <div className="relative flex items-stretch gap-2 sm:hidden" aria-hidden>
        <div className="min-w-0 flex-1 rounded-xl border border-emerald-400/40 bg-emerald-400/[0.06] px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            From · {sources[scenario.from].kind}
          </p>
          <p className="truncate text-sm font-medium text-slate-50">
            {sources[scenario.from].label}
          </p>
        </div>
        <div className="flex items-center text-slate-500">→</div>
        <div className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 ${tone.pill}`}>
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            To · {destinations[scenario.to].kind}
          </p>
          <p className="truncate text-sm font-medium text-slate-50">
            {destinations[scenario.to].label}
          </p>
        </div>
      </div>

      {/* Status card mirroring the app's backup card */}
      <div className="relative mt-6 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={index}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.25 }}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <p className="font-medium text-slate-100">{scenario.name}</p>
              <p className="font-mono text-[11px] text-slate-500">
                Next · {scenario.next}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-medium">
              <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                Active
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ring-1 ring-inset ${tone.badge}`}
              >
                <StatusIcon status={scenario.status} />
                {tone.label} · {scenario.when}
              </span>
            </div>
            <p className="mt-3 truncate font-mono text-[12px] text-slate-400">
              {scenario.route}
            </p>
            <p
              className={`mt-1 text-[13px] ${
                scenario.status === "failed" ? "text-red-300/90" : "text-slate-500"
              }`}
            >
              {scenario.note}
            </p>
          </motion.div>
        </AnimatePresence>
        <p className="sr-only" aria-live="polite">
          {`${scenario.name}: ${scenario.route}. ${statusStyles[scenario.status].label} ${scenario.when}. ${scenario.note}.`}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2" role="group" aria-label="Example backups">
        {scenarios.map((s, i) => (
          <button
            key={s.name}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show ${s.name}`}
            aria-pressed={i === index}
            className="group flex h-6 items-center px-1"
          >
            <span
              className={`block h-1.5 rounded-full transition-all duration-300 ${
                i === index
                  ? "w-6 bg-emerald-400"
                  : "w-1.5 bg-slate-600 group-hover:bg-slate-400"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
