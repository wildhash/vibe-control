/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable experimental features for better streaming
  experimental: {
    serverComponentsExternalPackages: ['@modelcontextprotocol/sdk'],
  },
};

module.exports = nextConfig;
