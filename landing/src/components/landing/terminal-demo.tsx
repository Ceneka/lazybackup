"use client";

import { motion } from "motion/react";

const lines = [
  { text: "========== Docker Volume Backup ==========", dim: true },
  { text: "", dim: true },
  { text: "Volume: postgres_data", dim: false },
  { text: "Archive: postgres_data.tar.gz", dim: false },
  {
    text: "Local path: /backups/vps/postgres/2026-08-13_03-00-00/postgres_data.tar.gz",
    dim: false,
  },
  { text: "Size: 184291328 bytes", dim: false },
  { text: "Transfer: rsync", dim: false },
  { text: "--- transfer stdout ---", dim: true },
  { text: "receiving incremental file list", dim: true },
  { text: "postgres_data.tar.gz", dim: true },
  { text: "sent 43 bytes  received 182,104,512 bytes", dim: true },
  { text: "total size is 184,291,328  speedup is 1.01", dim: true },
];

export function TerminalDemo() {
  return (
    <div className="relative">
      <div
        className="absolute -inset-px rounded-2xl bg-gradient-to-br from-emerald-500/40 via-cyan-500/20 to-transparent opacity-60 blur-sm"
        aria-hidden
      />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-2xl shadow-emerald-950/40 backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-red-500/80" />
          <span className="h-3 w-3 rounded-full bg-amber-500/80" />
          <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
          <span className="ml-3 font-mono text-xs text-slate-500">
            history · postgres-prod
          </span>
        </div>
        <div className="space-y-1.5 p-5 font-mono text-[13px] leading-relaxed sm:text-sm">
          {lines.map((line, i) => (
            <motion.p
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.1, duration: 0.35 }}
              className={
                line.dim
                  ? "text-slate-500"
                  : "text-emerald-300/95 [text-shadow:0_0_20px_rgba(52,211,153,0.25)]"
              }
            >
              {line.text || "\u00a0"}
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
  );
}
