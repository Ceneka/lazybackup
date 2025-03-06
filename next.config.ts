/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  //output: "standalone",
  /* experimental: {
    instrumentationHook: true,
  }, */
};

export default nextConfig;
