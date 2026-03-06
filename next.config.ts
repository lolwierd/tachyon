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
      {
        protocol: "https",
        hostname: "media.omegascans.org",
      },
      {
        protocol: "https",
        hostname: "cdn.madaradex.org",
      },
      {
        protocol: "https",
        hostname: "i0.wp.com",
      },
      {
        protocol: "https",
        hostname: "i1.wp.com",
      },
      {
        protocol: "https",
        hostname: "i2.wp.com",
      },
      {
        protocol: "https",
        hostname: "i3.wp.com",
      },
    ],
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
