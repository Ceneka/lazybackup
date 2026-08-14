import path from "path";
import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isProduction ? "" : " ws: wss:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  ...(process.env.ENABLE_HSTS === "true"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  output: "standalone",
  // Keep Node-only packages out of Next's server bundle where possible
  serverExternalPackages: [
    "cron",
    "@libsql/client",
    "libsql",
    "node-ssh",
    "ssh2",
    "cpu-features",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  webpack: (config, { nextRuntime }) => {
    // instrumentation.ts is compiled for Edge too; stub Node-only entry so Edge
    // does not try to resolve fs/child_process via cron/ssh.
    if (nextRuntime === "edge") {
      config.resolve.alias = {
        ...config.resolve.alias,
        [path.resolve(__dirname, "src/instrumentation.node.ts")]: false,
        [path.resolve(__dirname, "src/instrumentation.node")]: false,
      };
    }
    return config;
  },
};

export default nextConfig;
