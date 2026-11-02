import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Exact dev hostnames only; set the current LAN IP when testing on devices.
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.NEXT_DEV_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  ],
  poweredByHeader: false,
  agentRules: false,
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // npm run build enforces both ESLint and Oxlint before invoking Next 16.
  turbopack: { root: monorepoRoot },
  async rewrites(){
    return {beforeFiles:[
      {source:'/consumer/:path*',destination:'/mobile/index.html'},
      {source:'/staff/:path*',destination:'/mobile/index.html'},
      {source:'/_expo/:path*',destination:'/mobile/_expo/:path*'},
      {source:'/assets/:path*',destination:'/mobile/assets/:path*'},
    ],afterFiles:[],fallback:[]};
  },
};

export default nextConfig;
