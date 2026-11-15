import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // landing/ has its own bun.lock; without this Next infers the repo root
  // (parent bun.lock) and tries to compile the app's src/instrumentation.ts.
  turbopack: {
    root: __dirname,
  },
  // Static hosts have no /_next/image optimizer — serve public assets as-is.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
