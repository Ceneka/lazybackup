import { AppShell } from "@/components/app-shell";
import { BodyPointerEventsGuard } from "@/components/body-pointer-events-guard";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted so `next dev` does not fetch Google Fonts (fails offline / caches the miss).
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "LazyBackup - VPS Backup Manager",
  description: "Manage your VPS backups with ease",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <Providers>
          <BodyPointerEventsGuard />
          <div className="min-h-screen bg-background flex flex-col">
            <AppShell>{children}</AppShell>
          </div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
