import Link from "next/link";
import { GITHUB_URL, LAZYBRO_RELEASE_URL, SITE_URL } from "./features-data";
import { Logo } from "./logo";

const footerLinks = [
  { href: GITHUB_URL, label: "GitHub", external: true },
  { href: LAZYBRO_RELEASE_URL, label: "Download LazyBro", external: true },
  { href: SITE_URL, label: "lazy.zic.ar" },
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/compare", label: "Compare" },
  { href: "/blog", label: "Blog" },
  { href: "/changelog", label: "Changelog" },
  { href: `${GITHUB_URL}#readme`, label: "Docs", external: true },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06] bg-[#050810] py-12">
      <div className="container mx-auto flex flex-col items-center justify-between gap-6 px-5 text-center text-sm text-slate-500 md:flex-row md:px-8 md:text-left">
        <div className="flex flex-col items-center gap-3 md:items-start">
          <Logo
            withWordmark
            markClassName="h-7 w-7"
            wordmarkClassName="text-base text-slate-300"
          />
          <p>© {new Date().getFullYear()} LazyBackup. All rights reserved.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-2">
          {footerLinks.map((link) => (
            <Link
              key={link.href + link.label}
              href={link.href}
              {...("external" in link && link.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="hover:text-slate-300"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
