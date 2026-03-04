import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "temp.compsci88.com",
      },
      {
        protocol: "https",
        hostname: "hot.planeptune.us",
      },
      {
        protocol: "https",
        hostname: "static.comix.to",
      },
    ],
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
