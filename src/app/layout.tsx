import { AppShell } from "@/components/app-shell";
import { BodyPointerEventsGuard } from "@/components/body-pointer-events-guard";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

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
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
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
