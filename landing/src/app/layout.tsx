import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { OG_IMAGE, SITE_URL } from "@/components/landing/features-data";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "LazyBackup — From → To backups for your servers",
    template: "%s · LazyBackup",
  },
  description:
    "Self-hosted From→To backups: local, SSH, S3; path, Docker volume, database, instance meta-backup; validate before run, failure webhooks, age vault, Bro Space, passkeys, Status posture, MCP.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "LazyBackup — From → To backups for your servers",
    description:
      "Endpoints, validate before run, failure webhooks, age vault, Bro Space, passkeys, MCP—self-hosted.",
    type: "website",
    url: SITE_URL,
    siteName: "LazyBackup",
    locale: "en_US",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "LazyBackup — From → To backups for your servers",
    description:
      "Self-hosted From→To backups with validate, failure webhooks, age encryption, and MCP.",
    images: [OG_IMAGE.url],
  },
  keywords: [
    "from to backup",
    "server to server backup",
    "ssh docker volume backup",
    "docker volume restore",
    "age encryption backup",
    "s3 backup self hosted",
    "backup failure webhook",
    "validate backup",
    "mcp backup",
    "vps backup",
    "self-hosted backup",
    "rsync ssh backup",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
