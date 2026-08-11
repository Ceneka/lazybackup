import type { Metadata } from "next";
import Link from "next/link";
import {
  GITHUB_URL,
  detailedFeatures,
} from "@/components/landing/features-data";
import { HeroOrbs } from "@/components/landing/hero-orbs";
import { ScrollReveal } from "@/components/landing/scroll-reveal";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

export const metadata: Metadata = {
  title: "Features",
  description:
    "From → To backups between local and servers, Docker volume pack & restore, server→server ephemeral transfer or relay, scheduling, retention, and optional app password.",
  openGraph: {
    title: "Features · LazyBackup",
    description:
      "All four transfer directions, Docker volumes, server→server, retention, restore, and more.",
    type: "website",
  },
};

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="bg-grid bg-noise pointer-events-none fixed inset-0 opacity-80" />
      <SiteHeader variant="features" />

      <section className="relative overflow-hidden border-b border-white/[0.06]">
        <HeroOrbs />
        <div className="relative container mx-auto px-5 pb-16 pt-16 md:px-8 md:pb-20 md:pt-24">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-400 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
            Product capabilities
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            <span className="text-gradient">Features</span>
            <span className="mt-2 block text-slate-100">
              What LazyBackup actually does
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
            A self-hosted backup manager built around From → To transfers:
            paths or Docker volumes, any mix of local and server endpoints,
            schedules, retention, and restore—without agents on your VPS.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {detailedFeatures.map((f) => (
              <a
                key={f.id}
                href={`#${f.id}`}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-emerald-500/30 hover:text-emerald-300"
              >
                {f.title}
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="relative py-16 md:py-24">
        <div className="container mx-auto space-y-10 px-5 md:space-y-14 md:px-8">
          {detailedFeatures.map((f, i) => (
            <ScrollReveal key={f.id} delay={Math.min(i * 0.04, 0.2)}>
              <article
                id={f.id}
                className="scroll-mt-28 overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent"
              >
                <div className="grid gap-8 p-8 md:grid-cols-[auto_1fr] md:gap-10 md:p-10">
                  <div className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20">
                    <f.Icon className="h-7 w-7" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-100 md:text-3xl">
                      {f.title}
                    </h2>
                    <p className="mt-3 max-w-3xl text-lg leading-relaxed text-slate-400">
                      {f.summary}
                    </p>
                    <ul className="mt-6 space-y-3">
                      {f.points.map((point) => (
                        <li
                          key={point}
                          className="flex gap-3 text-slate-300"
                        >
                          <span
                            className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                            aria-hidden
                          />
                          <span className="leading-relaxed">{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <section className="relative border-t border-white/[0.06] py-20 md:py-24">
        <div className="container mx-auto px-5 md:px-8">
          <ScrollReveal>
            <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-emerald-500/10 via-slate-900/80 to-cyan-500/10 p-10 text-center shadow-[0_0_80px_-20px_rgba(52,211,153,0.35)] md:p-14">
              <h2 className="text-2xl font-semibold text-slate-100 md:text-3xl">
                Ready to run it?
              </h2>
              <p className="mt-3 text-slate-400">
                Deploy with Docker in minutes, or clone the repo and run with
                Bun. Or read how Database dumps work on the blog.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <Link
                  href="/#cta"
                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-6 py-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:brightness-110"
                >
                  Deploy instructions
                </Link>
                <Link
                  href="/blog"
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 px-6 py-3.5 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
                >
                  Blog
                </Link>
                <Link
                  href={GITHUB_URL}
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 px-6 py-3.5 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/[0.05]"
                >
                  GitHub
                </Link>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
