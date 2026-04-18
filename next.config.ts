import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
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
        hostname: "media.omegascans.org",
      },
      {
        protocol: "https",
        hostname: "cdn.madaradex.org",
      },
      {
        protocol: "https",
        hostname: "madaradex.org",
      },
      {
        protocol: "https",
        hostname: "**.toonilycdnv2.xyz",
      },
      {
        protocol: "https",
        hostname: "myspacecat.pictures",
      },
      {
        protocol: "https",
        hostname: "hentai20.io",
      },
      {
        protocol: "https",
        hostname: "manhwa18.net",
      },
      {
        protocol: "https",
        hostname: "min.manhwa18.net",
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
