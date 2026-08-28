import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type errors must fail the build — that is the quality gate for this project.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  // Product photography is served from Unsplash.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  // better-sqlite3 is a native module — keep it out of the bundle.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
  // Bundle the SQLite file into the serverless function so `vercel deploy`
  // works with zero manual config. Writes are ephemeral on serverless — see
  // DECISIONS.md for the production (Postgres adapter) path.
  outputFileTracingIncludes: {
    "/**": ["./db/fieldward.db"],
  },
};

export default nextConfig;
