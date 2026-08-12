import type { Metadata } from "next";
import Link from "next/link";
import {
  GITHUB_URL,
  detailedFeatures,
} from "@/components/landing/features-data";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Technical reference for LazyBackup: From→To endpoints, source types, age vault, Bro Space, instance backup, Status posture, passkeys, MCP.",
  openGraph: {
    title: "Features · LazyBackup",
    description:
      "Endpoints, encryption vault, Bro Space, instance meta-backup, Status checks, passkeys, and MCP—reference-style.",
    type: "website",
  },
};

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="bg-grid pointer-events-none fixed inset-0 opacity-40" />
      <SiteHeader variant="features" />

      <header className="relative border-b border-white/[0.08]">
        <div className="container mx-auto px-5 py-14 md:px-8 md:py-16">
          <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
            /features
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">
            Capabilities
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            Reference for what the self-hosted app implements today. Prefer this
            page over marketing blurbs when wiring backups, encryption, or MCP.
          </p>
          <nav
            aria-label="Feature sections"
            className="mt-8 flex flex-wrap gap-2 border-t border-white/[0.06] pt-6"
          >
            {detailedFeatures.map((f) => (
              <a
                key={f.id}
                href={`#${f.id}`}
                className="font-mono text-xs text-slate-500 transition hover:text-emerald-300"
              >
                #{f.id}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="relative">
        <div className="container mx-auto px-5 py-12 md:px-8 md:py-16">
          <div className="mx-auto max-w-3xl divide-y divide-white/[0.08]">
            {detailedFeatures.map((f) => (
              <article
                key={f.id}
                id={f.id}
                className="scroll-mt-24 py-10 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-xl font-semibold tracking-tight text-slate-100">
                    {f.title}
                  </h2>
                  <code className="font-mono text-xs text-slate-500">{f.id}</code>
                </div>
                {f.tags && f.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {f.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 font-mono text-[11px] text-slate-500"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-4 text-[15px] leading-relaxed text-slate-400">
                  {f.summary}
                </p>
                <ul className="mt-5 space-y-2.5 border-l border-white/[0.1] pl-4">
                  {f.points.map((point) => (
                    <li
                      key={point}
                      className="text-[15px] leading-relaxed text-slate-300"
                    >
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </main>

      <section className="relative border-t border-white/[0.08] py-14">
        <div className="container mx-auto flex flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between md:px-8">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Deploy</h2>
            <p className="mt-1 text-sm text-slate-500">
              Docker image{" "}
              <code className="font-mono text-slate-400">
                ghcr.io/ceneka/lazybackup:latest
              </code>
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/#cta"
              className="inline-flex items-center justify-center rounded-md border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/[0.07]"
            >
              Install
            </Link>
            <Link
              href={GITHUB_URL}
              className="inline-flex items-center justify-center rounded-md border border-white/15 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05]"
            >
              GitHub
            </Link>
            <Link
              href="/blog"
              className="inline-flex items-center justify-center rounded-md border border-white/15 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05]"
            >
              Blog
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
