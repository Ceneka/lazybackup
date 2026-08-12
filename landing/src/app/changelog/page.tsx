import type { Metadata } from "next";
import Link from "next/link";
import { GITHUB_URL } from "@/components/landing/features-data";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { changelogEntries } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "User-facing LazyBackup release notes: reliability (CI, locks, webhooks, validate, redaction) and landing growth updates.",
  openGraph: {
    title: "Changelog · LazyBackup",
    description:
      "What shipped recently—reliability work and marketing site updates. Tags use v*.",
    type: "website",
  },
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="bg-grid pointer-events-none fixed inset-0 opacity-40" />
      <SiteHeader variant="features" />

      <header className="relative border-b border-white/[0.08]">
        <div className="container mx-auto px-5 py-14 md:px-8 md:py-16">
          <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
            /changelog
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">
            Changelog
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            Honest notes for operators evaluating LazyBackup. GitHub Releases
            should follow{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-sm text-emerald-300/90">
              v*
            </code>{" "}
            tags; the canonical markdown lives in the repo as{" "}
            <Link
              href={`${GITHUB_URL}/blob/main/CHANGELOG.md`}
              className="text-emerald-300/90 underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              CHANGELOG.md
            </Link>
            .
          </p>
        </div>
      </header>

      <main className="relative">
        <div className="container mx-auto max-w-3xl px-5 py-12 md:px-8 md:py-16">
          <div className="space-y-14">
            {changelogEntries.map((entry) => (
              <article key={entry.id} id={entry.id} className="scroll-mt-24">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-xl font-semibold tracking-tight text-slate-100">
                    {entry.title}
                  </h2>
                  <span className="font-mono text-xs text-slate-500">
                    {entry.date}
                  </span>
                </div>
                {entry.intro && (
                  <p className="mt-3 text-slate-400">{entry.intro}</p>
                )}
                {entry.sections.map((section) => (
                  <div key={section.heading} className="mt-6">
                    <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">
                      {section.heading}
                    </h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300 marker:text-emerald-500/70">
                      {section.items.map((item) => (
                        <li key={item} className="leading-relaxed">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </article>
            ))}
          </div>

          <div className="mt-16 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <h2 className="font-semibold text-slate-100">Tagging practice</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-400">
              <li>
                Keep bullets under Unreleased in{" "}
                <code className="font-mono text-slate-300">CHANGELOG.md</code>,
                then move them into a dated{" "}
                <code className="font-mono text-slate-300">[X.Y.Z]</code> section
                when cutting a release.
              </li>
              <li>
                Tag{" "}
                <code className="font-mono text-slate-300">vX.Y.Z</code> and
                push; CI publishes the GHCR image for{" "}
                <code className="font-mono text-slate-300">main</code> and{" "}
                <code className="font-mono text-slate-300">v*</code>.
              </li>
              <li>
                Optionally open a GitHub Release whose body matches that
                changelog section.
              </li>
            </ol>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/compare"
                className="text-sm font-medium text-emerald-300 hover:text-emerald-200"
              >
                Compare vs rsync →
              </Link>
              <Link
                href="/features"
                className="text-sm font-medium text-emerald-300 hover:text-emerald-200"
              >
                Features →
              </Link>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
