"use client";

import { motion } from "motion/react";

export function HeroOrbs() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <motion.div
        className="absolute -left-32 top-1/4 h-[420px] w-[420px] rounded-full bg-emerald-500/20 blur-[100px]"
        animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-24 top-1/3 h-[380px] w-[380px] rounded-full bg-cyan-500/15 blur-[90px]"
        animate={{ x: [0, -35, 0], y: [0, 25, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-0 left-1/2 h-[280px] w-[600px] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-[100px]"
        animate={{ opacity: [0.35, 0.55, 0.35] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
