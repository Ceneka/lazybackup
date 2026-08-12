import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlogBlocks } from "@/components/landing/blog-blocks";
import { GITHUB_URL, SITE_URL } from "@/components/landing/features-data";
import { HeroOrbs } from "@/components/landing/hero-orbs";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { getAllPosts, getPost } from "@/lib/blog/posts";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Post" };
  const url = `${SITE_URL}/blog/${post.slug}`;
  const ogImage = {
    url: post.cover.src,
    alt: post.cover.alt,
  };
  return {
    title: post.title,
    description: post.description,
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
    openGraph: {
      title: `${post.title} · LazyBackup`,
      description: post.description,
      type: "article",
      publishedTime: post.date,
      url,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: `${post.title} · LazyBackup`,
      description: post.description,
      images: [ogImage.url],
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const others = getAllPosts().filter((p) => p.slug !== post.slug);

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      <div className="bg-grid bg-noise pointer-events-none fixed inset-0 opacity-80" />
      <SiteHeader variant="blog" />

      <article>
        <header className="relative overflow-hidden border-b border-white/[0.06]">
          <HeroOrbs />
          <div className="relative container mx-auto px-5 pb-12 pt-14 md:px-8 md:pb-16 md:pt-20">
            <Link
              href="/blog"
              className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-emerald-300"
            >
              <span aria-hidden>←</span> Blog
            </Link>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <time dateTime={post.date}>{post.dateLabel}</time>
              <span aria-hidden>·</span>
              <span>{post.readingMinutes} min read</span>
            </div>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl">
              <span className="text-gradient">{post.title}</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-400">
              {post.description}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </header>

        <div className="relative container mx-auto px-5 py-12 md:px-8 md:py-16">
          <div className="mx-auto mb-12 max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-xl shadow-emerald-950/20">
            <div className="relative aspect-[16/10] w-full bg-slate-900">
              <Image
                src={post.cover.src}
                alt={post.cover.alt}
                fill
                priority
                className="object-cover object-top"
                sizes="(max-width: 768px) 100vw, 672px"
              />
            </div>
          </div>

          <BlogBlocks blocks={post.body} />

          <div className="mx-auto mt-16 max-w-2xl rounded-2xl border border-white/[0.08] bg-gradient-to-br from-emerald-500/10 via-transparent to-cyan-500/10 p-8 text-center">
            <p className="text-lg font-medium text-slate-100">
              Ready to try it?
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Docker one-liner on the home page, or clone the repo.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/#cta"
                className="inline-flex rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
              >
                Deploy
              </Link>
              <Link
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.05]"
              >
                GitHub
              </Link>
            </div>
          </div>

          {others.length > 0 ? (
            <aside className="mx-auto mt-16 max-w-2xl border-t border-white/[0.06] pt-10">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                More on the blog
              </p>
              <ul className="mt-4 space-y-3">
                {others.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`/blog/${p.slug}`}
                      className="text-slate-300 transition hover:text-emerald-300"
                    >
                      {p.title}
                      <span className="ml-2 text-sm text-slate-600">
                        {p.dateLabel}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
        </div>
      </article>

      <SiteFooter />
    </div>
  );
}
