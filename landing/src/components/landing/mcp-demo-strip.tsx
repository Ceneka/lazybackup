"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { ScrollReveal } from "./scroll-reveal";

const toolLines = [
  { role: "user", text: "list_backups" },
  {
    role: "tool",
    text: '→ 3 jobs · "vps-postgres" enabled · cron 0 3 * * *',
  },
  { role: "user", text: "run_backup id=vps-postgres" },
  {
    role: "tool",
    text: "→ started · history id … · status=running",
  },
  { role: "user", text: "get_dashboard" },
  {
    role: "tool",
    text: "→ successRate 97% · next runs · recent failures: 0",
  },
] as const;

export function McpDemoStrip() {
  return (
    <section
      id="mcp"
      className="relative border-y border-white/[0.06] py-20 md:py-24"
    >
      <div className="container mx-auto px-5 md:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <ScrollReveal>
            <p className="font-mono text-xs uppercase tracking-wider text-emerald-400/80">
              MCP
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-100 md:text-4xl">
              Agents talk to your instance
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-slate-400">
              Streamable HTTP at{" "}
              <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-sm text-emerald-300/90">
                /mcp
              </code>{" "}
              with Bearer API tokens. List servers, create From→To jobs, run
              backups—destructive tools need{" "}
              <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs text-slate-300">
                confirm=true
              </code>
              .
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/blog/manage-backups-with-mcp"
                className="inline-flex items-center justify-center rounded-xl bg-emerald-500/15 px-5 py-2.5 text-sm font-medium text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25"
              >
                Read the MCP guide
              </Link>
              <Link
                href="/features#mcp"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
              >
                Feature reference
              </Link>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={0.1}>
            <div className="relative">
              <div
                className="absolute -inset-px rounded-2xl bg-gradient-to-br from-emerald-500/35 via-cyan-500/15 to-transparent opacity-50 blur-sm"
                aria-hidden
              />
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/85 shadow-2xl shadow-emerald-950/30 backdrop-blur-xl">
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                  <span className="h-3 w-3 rounded-full bg-red-500/80" />
                  <span className="h-3 w-3 rounded-full bg-amber-500/80" />
                  <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
                  <span className="ml-3 font-mono text-xs text-slate-500">
                    mcp · lazybackup:/mcp
                  </span>
                </div>
                <div className="space-y-2.5 p-5 font-mono text-[13px] leading-relaxed sm:text-sm">
                  {toolLines.map((line, i) => (
                    <motion.p
                      key={`${line.role}-${i}`}
                      initial={{ opacity: 0, x: -6 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ delay: 0.15 + i * 0.1, duration: 0.35 }}
                      className={
                        line.role === "user"
                          ? "text-emerald-300/95 [text-shadow:0_0_20px_rgba(52,211,153,0.2)]"
                          : "text-slate-500"
                      }
                    >
                      {line.role === "user" ? (
                        <>
                          <span className="text-slate-600">tool </span>
                          {line.text}
                        </>
                      ) : (
                        line.text
                      )}
                    </motion.p>
                  ))}
                  <motion.span
                    className="inline-block h-4 w-2 translate-y-0.5 bg-emerald-400"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    aria-hidden
                  />
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
