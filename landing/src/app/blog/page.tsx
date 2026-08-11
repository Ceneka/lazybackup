import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { HeroOrbs } from "@/components/landing/hero-orbs";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { GITHUB_URL } from "@/components/landing/features-data";
import { getAllPosts } from "@/lib/blog/posts";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Guides and product notes for LazyBackup — self-hosted From → To backups, Docker databases, and more.",
  openGraph: {
    title: "Blog · LazyBackup",
    description:
      "Guides and product notes for LazyBackup — self-hosted backups done simply.",
    type: "website",
  },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="bg-grid bg-noise pointer-events-none fixed inset-0 opacity-80" />
      <SiteHeader variant="blog" />

      <section className="relative overflow-hidden border-b border-white/[0.06]">
        <HeroOrbs />
        <div className="relative container mx-auto px-5 pb-14 pt-16 md:px-8 md:pb-16 md:pt-24">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-400 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
            Blog
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            <span className="text-gradient">Notes &amp; guides</span>
            <span className="mt-2 block text-slate-100">
              How LazyBackup fits real backups
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
            Product walkthroughs and practical how-tos—Docker databases, From →
            To jobs, and more as we ship.
          </p>
        </div>
      </section>

      <section className="relative py-16 md:py-20">
        <div className="container mx-auto px-5 md:px-8">
          <ul className="mx-auto grid max-w-4xl gap-8">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="group grid overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent transition hover:border-emerald-500/30 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
                >
                  <div className="relative aspect-[16/10] bg-slate-900 md:aspect-auto md:min-h-[220px]">
                    <Image
                      src={post.cover.src}
                      alt={post.cover.alt}
                      fill
                      className="object-cover object-top opacity-90 transition group-hover:opacity-100"
                      sizes="(max-width: 768px) 100vw, 440px"
                    />
                  </div>
                  <div className="flex flex-col justify-center p-6 md:p-8">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <time dateTime={post.date}>{post.dateLabel}</time>
                      <span aria-hidden>·</span>
                      <span>{post.readingMinutes} min read</span>
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-100 transition group-hover:text-emerald-300">
                      {post.title}
                    </h2>
                    <p className="mt-3 text-slate-400 leading-relaxed">
                      {post.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {post.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mx-auto mt-14 max-w-4xl text-center text-sm text-slate-500">
            Want the product itself?{" "}
            <Link href="/#cta" className="text-emerald-400 hover:text-emerald-300">
              Deploy instructions
            </Link>{" "}
            or{" "}
            <Link
              href={GITHUB_URL}
              className="text-emerald-400 hover:text-emerald-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </Link>
            .
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
