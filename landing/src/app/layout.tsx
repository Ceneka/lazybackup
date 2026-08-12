import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: {
    default: "LazyBackup — From → To backups for your servers",
    template: "%s · LazyBackup",
  },
  description:
    "Self-hosted From→To backups: local, SSH, S3; path, Docker volume, database, instance meta-backup; age vault, Bro Space, passkeys, Status posture, MCP.",
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
      "Endpoints, age encryption vault, Bro Space, instance backup, Status checks, passkeys, MCP—self-hosted.",
    type: "website",
  },
  keywords: [
    "from to backup",
    "server to server backup",
    "ssh docker volume backup",
    "docker volume restore",
    "age encryption backup",
    "s3 backup self hosted",
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
