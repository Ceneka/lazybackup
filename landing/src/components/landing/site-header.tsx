"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { GITHUB_URL } from "./features-data";
import { Logo } from "./logo";

const homeNav = [
  { href: "/features", label: "Features" },
  { href: "/#screenshots", label: "Screenshots" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#tech-stack", label: "Stack" },
  { href: "/#cta", label: "Deploy" },
  { href: GITHUB_URL, label: "GitHub", external: true },
] as const;

const featuresNav = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/#cta", label: "Deploy" },
  { href: GITHUB_URL, label: "GitHub", external: true },
] as const;

type SiteHeaderProps = {
  variant?: "home" | "features";
};

export function SiteHeader({ variant = "home" }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const nav = variant === "features" ? featuresNav : homeNav;
  const ctaHref = variant === "features" ? "/#cta" : "/#get-started";

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#070b14]/75 backdrop-blur-xl">
      <nav className="container mx-auto flex items-center justify-between px-5 py-4 md:px-8">
        <Link href="/" className="group flex items-center">
          <Logo
            withWordmark
            className="gap-2.5"
            markClassName="shadow-lg shadow-emerald-500/25 transition group-hover:brightness-110"
          />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              {...("external" in item && item.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={ctaHref}
            className="hidden rounded-lg bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25 sm:inline-flex"
          >
            Get started
          </Link>
          <button
            type="button"
            className="inline-flex rounded-lg p-2 text-slate-300 md:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {open ? (
                <path d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        className="overflow-hidden border-b border-white/[0.06] md:hidden"
      >
        <div className="flex flex-col gap-1 px-5 pb-4">
          {nav.map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              {...("external" in item && item.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="rounded-lg px-3 py-2.5 text-slate-300"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href={ctaHref}
            onClick={() => setOpen(false)}
            className="mt-2 rounded-lg bg-emerald-500/15 py-3 text-center font-medium text-emerald-300 ring-1 ring-emerald-500/30"
          >
            Get started
          </Link>
        </div>
      </motion.div>
    </header>
  );
}
