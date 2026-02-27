import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [],
  },
  experimental: {
    serverComponentsExternalPackages: ["@anthropic-ai/sdk"],
  },
};

export default nextConfig;
