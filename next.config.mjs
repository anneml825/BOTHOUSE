/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Native SVG renderer; must be loaded by Node, not bundled
    serverComponentsExternalPackages: ['@resvg/resvg-js'],
  },
};

export default nextConfig;
