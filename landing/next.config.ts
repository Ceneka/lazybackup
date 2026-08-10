import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Static hosts have no /_next/image optimizer — serve public assets as-is.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
