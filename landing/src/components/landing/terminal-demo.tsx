"use client";

import { motion } from "motion/react";

const lines = [
  { text: "$ docker run -d --name lazybackup \\", dim: false },
  { text: "    -p 3000:3000 -v ./backups:/backups \\", dim: false },
  { text: "    -v ~/.ssh:/root/.ssh:ro \\", dim: false },
  { text: "    ghcr.io/ceneka/lazybackup:latest", dim: false },
  { text: "✓ Dashboard ready at http://localhost:3000", dim: true },
  { text: "→ From: vps.prod  ·  To: this host", dim: true },
  { text: "→ docker volume · postgres_data → /backups/…", dim: true },
  { text: "→ Also: server → server (ephemeral SSH / relay)", dim: true },
  { text: "✓ transfer complete · restore available", dim: true },
];

export function TerminalDemo() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, rotateX: 8 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="relative perspective-[1200px]"
    >
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
            lazybackup — from → to
          </span>
        </div>
        <div className="space-y-2 p-5 font-mono text-sm leading-relaxed">
          {lines.map((line, i) => (
            <motion.p
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + i * 0.12, duration: 0.35 }}
              className={
                line.dim
                  ? "text-slate-500"
                  : "text-emerald-300/95 [text-shadow:0_0_20px_rgba(52,211,153,0.25)]"
              }
            >
              {line.text}
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
    </motion.div>
  );
}
