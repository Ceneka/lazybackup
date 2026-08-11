import Image from "next/image";
import type { BlogBlock } from "@/lib/blog/posts";

export function BlogBlocks({ blocks }: { blocks: BlogBlock[] }) {
  return (
    <div className="blog-prose mx-auto max-w-2xl">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "p":
            return (
              <p key={i} className="mt-6 text-lg leading-relaxed text-slate-300">
                {block.text}
              </p>
            );
          case "h2":
            return (
              <h2
                key={i}
                className="mt-12 text-2xl font-semibold tracking-tight text-slate-100 md:text-3xl"
              >
                {block.text}
              </h2>
            );
          case "ul":
            return (
              <ul key={i} className="mt-5 space-y-2.5 pl-1">
                {block.items.map((item) => (
                  <li key={item} className="flex gap-3 text-slate-300">
                    <span
                      className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                      aria-hidden
                    />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="mt-5 list-decimal space-y-2.5 pl-6 text-slate-300">
                {block.items.map((item) => (
                  <li key={item} className="leading-relaxed pl-1">
                    {item}
                  </li>
                ))}
              </ol>
            );
          case "img":
            return (
              <figure key={i} className="mt-10">
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-xl shadow-emerald-950/20">
                  <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                  </div>
                  <div className="relative aspect-[16/10] w-full bg-slate-900">
                    <Image
                      src={block.src}
                      alt={block.alt}
                      fill
                      className="object-cover object-top"
                      sizes="(max-width: 768px) 100vw, 672px"
                    />
                  </div>
                </div>
                {block.caption ? (
                  <figcaption className="mt-3 text-center text-sm text-slate-500">
                    {block.caption}
                  </figcaption>
                ) : null}
              </figure>
            );
          case "code":
            return (
              <pre
                key={i}
                className="mt-6 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/90 p-4 font-mono text-sm leading-relaxed text-emerald-100/90"
              >
                <code>{block.code}</code>
              </pre>
            );
          case "callout":
            return (
              <aside
                key={i}
                className="mt-8 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-5 py-4 text-sm leading-relaxed text-emerald-100/90"
              >
                {block.text}
              </aside>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
