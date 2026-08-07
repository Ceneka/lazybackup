import path from "path";
import type { NextConfig } from "next";

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
