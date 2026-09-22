/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow importing the shared workspace package (TS source) directly.
  transpilePackages: ["@company-brain/shared"],
  experimental: {
    serverComponentsExternalPackages: ["@anthropic-ai/sdk", "openai", "cohere-ai"],
  },
};

export default nextConfig;
